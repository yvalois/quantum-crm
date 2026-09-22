import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createKeycloakOidcAccessTokenVerifier } from "@quantum-crm/auth";
import {
  loadServiceConfig,
  requireDatabaseConfig,
  requireOidcConfig,
} from "@quantum-crm/config";
import { createCrmPostgresDatabase } from "@quantum-crm/database";
import { iamPermissions } from "@quantum-crm/domain";

import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const config = loadServiceConfig("api");
  const databaseConfig = requireDatabaseConfig(config);
  const oidcConfig = requireOidcConfig(config);
  const database = createCrmPostgresDatabase(databaseConfig, config.serviceName);
  const verifier = createKeycloakOidcAccessTokenVerifier(oidcConfig);
  let application: INestApplication | undefined;

  try {
    await database.connect();
    application = await NestFactory.create(
      AppModule.register(database, verifier, {
        tenantId: databaseConfig.tenantId!,
        issuer: oidcConfig.issuer,
        audience: oidcConfig.audience,
        allowedPermissions: iamPermissions,
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
  process.stderr.write("api failed to start\n");
  process.exitCode = 1;
});
