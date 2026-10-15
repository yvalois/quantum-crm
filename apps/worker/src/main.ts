import "reflect-metadata";

import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createServiceTokenClient } from "@quantum-crm/auth";
import { loadServiceConfig, requireDatabaseConfig, requireOidcConfig } from "@quantum-crm/config";
import { createCrmPostgresDatabase } from "@quantum-crm/database";
import { FileService, agentRoutingPrincipalId } from "@quantum-crm/domain";
import {
  startConversationInboundMediaLoop,
  type InboundMediaLoopOptions,
} from "./conversation-inbound-media-loop.js";
import {
  createClamAvClient,
  createS3ObjectStorage,
  readAvailableOutboundMedia,
} from "@quantum-crm/files-infrastructure";
import { createInternalHealthServer, registerGracefulShutdown } from "@quantum-crm/observability";

import { AppModule } from "./app.module.js";
import {
  startConversationAgentLoop,
  type ConversationAgentLoop,
} from "./conversation-agent-loop.js";
import { routeInterAmericanAdvisor } from "./interamerican-advisor-routing.js";
import {
  startFileProcessingLoop,
  type FileProcessingLoop,
  type FileProcessingRepository,
} from "./file-processing-loop.js";
import { startYCloudOutboundLoop, type YCloudOutboundLoop } from "./ycloud-outbound-loop.js";

