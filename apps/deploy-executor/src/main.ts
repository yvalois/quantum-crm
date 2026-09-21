import "reflect-metadata";

import { hostname } from "node:os";

import { NestFactory } from "@nestjs/core";
import { loadServiceConfig, requireDatabaseConfig } from "@quantum-crm/config";
import {
  createPlatformPostgresDatabase,
  createTenantDatabaseProvisioner,
} from "@quantum-crm/database";
import { createInternalHealthServer, registerGracefulShutdown } from "@quantum-crm/observability";

import { AppModule } from "./app.module.js";
import { ProvisioningExecutor } from "./provisioning-executor.js";

async function bootstrap(): Promise<void> {
  const config = loadServiceConfig("deploy-executor");
  const database = createPlatformPostgresDatabase(
    requireDatabaseConfig(config),
    config.serviceName,
  );
  const adminConnectionUrl = config.database?.adminConnectionUrl?.expose();
  if (!adminConnectionUrl) throw new Error("deploy-executor database admin configuration missing");
  const databaseProvisioner = createTenantDatabaseProvisioner(adminConnectionUrl);
  let application: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  try {
    await database.connect();
    application = await NestFactory.createApplicationContext(AppModule, {
      abortOnError: true,
      logger: false,
    });
    const applicationContext = application;
    let ready = false;
    let closing = false;
    const healthServer = createInternalHealthServer({
      serviceName: config.serviceName,
      host: config.host,
      port: config.port,
      isReady: async () => ready && (await database.isReady()),
    });

    await healthServer.start();
    const executor = new ProvisioningExecutor(
      database.provisioningOperations,
      {
        workerId: `deploy-executor:${hostname()}`,
        leaseDurationSeconds: 60,
        idlePollMilliseconds: 2_000,
      },
      undefined,
      databaseProvisioner,
    );
    ready = true;
    const close = async (): Promise<void> => {
      if (closing) return;
      closing = true;
      ready = false;
      await executor.close().catch(() => undefined);
      await healthServer.close();
      await applicationContext.close();
      await database.close();
      await databaseProvisioner.close();
    };
    registerGracefulShutdown([{ close }], config.shutdownTimeoutMs);
    void executor.start().catch(async () => {
      process.stderr.write("deploy-executor processing loop failed\n");
      process.exitCode = 1;
      await close();
    });
  } catch (error) {
    await application?.close();
    await database.close();
    await databaseProvisioner.close();
    throw error;
  }
}

void bootstrap().catch(() => {
  process.stderr.write("deploy-executor failed to start\n");
  process.exitCode = 1;
});
