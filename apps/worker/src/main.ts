import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { loadServiceConfig } from "@quantum-crm/config";
import { createInternalHealthServer, registerGracefulShutdown } from "@quantum-crm/observability";

import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const config = loadServiceConfig("worker");
  const application = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: true,
    logger: false,
  });
  let ready = false;
  const healthServer = createInternalHealthServer({
    serviceName: config.serviceName,
    host: config.host,
    port: config.port,
    isReady: () => ready,
  });

  await healthServer.start();
  ready = true;
  registerGracefulShutdown(
    [
      healthServer,
      {
        close: async () => {
          ready = false;
          await application.close();
        },
      },
    ],
    config.shutdownTimeoutMs,
  );
}

void bootstrap().catch(() => {
  process.stderr.write("worker failed to start\n");
  process.exitCode = 1;
});
