import "reflect-metadata";

import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadServiceConfig, requireDatabaseConfig } from "@quantum-crm/config";
import { createCrmPostgresDatabase } from "@quantum-crm/database";
import { createClamAvClient, createS3ObjectStorage } from "@quantum-crm/files-infrastructure";
import { createInternalHealthServer, registerGracefulShutdown } from "@quantum-crm/observability";

import { AppModule } from "./app.module.js";
import {
  startFileProcessingLoop,
  type FileProcessingLoop,
  type FileProcessingRepository,
} from "./file-processing-loop.js";

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
    await application?.close();
    await database.close();
    throw error;
  }
}

void bootstrap().catch(() => {
  process.stderr.write("worker failed to start\n");
  process.exitCode = 1;
});
