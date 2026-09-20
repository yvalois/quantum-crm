import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { loadServiceConfig } from "@quantum-crm/config";

import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const config = loadServiceConfig("api");
  const application = await NestFactory.create(AppModule, {
    abortOnError: true,
    bufferLogs: true,
  });
  application.enableShutdownHooks();
  await application.listen(config.port, config.host);
}

void bootstrap().catch(() => {
  process.stderr.write("api failed to start\n");
  process.exitCode = 1;
});
