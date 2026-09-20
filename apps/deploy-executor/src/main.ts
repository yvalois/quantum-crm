import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { loadServiceConfig, requireDatabaseConfig } from "@quantum-crm/config";
import { createPlatformPostgresDatabase } from "@quantum-crm/database";
import { createInternalHealthServer, registerGracefulShutdown } from "@quantum-crm/observability";

import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const config = loadServiceConfig("deploy-executor");
  const database = createPlatformPostgresDatabase(
    requireDatabaseConfig(config),
    config.serviceName,
  );
  let application: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  try {
    await database.connect();
    application = await NestFactory.createApplicationContext(AppModule, {
      abortOnError: true,
      logger: false,
    });
    const applicationContext = application;
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
    await application?.close();
    await database.close();
    throw error;
  }
}

void bootstrap().catch(() => {
  process.stderr.write("deploy-executor failed to start\n");
  process.exitCode = 1;
});
