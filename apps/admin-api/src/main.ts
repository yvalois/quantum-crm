import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createKeycloakOidcAccessTokenVerifier } from "@quantum-crm/auth";
import { loadServiceConfig, requireDatabaseConfig, requireOidcConfig } from "@quantum-crm/config";
import { createPlatformPostgresDatabase } from "@quantum-crm/database";
import { platformPermissions } from "@quantum-crm/platform-domain";

import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const config = loadServiceConfig("admin-api");
  const database = createPlatformPostgresDatabase(
    requireDatabaseConfig(config),
    config.serviceName,
  );
  const oidc = requireOidcConfig(config);
  const oidcAccessTokenVerifier = createKeycloakOidcAccessTokenVerifier(oidc);
  let application: INestApplication | undefined;

  try {
    await database.connect();
    application = await NestFactory.create(
      AppModule.register(database, oidcAccessTokenVerifier, {
        issuer: oidc.issuer,
        audience: oidc.audience,
        allowedPermissions: platformPermissions,
      }),
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
  process.stderr.write("admin-api failed to start\n");
  process.exitCode = 1;
});
