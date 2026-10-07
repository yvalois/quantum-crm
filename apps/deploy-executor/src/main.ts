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
import { createTenantHttpsRouteProvisioner } from "./tenant-https-route-provisioner.js";
import { createTenantIdentityProvisioner } from "./tenant-identity-provisioner.js";
import { createTenantInitialAdministratorProvisioner } from "./tenant-initial-administrator-provisioner.js";
import { ActivationDeliveryExecutor } from "./activation-delivery-executor.js";
import { createAdminApiActivationDeliveryCallback } from "./admin-api-activation-delivery-callback.js";
import { createTenantIamBootstrapClient } from "./tenant-iam-bootstrap-client.js";
import { createTenantCrmMigrationProvisioner } from "./tenant-crm-migration-provisioner.js";
import { createPlatformFoundationPromotionClient } from "./platform-foundation-promotion-client.js";
import { PlatformFoundationPromotionExecutor } from "./platform-foundation-promotion-executor.js";
import { createTenantReleaseConfigurationProvisioner } from "./tenant-release-configuration-provisioner.js";
import { TenantReleasePromotionExecutor } from "./tenant-release-promotion-executor.js";
import { TenantDecommissioningExecutor } from "./tenant-decommissioning-executor.js";
import { createTenantRuntimeDecommissioner } from "./tenant-runtime-decommissioner.js";
import { createPlatformOperatorProvisioner } from "./platform-operator-provisioner.js";
import { ProfileOperatorExecutor } from "./profile-operator-executor.js";
import { createAdminApiProfileOperatorCallback } from "./admin-api-profile-operator-callback.js";

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
  if (!config.identityProvisioner) {
    throw new Error("deploy-executor identity provisioner configuration missing");
  }
  if (!config.activationDeliveryCallback) {
    throw new Error("deploy-executor activation delivery callback configuration missing");
  }
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
    tenantSecretDirectory: config.tenantSecretDirectory,
    databaseHost: new URL(adminConnectionUrl).hostname,
    databasePort: Number(new URL(adminConnectionUrl).port || "5432"),
    identityIssuer: config.identityProvisioner.identityOrigin,
  });
  const identityProvisioner = createTenantIdentityProvisioner({
    keycloakAdminOrigin: config.identityProvisioner.keycloakAdminOrigin,
    keycloakProvisionerClientId: config.identityProvisioner.keycloakProvisionerClientId,
    keycloakProvisionerClientSecret:
      config.identityProvisioner.keycloakProvisionerClientSecret.expose(),
    identityOrigin: config.identityProvisioner.identityOrigin,
    redisAdminUrl: config.identityProvisioner.redisAdminUrl.expose(),
    tenantSecretDirectory: config.tenantSecretDirectory,
  });
  const containerProvisioner = createTenantContainerProvisioner({
    socketPath: config.deployHostSocketPath,
    requestTimeoutMilliseconds: 180_000,
  });
  const crmMigrationProvisioner = createTenantCrmMigrationProvisioner(config.deployHostSocketPath);
  const httpsRouteProvisioner = createTenantHttpsRouteProvisioner({
    socketPath: config.deployHostSocketPath,
  });
  const initialAdministratorProvisioner = createTenantInitialAdministratorProvisioner({
    keycloakAdminOrigin: config.identityProvisioner.keycloakAdminOrigin,
    identityOrigin: config.identityProvisioner.identityOrigin,
    keycloakProvisionerClientId: "quantum-provisioner",
    keycloakProvisionerClientSecret:
      config.identityProvisioner.keycloakProvisionerClientSecret.expose(),
  });
  const activationDeliveryExecutor = new ActivationDeliveryExecutor(
    database.activationDeliveries,
    initialAdministratorProvisioner,
    createAdminApiActivationDeliveryCallback({
      origin: config.activationDeliveryCallback.origin,
      principal: config.activationDeliveryCallback.principal,
      audience: config.activationDeliveryCallback.audience,
      token: config.activationDeliveryCallback.token.expose(),
    }),
    `deploy-executor:${hostname()}:activation`,
  );
  const profileOperatorExecutor = new ProfileOperatorExecutor(
    database.profileOperators,
    createPlatformOperatorProvisioner({
      keycloakAdminOrigin: config.identityProvisioner.keycloakAdminOrigin,
      clientId: "quantum-provisioner",
      clientSecret: config.identityProvisioner.keycloakProvisionerClientSecret.expose(),
    }),
    createAdminApiProfileOperatorCallback({
      origin: config.activationDeliveryCallback.origin,
      principal: config.activationDeliveryCallback.principal,
      audience: config.activationDeliveryCallback.audience,
      token: config.activationDeliveryCallback.token.expose(),
    }),
    `deploy-executor:${hostname()}:profile-operator`,
  );
  const iamBootstrap = createTenantIamBootstrapClient({
    tenantSecretDirectory: config.tenantSecretDirectory,
    identityOrigin: config.identityProvisioner.identityOrigin,
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
      httpsRouteProvisioner,
      identityProvisioner,
      initialAdministratorProvisioner,
      database.activationDeliveries,
      iamBootstrap,
      crmMigrationProvisioner,
    );
    const foundationPromotionExecutor = new PlatformFoundationPromotionExecutor(
      database.platformFoundationPromotions,
      database.releases,
      createPlatformFoundationPromotionClient(config.deployHostSocketPath),
      `deploy-executor:${hostname()}:foundation`,
    );
    const tenantReleasePromotionExecutor = new TenantReleasePromotionExecutor(
      database.tenantReleasePromotions,
      database.releases,
      createTenantReleaseConfigurationProvisioner({
        configurationDirectory: config.tenantConfigurationDirectory,
        releaseRepository: database.releases,
      }),
      crmMigrationProvisioner,
      containerProvisioner,
      {
        workerId: `deploy-executor:${hostname()}:tenant-release`,
        leaseDurationSeconds: 240,
      },
    );
    const tenantDecommissioningExecutor = new TenantDecommissioningExecutor(
      database.tenantDecommissioningOperations,
      createTenantRuntimeDecommissioner({ socketPath: config.deployHostSocketPath }),
      `deploy-executor:${hostname()}:tenant-decommissioning`,
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
    const activationLoop = async (): Promise<void> => {
      while (!closing) {
        const processed = await activationDeliveryExecutor.runOnce();
        if (!processed) await new Promise((resolve) => setTimeout(resolve, 500));
      }
    };
    void activationLoop().catch(async () => {
      process.stderr.write("deploy-executor activation delivery loop failed\n");
      process.exitCode = 1;
      await close();
    });
    const profileOperatorLoop = async (): Promise<void> => {
      while (!closing) {
        const processed = await profileOperatorExecutor.runOnce();
        if (!processed) await new Promise((resolve) => setTimeout(resolve, 500));
      }
    };
    void profileOperatorLoop().catch(async () => {
      process.stderr.write("deploy-executor profile operator loop failed\n");
      process.exitCode = 1;
      await close();
    });
    const foundationPromotionLoop = async (): Promise<void> => {
      while (!closing) {
        const processed = await foundationPromotionExecutor.runOnce();
        if (!processed) await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    };
    void foundationPromotionLoop().catch(async () => {
      process.stderr.write("deploy-executor foundation promotion loop failed\n");
      process.exitCode = 1;
      await close();
    });
    const tenantReleasePromotionLoop = async (): Promise<void> => {
      while (!closing) {
        const processed = await tenantReleasePromotionExecutor.runOnce();
        if (!processed) await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    };
    void tenantReleasePromotionLoop().catch(async () => {
      process.stderr.write("deploy-executor tenant release promotion loop failed\n");
      process.exitCode = 1;
      await close();
    });
    const tenantDecommissioningLoop = async (): Promise<void> => {
      while (!closing) {
        const processed = await tenantDecommissioningExecutor.runOnce();
        if (!processed) await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    };
    void tenantDecommissioningLoop().catch(async () => {
      process.stderr.write("deploy-executor tenant decommissioning loop failed\n");
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
