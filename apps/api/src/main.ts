import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createKeycloakOidcAccessTokenVerifier } from "@quantum-crm/auth";
import { loadServiceConfig, requireDatabaseConfig, requireOidcConfig } from "@quantum-crm/config";
import { createCrmPostgresDatabase } from "@quantum-crm/database";
import { iamPermissions } from "@quantum-crm/domain";

import { AppModule } from "./app.module.js";
import { createMemberActivationIssuer } from "./member-activation-issuer.js";

async function bootstrap(): Promise<void> {
  const config = loadServiceConfig("api");
  const databaseConfig = requireDatabaseConfig(config);
  const oidcConfig = requireOidcConfig(config);
  const database = createCrmPostgresDatabase(databaseConfig, config.serviceName);
  const verifier = createKeycloakOidcAccessTokenVerifier(oidcConfig);
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
