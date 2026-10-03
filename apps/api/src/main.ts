import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createKeycloakOidcAccessTokenVerifier } from "@quantum-crm/auth";
import { loadServiceConfig, requireDatabaseConfig, requireOidcConfig } from "@quantum-crm/config";
import { createCrmPostgresDatabase } from "@quantum-crm/database";
import {
  iamPermissions,
  type FileRecord,
  type FileStorageAuthorization,
} from "@quantum-crm/domain";
import { createS3ObjectStorage } from "@quantum-crm/files-infrastructure";

import { AppModule } from "./app.module.js";
import { createMemberActivationIssuer } from "./member-activation-issuer.js";

async function bootstrap(): Promise<void> {
  const config = loadServiceConfig("api");
  const databaseConfig = requireDatabaseConfig(config);
  const oidcConfig = requireOidcConfig(config);
  const database = createCrmPostgresDatabase(databaseConfig, config.serviceName);
  const verifier = createKeycloakOidcAccessTokenVerifier(oidcConfig);
  if (!config.filesStorage || config.filesStorage.role !== "signer") {
    throw new Error("api requires signer file storage configuration");
  }
  const filesConfig = config.filesStorage;
  const uploadStorage = createS3ObjectStorage({
    endpoint: filesConfig.endpoint,
    publicEndpoint: filesConfig.publicEndpoint,
    region: filesConfig.region,
    incomingBucket: filesConfig.incomingBucket,
    objectsBucket: filesConfig.objectsBucket,
    requestTimeoutMs: filesConfig.requestTimeoutMs,
    credentials: {
      accessKey: filesConfig.uploadCredentials.accessKey.expose(),
      secretKey: filesConfig.uploadCredentials.secretKey.expose(),
    },
  });
  const deliveryStorage = createS3ObjectStorage({
    endpoint: filesConfig.endpoint,
    publicEndpoint: filesConfig.publicEndpoint,
    region: filesConfig.region,
    incomingBucket: filesConfig.incomingBucket,
    objectsBucket: filesConfig.objectsBucket,
    requestTimeoutMs: filesConfig.requestTimeoutMs,
    credentials: {
      accessKey: filesConfig.deliveryCredentials.accessKey.expose(),
      secretKey: filesConfig.deliveryCredentials.secretKey.expose(),
    },
  });
  const fileStorageAuthorization: FileStorageAuthorization = Object.freeze({
    authorizeUpload: async (file: FileRecord) => {
      const authorization = uploadStorage.reserveUpload({
        objectKey: file.incomingObjectKey,
        expectedSha256Base64: file.expectedSha256,
        contentType: file.declaredMime,
        maxBytes: file.declaredSize,
        expiresInSeconds: filesConfig.uploadTtlSeconds,
      });
      return Object.freeze({
        method: "POST" as const,
        url: authorization.url,
        fields: authorization.fields,
        expiresAt: new Date(authorization.expiresAt),
      });
    },
    authorizeDownload: async (file: FileRecord) => {
      if (!file.objectKey || !file.objectVersionId) {
        throw new Error("available file has no immutable object version");
      }
      const expiresAt = new Date(Date.now() + filesConfig.downloadTtlSeconds * 1_000);
      return Object.freeze({
        method: "GET" as const,
        url: deliveryStorage.presignDownload({
          objectKey: file.objectKey,
          versionId: file.objectVersionId,
          expiresInSeconds: filesConfig.downloadTtlSeconds,
          responseContentType: file.observedMime ?? file.declaredMime,
          responseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        }),
        expiresAt,
        objectVersionId: file.objectVersionId,
      });
    },
  });
  const activationIssuer = config.iamBootstrapClientSecret
    ? createMemberActivationIssuer({
        tenantProfileId: databaseConfig.tenantId!,
        identityIssuer: oidcConfig.issuer,
        clientId: config.iamBootstrapClientId!,
        clientSecret: config.iamBootstrapClientSecret.expose(),
      })
    : undefined;
  let application: INestApplication | undefined;

  try {
    await database.connect();
    application = await NestFactory.create(
      AppModule.register(
        database,
        verifier,
        {
          tenantId: databaseConfig.tenantId!,
          issuer: oidcConfig.issuer,
          audience: oidcConfig.audience,
          allowedPermissions: iamPermissions,
        },
        config.iamBootstrapClientId!,
        activationIssuer,
        fileStorageAuthorization,
      ),
      {
        abortOnError: true,
        bufferLogs: true,
      },
    );
    application.enableShutdownHooks();
    await application.listen(config.port, config.host);
  } catch (error) {
    await application?.close();
    await database.close();
    throw error;
  }
}

void bootstrap().catch(() => {
  process.stderr.write("api failed to start\n");
  process.exitCode = 1;
});