async function bootstrap(): Promise<void> {
  const config = loadServiceConfig("worker");
  const database = createCrmPostgresDatabase(requireDatabaseConfig(config), config.serviceName);
  if (!config.filesStorage || config.filesStorage.role !== "processor") {
    throw new Error("worker requires processor file storage configuration");
  }
  const filesConfig = config.filesStorage;
  const storage = createS3ObjectStorage({
    endpoint: filesConfig.endpoint,
    region: filesConfig.region,
    incomingBucket: filesConfig.incomingBucket,
    objectsBucket: filesConfig.objectsBucket,
    requestTimeoutMs: filesConfig.requestTimeoutMs,
    credentials: {
      accessKey: filesConfig.processorCredentials.accessKey.expose(),
      secretKey: filesConfig.processorCredentials.secretKey.expose(),
    },
  });
  const scanner = createClamAvClient(filesConfig.clamAv);
  const fileRepository: FileProcessingRepository = Object.freeze({
    claimNext: async (input: Parameters<FileProcessingRepository["claimNext"]>[0]) => {
      const lease = await database.commercial.files.claimNextProcessing(input);
      return lease
        ? Object.freeze({
            operationId: lease.operationId,
            generation: lease.leaseGeneration,
            file: lease.file,
          })
        : null;
    },
    persist: async (input: Parameters<FileProcessingRepository["persist"]>[0]) =>
      database.commercial.files.transitionProcessing({
        operationId: input.lease.operationId,
        leaseGeneration: input.lease.generation,
        file: input.file,
        now: input.now,
      }),
  });
  let application: INestApplicationContext | undefined;
  let fileProcessingLoop: FileProcessingLoop | undefined;
  let ycloudOutboundLoop: YCloudOutboundLoop | undefined;
  let conversationAgentLoop: ConversationAgentLoop | undefined;
  let inboundMediaLoop: { close: () => Promise<void> } | undefined;
  try {
    await database.connect();
    application = await NestFactory.createApplicationContext(AppModule, {
      abortOnError: true,
      logger: false,
    });
    const applicationContext = application;
    fileProcessingLoop = startFileProcessingLoop({
      repository: fileRepository,
      storage,
      scanner,
      pollIntervalMs: filesConfig.pollIntervalMs,
      leaseSeconds: filesConfig.leaseSeconds,
      onError: () => {
        process.stderr.write('{"level":"error","event":"file_processing_attempt_failed"}\n');
      },
    });
    if (config.ycloudBinding && config.ycloudApiKey) {
      ycloudOutboundLoop = startYCloudOutboundLoop({
        repository: database.commercial.conversationOutbound,
        binding: config.ycloudBinding,
        apiKey: config.ycloudApiKey.expose(),
        mediaFor: (lease) =>
          readAvailableOutboundMedia({
            files: database.commercial.files,
            storage,
            actor: { memberId: agentRoutingPrincipalId, scope: "PROFILE" },
            fileId: lease.fileId ?? "",
            conversationId: lease.conversationId,
          }),
        pollIntervalMs: 2_000,
        onError: () => {
          process.stderr.write('{"level":"error","event":"ycloud_outbound_attempt_failed"}\n');
        },
      });
    }
    if (config.ycloudBinding && config.ycloudApiKey && config.openAiApiKey) {
      if (!config.filesInboundUploadCredentials)
        throw new Error("Inbound media upload credential is required");
      const uploadStorage = createS3ObjectStorage({
        endpoint: filesConfig.endpoint,
        region: filesConfig.region,
        incomingBucket: filesConfig.incomingBucket,
        objectsBucket: filesConfig.objectsBucket,
        requestTimeoutMs: filesConfig.requestTimeoutMs,
        credentials: {
          accessKey: config.filesInboundUploadCredentials.accessKey.expose(),
          secretKey: config.filesInboundUploadCredentials.secretKey.expose(),
        },
      });
      const actor = { memberId: agentRoutingPrincipalId, scope: "PROFILE" as const };
      inboundMediaLoop = startConversationInboundMediaLoop({
        repository: database.commercial.inboundMedia,
        fileRepository: database.commercial.files,
        storage,
        actor,
        ycloudApiKey: config.ycloudApiKey,
        openAiApiKey: config.openAiApiKey,
        filesFor: (conversationId) =>
          new FileService(
            database.commercial.files,
            {
              canUseOwner: async (_actor, owner) =>
                owner.kind === "existing" &&
                owner.module === "conversations" &&
                owner.type === "conversation" &&
                owner.id === conversationId,
            },
            {
              authorizeUpload: async (file) => ({
                ...uploadStorage.reserveUpload({
                  objectKey: file.incomingObjectKey,
                  expectedSha256Base64: file.expectedSha256,
                  contentType: file.declaredMime,
                  maxBytes: file.declaredSize,
                  expiresInSeconds: 600,
                }),
                method: "POST" as const,
                expiresAt: new Date(Date.now() + 600_000),
              }),
              inspectUpload: (file) => uploadStorage.inspectIncomingUpload(file.incomingObjectKey),
              authorizeDownload: async () => {
                throw new Error("Worker cannot authorize customer download");
              },
            },
          ),
        pollIntervalMs: 2_000,
        onError: () => {
          process.stderr.write('{"level":"error","event":"inbound_media_attempt_failed"}\n');
        },
      } satisfies InboundMediaLoopOptions);
    }
    if (config.agentGatewaySecret && config.database?.tenantId) {
      conversationAgentLoop = startConversationAgentLoop({
        repository: database.commercial.conversationAgent,
        ...(config.ycloudBinding?.advisorRouting === "interamerican-v54"
          ? {
              routeAdvisor: async (lease: { readonly conversationId: string }) =>
                Boolean(
                  await routeInterAmericanAdvisor(database, {
                    conversationId: lease.conversationId,
                  }),
                ),
            }
          : {}),
        sourcesReady: database.commercial.agentKnowledge.bothCatalogsReady,
        tokenClient: createServiceTokenClient({
          issuer: requireOidcConfig(config).issuer,
          clientId: "quantum-agent-gateway",
          clientSecret: config.agentGatewaySecret,
        }),
        tenantId: config.database.tenantId,
        pollIntervalMs: 2_000,
        onError: () => {
          process.stderr.write('{"level":"error","event":"conversation_agent_attempt_failed"}\n');
        },
      });
    }
    let ready = false;
    const healthServer = createInternalHealthServer({
      serviceName: config.serviceName,
      host: config.host,
      port: config.port,
      isReady: async () => ready && (await database.isReady()),
    });

    await healthServer.start();
    ready = true;
    registerGracefulShutdown(
      [
        healthServer,
        fileProcessingLoop,
        ...(ycloudOutboundLoop ? [ycloudOutboundLoop] : []),
        ...(conversationAgentLoop ? [conversationAgentLoop] : []),
        ...(inboundMediaLoop ? [inboundMediaLoop] : []),
        {
          close: async () => {
            ready = false;
            await applicationContext.close();
            await database.close();
          },
        },
      ],
      config.shutdownTimeoutMs,
    );
  } catch (error) {
    await fileProcessingLoop?.close();
    await ycloudOutboundLoop?.close();
    await conversationAgentLoop?.close();
    await inboundMediaLoop?.close();
    await application?.close();
    await database.close();
    throw error;
  }
}

void bootstrap().catch(() => {
  process.stderr.write("worker failed to start\n");
  process.exitCode = 1;
});
