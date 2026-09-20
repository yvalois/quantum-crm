import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadServiceConfig, requireDatabaseConfig } from "@quantum-crm/config";
import { createPostgresDatabase } from "@quantum-crm/database";

import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const config = loadServiceConfig("admin-api");
  const database = createPostgresDatabase(requireDatabaseConfig(config), config.serviceName);
  let application: INestApplication | undefined;

  try {
    await database.connect();
    application = await NestFactory.create(AppModule.register(database), {
      abortOnError: true,
      bufferLogs: true,
    });
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
