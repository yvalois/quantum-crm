import "reflect-metadata";

import { hostname } from "node:os";

import { NestFactory } from "@nestjs/core";
import { loadServiceConfig, requireDatabaseConfig } from "@quantum-crm/config";
import {
  createPlatformPostgresDatabase,
  createTenantDatabaseProvisioner,
  createTenantDatabaseSecretsProvisioner,
} from "@quantum-crm/database";
import { createInternalHealthServer, registerGracefulShutdown } from "@quantum-crm/observability";

import { AppModule } from "./app.module.js";
import { ProvisioningExecutor } from "./provisioning-executor.js";
import { createTenantStorageProvisioner } from "./seaweed-storage-provisioner.js";
import { createTenantConfigurationProvisioner } from "./tenant-configuration-provisioner.js";
import { createTenantContainerProvisioner } from "./tenant-container-provisioner.js";

async function bootstrap(): Promise<void> {
  const config = loadServiceConfig("deploy-executor");
  const database = createPlatformPostgresDatabase(
    requireDatabaseConfig(config),
    config.serviceName,
  );
  const adminConnectionUrl = config.database?.adminConnectionUrl?.expose();
  if (!adminConnectionUrl) throw new Error("deploy-executor database admin configuration missing");
  if (!config.tenantSecretDirectory) {
    throw new Error("deploy-executor tenant secret directory configuration missing");
  }
  if (!config.tenantConfigurationDirectory) {
    throw new Error("deploy-executor tenant configuration directory configuration missing");
  }
  if (!config.deployHostSocketPath) {
    throw new Error("deploy-executor host adapter socket configuration missing");
  }
  if (!config.storage) throw new Error("deploy-executor storage configuration missing");
  const databaseProvisioner = createTenantDatabaseProvisioner(adminConnectionUrl);
  const secretsProvisioner = createTenantDatabaseSecretsProvisioner(
    adminConnectionUrl,
    config.tenantSecretDirectory,
  );
  const storageProvisioner = createTenantStorageProvisioner({
    endpoint: config.storage.endpoint,
    adminAccessKey: config.storage.adminAccessKey.expose(),
    adminSecretKey: config.storage.adminSecretKey.expose(),
    tenantSecretDirectory: config.tenantSecretDirectory,
  });
  const configurationProvisioner = createTenantConfigurationProvisioner({
    configurationDirectory: config.tenantConfigurationDirectory,
    storageEndpoint: config.storage.endpoint,
    releaseRepository: database.releases,
  });
  const containerProvisioner = createTenantContainerProvisioner({
    socketPath: config.deployHostSocketPath,
  });
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
      secretsProvisioner,
      storageProvisioner,
      configurationProvisioner,
      containerProvisioner,
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
      await secretsProvisioner.close();
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
    await secretsProvisioner.close();
    throw error;
  }
}

void bootstrap().catch(() => {
  process.stderr.write("deploy-executor failed to start\n");
  process.exitCode = 1;
});
