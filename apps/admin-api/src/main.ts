import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { loadProcessConfig } from "@quantum-crm/config";

import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const config = loadProcessConfig({
    serviceName: "admin-api",
    defaultHost: "0.0.0.0",
    defaultPort: 3002,
  });
  const application = await NestFactory.create(AppModule, {
    abortOnError: true,
    bufferLogs: true,
  });
  application.enableShutdownHooks();
  await application.listen(config.port, config.host);
}

void bootstrap().catch(() => {
  process.stderr.write("admin-api failed to start\n");
  process.exitCode = 1;
});
