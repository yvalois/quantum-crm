import {
  tenantDatabaseIdentity,
  tenantDatabaseSecretKinds,
  tenantDatabaseSecretReference,
  tenantStorageBucketReference,
  tenantStorageSecretKinds,
  tenantStorageSecretReference,
  type ProvisioningOperationRepository,
  type TenantDatabaseSecretsProvisioner,
  type TenantConfigurationProvisioner,
  type TenantContainerProvisioner,
  type TenantDatabaseProvisioner,
  type TenantHttpsRouteProvisioner,
  type TenantIdentityProvisioner,
  type TenantStorageProvisioner,
  type ActivationDeliveryRepository,
} from "@quantum-crm/platform-domain";
import {
  TenantDatabaseProvisioningError,
  TenantDatabaseSecretsProvisioningError,
} from "@quantum-crm/database";
import { TenantStorageProvisioningError } from "./seaweed-storage-provisioner.js";
import { TenantConfigurationProvisioningError } from "./tenant-configuration-provisioner.js";
import { TenantContainerProvisioningError } from "./tenant-container-provisioner.js";
import { TenantHttpsRouteProvisioningError } from "./tenant-https-route-provisioner.js";
import { TenantIdentityProvisioningError } from "./tenant-identity-provisioner.js";
import {
  TenantInitialAdministratorProvisioningError,
  type TenantInitialAdministratorProvisioner,
} from "./tenant-initial-administrator-provisioner.js";
import { TenantIamBootstrapError, type TenantIamBootstrapClient } from "./tenant-iam-bootstrap-client.js";
import { TenantCrmMigrationProvisioningError, type TenantCrmMigrationProvisioner } from "./tenant-crm-migration-provisioner.js";

export interface ProvisioningExecutorOptions {
  readonly workerId: string;
  readonly leaseDurationSeconds: number;
  readonly idlePollMilliseconds: number;
}

type AbortableWait = (milliseconds: number, signal: AbortSignal) => Promise<void>;

const defaultWait: AbortableWait = (milliseconds, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    let timer: NodeJS.Timeout;
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });

export class ProvisioningExecutor {
  private readonly abortController = new AbortController();
  private execution: Promise<void> | undefined;

  public constructor(
    private readonly repository: ProvisioningOperationRepository,
    private readonly options: ProvisioningExecutorOptions,
    private readonly wait: AbortableWait = defaultWait,
    private readonly databaseProvisioner?: TenantDatabaseProvisioner,
    private readonly secretsProvisioner?: TenantDatabaseSecretsProvisioner,
    private readonly storageProvisioner?: TenantStorageProvisioner,
    private readonly configurationProvisioner?: TenantConfigurationProvisioner,
    private readonly containerProvisioner?: TenantContainerProvisioner,
    private readonly httpsRouteProvisioner?: TenantHttpsRouteProvisioner,
    private readonly identityProvisioner?: TenantIdentityProvisioner,
    private readonly initialAdministratorProvisioner?: TenantInitialAdministratorProvisioner,
    private readonly activationDeliveries?: ActivationDeliveryRepository,
    private readonly iamBootstrap?: TenantIamBootstrapClient,
    private readonly crmMigrationProvisioner?: TenantCrmMigrationProvisioner,
  ) {}

  public runOnce(): Promise<boolean> {
    return this.executeOne();
  }

  public start(): Promise<void> {
    this.execution ??= this.runLoop();
    return this.execution;
  }

  public async close(): Promise<void> {
    this.abortController.abort();
    await this.execution;
  }

  private async runLoop(): Promise<void> {
    while (!this.abortController.signal.aborted) {
      const processed = await this.executeOne();
      if (!processed) {
        await this.wait(this.options.idlePollMilliseconds, this.abortController.signal);
      }
    }
  }

  private async executeOne(): Promise<boolean> {
    const supportedSteps = this.databaseProvisioner
      ? this.secretsProvisioner
        ? this.storageProvisioner
          ? this.configurationProvisioner
            ? this.identityProvisioner
              ? this.containerProvisioner
                ? this.httpsRouteProvisioner
                  ? this.initialAdministratorProvisioner && this.activationDeliveries
                  ? this.iamBootstrap && this.crmMigrationProvisioner ? ([
                      "VALIDATE",
                      "CREATE_DATABASE",
                      "CREATE_SECRETS",
                      "CREATE_STORAGE",
                      "WRITE_CONFIGURATION",
                      "MIGRATE_DATABASE",
                      "START_CONTAINERS",
                      "CONFIGURE_HTTPS",
                      "CREATE_ADMINISTRATOR",
                      "VERIFY",
                      "ACTIVATE",
                    ] as const)
                  : ([
                      "VALIDATE",
                      "CREATE_DATABASE",
                      "CREATE_SECRETS",
                      "CREATE_STORAGE",
                      "WRITE_CONFIGURATION",
                      "MIGRATE_DATABASE",
                      "START_CONTAINERS",
                      "CONFIGURE_HTTPS",
                      "CREATE_ADMINISTRATOR",
                      "VERIFY",
                    ] as const)
                  : ([
                      "VALIDATE",
                      "CREATE_DATABASE",
                      "CREATE_SECRETS",
                      "CREATE_STORAGE",
                      "WRITE_CONFIGURATION",
                      "START_CONTAINERS",
                      "CONFIGURE_HTTPS",
                    ] as const)
                  : ([
                      "VALIDATE",
                      "CREATE_DATABASE",
                      "CREATE_SECRETS",
                      "CREATE_STORAGE",
                      "WRITE_CONFIGURATION",
                      "START_CONTAINERS",
                    ] as const)
                : ([
                    "VALIDATE",
                    "CREATE_DATABASE",
                    "CREATE_SECRETS",
                    "CREATE_STORAGE",
                    "WRITE_CONFIGURATION",
                  ] as const)
              : (["VALIDATE", "CREATE_DATABASE", "CREATE_SECRETS", "CREATE_STORAGE"] as const)
            : (["VALIDATE", "CREATE_DATABASE", "CREATE_SECRETS", "CREATE_STORAGE"] as const)
          : (["VALIDATE", "CREATE_DATABASE", "CREATE_SECRETS"] as const)
        : (["VALIDATE", "CREATE_DATABASE"] as const)
      : (["VALIDATE"] as const);
    const operation = await this.repository.claimNext({
      workerId: this.options.workerId,
      leaseDurationSeconds: this.options.leaseDurationSeconds,
      supportedSteps,
    });
    if (!operation) return false;
    if (operation.currentStep === "VALIDATE") {
      await this.repository.completeValidation({
        operationId: operation.id,
        workerId: this.options.workerId,
        expectedVersion: operation.version,
        attempt: operation.attempt,
      });
      return true;
    }
    if (operation.currentStep === "CREATE_DATABASE" && this.databaseProvisioner) {
      const identity = tenantDatabaseIdentity(operation.tenantProfileId);
      let provisioningFailure:
        | "DATABASE_TARGET_CONFLICT"
        | "DATABASE_PERMISSION_DENIED"
        | "DATABASE_IDENTITY_MISMATCH"
        | undefined;
      try {
        await this.databaseProvisioner.provision({
          tenantProfileId: operation.tenantProfileId,
          serverId: operation.serverId,
        });
      } catch (error) {
        if (error instanceof TenantDatabaseProvisioningError && error.reason === "UNAVAILABLE") {
          return true;
        }
        provisioningFailure =
          error instanceof TenantDatabaseProvisioningError && error.reason === "PERMISSION_DENIED"
            ? "DATABASE_PERMISSION_DENIED"
            : error instanceof TenantDatabaseProvisioningError && error.reason === "TARGET_CONFLICT"
              ? "DATABASE_TARGET_CONFLICT"
              : "DATABASE_IDENTITY_MISMATCH";
      }
      try {
        await this.repository.completeDatabase({
          operationId: operation.id,
          tenantProfileId: operation.tenantProfileId,
          workerId: this.options.workerId,
          expectedVersion: operation.version,
          attempt: operation.attempt,
          ...identity,
          ...(provisioningFailure ? { failureCode: provisioningFailure } : {}),
        });
      } catch {
        return true;
      }
      return true;
    }
    if (operation.currentStep === "MIGRATE_DATABASE" && this.crmMigrationProvisioner) {
      try {
        await this.crmMigrationProvisioner.migrate({ operationId: operation.id, tenantProfileId: operation.tenantProfileId, serverId: operation.serverId, releaseId: operation.releaseId, attempt: operation.attempt });
        await this.repository.completeMigration({ operationId: operation.id, tenantProfileId: operation.tenantProfileId, workerId: this.options.workerId, expectedVersion: operation.version, attempt: operation.attempt });
      } catch (error) {
        if (error instanceof TenantCrmMigrationProvisioningError && error.reason === "UNAVAILABLE") return true;
        const failureCode = error instanceof TenantCrmMigrationProvisioningError && error.reason === "PERMISSION_DENIED" ? "MIGRATION_PERMISSION_DENIED" : error instanceof TenantCrmMigrationProvisioningError && error.reason === "TARGET_CONFLICT" ? "MIGRATION_TARGET_CONFLICT" : "MIGRATION_IDENTITY_MISMATCH";
        await this.repository.completeMigration({ operationId: operation.id, tenantProfileId: operation.tenantProfileId, workerId: this.options.workerId, expectedVersion: operation.version, attempt: operation.attempt, failureCode }).catch(() => undefined);
      }
      return true;
    }
    if (operation.currentStep === "CREATE_STORAGE" && this.storageProvisioner) {
      let provisioningFailure:
        | "STORAGE_TARGET_CONFLICT"
        | "STORAGE_UNAVAILABLE"
        | "STORAGE_PERMISSION_DENIED"
        | "STORAGE_IDENTITY_MISMATCH"
        | undefined;
      let buckets: Awaited<ReturnType<TenantStorageProvisioner["provision"]>>["buckets"] = [
        tenantStorageBucketReference(
          operation.tenantProfileId,
          "INCOMING",
          operation.requestedCapacity.storageMiB,
        ),
        tenantStorageBucketReference(
          operation.tenantProfileId,
          "OBJECTS",
          operation.requestedCapacity.storageMiB,
        ),
      ];
      let secrets: Awaited<ReturnType<TenantStorageProvisioner["provision"]>>["secrets"] =
        tenantStorageSecretKinds.map((kind) =>
          tenantStorageSecretReference(operation.tenantProfileId, kind),
        );
      try {
        const result = await this.storageProvisioner.provision({
          tenantProfileId: operation.tenantProfileId,
          serverId: operation.serverId,
          quotaMiB: operation.requestedCapacity.storageMiB,
        });
        buckets = result.buckets;
        secrets = result.secrets;
      } catch (error) {
        if (error instanceof TenantStorageProvisioningError && error.reason === "UNAVAILABLE") {
          return true;
        }
        provisioningFailure =
          error instanceof TenantStorageProvisioningError && error.reason === "PERMISSION_DENIED"
            ? "STORAGE_PERMISSION_DENIED"
            : error instanceof TenantStorageProvisioningError && error.reason === "TARGET_CONFLICT"
              ? "STORAGE_TARGET_CONFLICT"
              : "STORAGE_IDENTITY_MISMATCH";
      }
      try {
        await this.repository.completeStorage({
          operationId: operation.id,
          tenantProfileId: operation.tenantProfileId,
          workerId: this.options.workerId,
          expectedVersion: operation.version,
          attempt: operation.attempt,
          quotaMiB: operation.requestedCapacity.storageMiB,
          buckets,
          secrets,
          ...(provisioningFailure ? { failureCode: provisioningFailure } : {}),
        });
      } catch {
        return true;
      }
      return true;
    }
    if (operation.currentStep === "WRITE_CONFIGURATION" && this.configurationProvisioner) {
      let provisioningFailure:
        | "CONFIGURATION_TARGET_CONFLICT"
        | "CONFIGURATION_UNAVAILABLE"
        | "CONFIGURATION_PERMISSION_DENIED"
        | "CONFIGURATION_IDENTITY_MISMATCH"
        | "IDENTITY_TARGET_CONFLICT"
        | "IDENTITY_PERMISSION_DENIED"
        | "IDENTITY_IDENTITY_MISMATCH"
        | undefined;
      if (!this.identityProvisioner) return false;
      const identityContext = await this.repository.resolveIdentityContext({
        operationId: operation.id,
        tenantProfileId: operation.tenantProfileId,
        serverId: operation.serverId,
        releaseId: operation.releaseId,
        workerId: this.options.workerId,
        expectedVersion: operation.version,
        attempt: operation.attempt,
      });
      if (!identityContext) return true;
      let identity:
        Awaited<ReturnType<TenantIdentityProvisioner["provision"]>>["identity"] | undefined;
      try {
        identity = (
          await this.identityProvisioner.provision({
            tenantProfileId: operation.tenantProfileId,
            serverId: operation.serverId,
            hostname: identityContext.hostname,
          })
        ).identity;
      } catch (error) {
        if (error instanceof TenantIdentityProvisioningError && error.reason === "UNAVAILABLE") {
          return true;
        }
        provisioningFailure =
          error instanceof TenantIdentityProvisioningError && error.reason === "PERMISSION_DENIED"
            ? "IDENTITY_PERMISSION_DENIED"
            : error instanceof TenantIdentityProvisioningError && error.reason === "TARGET_CONFLICT"
              ? "IDENTITY_TARGET_CONFLICT"
              : "IDENTITY_IDENTITY_MISMATCH";
      }
      if (provisioningFailure) {
        try {
          await this.repository.completeConfiguration({
            operationId: operation.id,
            tenantProfileId: operation.tenantProfileId,
            serverId: operation.serverId,
            releaseId: operation.releaseId,
            workerId: this.options.workerId,
            expectedVersion: operation.version,
            attempt: operation.attempt,
            manifestRef: `tenant/${operation.tenantProfileId}/configuration.json`,
            revision: 1n,
            failureCode: provisioningFailure,
          });
        } catch {
          return true;
        }
        return true;
      }
      if (!identity) return true;
      let manifestRef = `tenant/${operation.tenantProfileId}/configuration.json`;
      let revision = 1n;
      try {
        const result = await this.configurationProvisioner.provision({
          tenantProfileId: operation.tenantProfileId,
          serverId: operation.serverId,
          releaseId: operation.releaseId,
          quotaMiB: operation.requestedCapacity.storageMiB,
          hostname: identityContext.hostname,
          identity,
        });
        manifestRef = result.manifestRef;
        revision = result.revision;
      } catch (error) {
        if (
          error instanceof TenantConfigurationProvisioningError &&
          error.reason === "UNAVAILABLE"
        ) {
          return true;
        }
        provisioningFailure =
          error instanceof TenantConfigurationProvisioningError &&
          error.reason === "PERMISSION_DENIED"
            ? "CONFIGURATION_PERMISSION_DENIED"
            : error instanceof TenantConfigurationProvisioningError &&
                error.reason === "TARGET_CONFLICT"
              ? "CONFIGURATION_TARGET_CONFLICT"
              : error instanceof TenantConfigurationProvisioningError &&
                  error.reason === "IDENTITY_MISMATCH"
                ? "CONFIGURATION_IDENTITY_MISMATCH"
                : "CONFIGURATION_UNAVAILABLE";
      }
      try {
        await this.repository.completeConfiguration({
          operationId: operation.id,
          tenantProfileId: operation.tenantProfileId,
          serverId: operation.serverId,
          releaseId: operation.releaseId,
          workerId: this.options.workerId,
          expectedVersion: operation.version,
          attempt: operation.attempt,
          manifestRef,
          revision,
          ...(provisioningFailure ? { failureCode: provisioningFailure } : {}),
        });
      } catch {
        return true;
      }
      return true;
    }
    if (operation.currentStep === "START_CONTAINERS" && this.containerProvisioner) {
      let provisioningFailure:
        | "CONTAINERS_TARGET_CONFLICT"
        | "CONTAINERS_PERMISSION_DENIED"
        | "CONTAINERS_IDENTITY_MISMATCH"
        | undefined;
      let result: Awaited<ReturnType<TenantContainerProvisioner["provision"]>> | undefined;
      try {
        result = await this.containerProvisioner.provision({
          operationId: operation.id,
          tenantProfileId: operation.tenantProfileId,
          serverId: operation.serverId,
          releaseId: operation.releaseId,
          manifestRef: `tenant/${operation.tenantProfileId}/configuration.json`,
          configurationRevision: 1n,
          attempt: operation.attempt,
        });
      } catch (error) {
        if (error instanceof TenantContainerProvisioningError && error.reason === "UNAVAILABLE") {
          return true;
        }
        provisioningFailure =
          error instanceof TenantContainerProvisioningError && error.reason === "PERMISSION_DENIED"
            ? "CONTAINERS_PERMISSION_DENIED"
            : error instanceof TenantContainerProvisioningError &&
                error.reason === "TARGET_CONFLICT"
              ? "CONTAINERS_TARGET_CONFLICT"
              : "CONTAINERS_IDENTITY_MISMATCH";
      }
      if (result) {
        if (!result.ready) return true;
        await this.repository.completeContainers({
          operationId: operation.id,
          tenantProfileId: operation.tenantProfileId,
          serverId: operation.serverId,
          releaseId: operation.releaseId,
          workerId: this.options.workerId,
          expectedVersion: operation.version,
          attempt: operation.attempt,
          manifestRef: `tenant/${operation.tenantProfileId}/configuration.json`,
          configurationRevision: 1n,
          projectName: result.projectName,
          services: result.services,
          ready: result.ready,
          reconciled: result.reconciled,
        });
        return true;
      }
      if (provisioningFailure) {
        await this.repository.completeContainers({
          operationId: operation.id,
          tenantProfileId: operation.tenantProfileId,
          serverId: operation.serverId,
          releaseId: operation.releaseId,
          workerId: this.options.workerId,
          expectedVersion: operation.version,
          attempt: operation.attempt,
          manifestRef: `tenant/${operation.tenantProfileId}/configuration.json`,
          configurationRevision: 1n,
          projectName: `qcrm-t-${operation.tenantProfileId}`,
          services: ["agent-runtime", "api", "crm-web", "portal-web", "worker"],
          ready: false,
          reconciled: false,
          failureCode: provisioningFailure,
        });
      }
      return true;
    }
    if (operation.currentStep === "CONFIGURE_HTTPS" && this.httpsRouteProvisioner) {
      let provisioningFailure:
        | "HTTPS_TARGET_CONFLICT"
        | "HTTPS_UNAVAILABLE"
        | "HTTPS_PERMISSION_DENIED"
        | "HTTPS_IDENTITY_MISMATCH"
        | undefined;
      const context = await this.repository.resolveHttpsContext({
        operationId: operation.id,
        tenantProfileId: operation.tenantProfileId,
        serverId: operation.serverId,
        releaseId: operation.releaseId,
        workerId: this.options.workerId,
        expectedVersion: operation.version,
        attempt: operation.attempt,
      });
      if (!context) return true;
      let result: Awaited<ReturnType<TenantHttpsRouteProvisioner["provision"]>> | undefined;
      try {
        result = await this.httpsRouteProvisioner.provision({
          operationId: operation.id,
          tenantProfileId: operation.tenantProfileId,
          serverId: operation.serverId,
          releaseId: operation.releaseId,
          hostname: context.hostname,
          edgeNetworkName: context.edgeNetworkName,
          upstreamServices: context.upstreamServices,
          configurationRevision: context.configurationRevision,
          attempt: operation.attempt,
        });
      } catch (error) {
        if (error instanceof TenantHttpsRouteProvisioningError && error.reason === "UNAVAILABLE") {
          return true;
        }
        provisioningFailure =
          error instanceof TenantHttpsRouteProvisioningError && error.reason === "PERMISSION_DENIED"
            ? "HTTPS_PERMISSION_DENIED"
            : error instanceof TenantHttpsRouteProvisioningError &&
                error.reason === "TARGET_CONFLICT"
              ? "HTTPS_TARGET_CONFLICT"
              : error instanceof TenantHttpsRouteProvisioningError &&
                  error.reason === "IDENTITY_MISMATCH"
                ? "HTTPS_IDENTITY_MISMATCH"
                : "HTTPS_UNAVAILABLE";
      }
      if (!result && !provisioningFailure) return true;
      if (result && !result.configured) return true;
      try {
        await this.repository.completeHttps({
          operationId: operation.id,
          tenantProfileId: operation.tenantProfileId,
          serverId: operation.serverId,
          releaseId: operation.releaseId,
          workerId: this.options.workerId,
          expectedVersion: operation.version,
          attempt: operation.attempt,
          hostname: result?.hostname ?? context.hostname,
          edgeNetworkName: result?.edgeNetworkName ?? context.edgeNetworkName,
          upstreamServices: context.upstreamServices,
          configurationRevision: context.configurationRevision,
          routeGeneration: result?.routeGeneration ?? context.configurationRevision,
          configured: result?.configured ?? false,
          reconciled: result?.reconciled ?? false,
          ...(provisioningFailure ? { failureCode: provisioningFailure } : {}),
        });
      } catch {
        return true;
      }
      return true;
    }
    if (
      operation.currentStep === "CREATE_ADMINISTRATOR" &&
      this.initialAdministratorProvisioner &&
      this.activationDeliveries
    ) {
      const context = await this.repository.resolveInitialAdministratorContext({
        operationId: operation.id,
        tenantProfileId: operation.tenantProfileId,
        workerId: this.options.workerId,
        expectedVersion: operation.version,
        attempt: operation.attempt,
      });
      if (!context) return true;
      try {
        const identity = await this.initialAdministratorProvisioner.reconcile({
          tenantProfileId: operation.tenantProfileId,
          displayName: context.displayName,
          email: context.email,
        });
        const existing = await this.activationDeliveries.findInitialAdministrator(operation.tenantProfileId);
        const administrator = await this.activationDeliveries.reconcileInitialAdministrator({
          tenantProfileId: operation.tenantProfileId,
          subject: identity.subject,
          expectedVersion: existing?.version ?? operation.version,
          now: new Date(),
        });
        if (!administrator) return true;
        await this.repository.completeInitialAdministrator({
          operationId: operation.id,
          tenantProfileId: operation.tenantProfileId,
          workerId: this.options.workerId,
          expectedVersion: operation.version,
          attempt: operation.attempt,
        });
      } catch (error) {
        if (error instanceof TenantInitialAdministratorProvisioningError) return true;
        return true;
      }
      return true;
    }
    if (operation.currentStep === "ACTIVATE" && this.activationDeliveries && this.iamBootstrap) {
      const administrator = await this.activationDeliveries.findInitialAdministrator(operation.tenantProfileId);
      if (!administrator?.subject || administrator.status !== "CONSUMED") return true;
      try {
        await this.iamBootstrap.bootstrap({
          tenantProfileId: operation.tenantProfileId,
          subject: administrator.subject,
          idempotencyKey: `iam-bootstrap:${operation.id}:${administrator.generation}`,
          correlationId: operation.id,
        });
        await this.repository.completeActivation({
          operationId: operation.id,
          tenantProfileId: operation.tenantProfileId,
          workerId: this.options.workerId,
          expectedVersion: operation.version,
          attempt: operation.attempt,
        });
      } catch (error) {
        if (error instanceof TenantIamBootstrapError) return true;
        return true;
      }
      return true;
    }
    if (
      operation.currentStep === "VERIFY" &&
      this.initialAdministratorProvisioner &&
      this.activationDeliveries
    ) {
      const administrator = await this.activationDeliveries.findInitialAdministrator(operation.tenantProfileId);
      if (!administrator?.subject || administrator.status !== "ACTIVATION_ISSUED") return true;
      try {
        const status = await this.initialAdministratorProvisioner.activationStatus({
          tenantProfileId: operation.tenantProfileId,
          administratorSubject: administrator.subject,
          generation: administrator.generation,
        });
        if (status !== "CONSUMED") return true;
        const consumed = await this.activationDeliveries.consumeInitialAdministrator({
          tenantProfileId: operation.tenantProfileId,
          subject: administrator.subject,
          generation: administrator.generation,
          now: new Date(),
        });
        if (!consumed) return true;
        await this.repository.completeVerification({
          operationId: operation.id,
          tenantProfileId: operation.tenantProfileId,
          workerId: this.options.workerId,
          expectedVersion: operation.version,
          attempt: operation.attempt,
        });
      } catch {
        return true;
      }
      return true;
    }
    if (operation.currentStep !== "CREATE_SECRETS" || !this.secretsProvisioner) return false;
    let provisioningFailure:
      | "SECRET_TARGET_CONFLICT"
      | "SECRET_PERMISSION_DENIED"
      | "SECRET_IDENTITY_MISMATCH"
      | undefined;
    let secrets: Awaited<ReturnType<TenantDatabaseSecretsProvisioner["provision"]>>["secrets"] =
      tenantDatabaseSecretKinds.map((kind) =>
        tenantDatabaseSecretReference(operation.tenantProfileId, kind),
      );
    try {
      const result = await this.secretsProvisioner.provision({
        tenantProfileId: operation.tenantProfileId,
        serverId: operation.serverId,
      });
      secrets = result.secrets;
    } catch (error) {
      if (
        error instanceof TenantDatabaseSecretsProvisioningError &&
        error.reason === "UNAVAILABLE"
      ) {
        return true;
      }
      provisioningFailure =
        error instanceof TenantDatabaseSecretsProvisioningError &&
        error.reason === "PERMISSION_DENIED"
          ? "SECRET_PERMISSION_DENIED"
          : error instanceof TenantDatabaseSecretsProvisioningError &&
              error.reason === "TARGET_CONFLICT"
            ? "SECRET_TARGET_CONFLICT"
            : "SECRET_IDENTITY_MISMATCH";
    }
    try {
      await this.repository.completeSecrets({
        operationId: operation.id,
        tenantProfileId: operation.tenantProfileId,
        workerId: this.options.workerId,
        expectedVersion: operation.version,
        attempt: operation.attempt,
        secrets,
        ...(provisioningFailure ? { failureCode: provisioningFailure } : {}),
      });
    } catch {
      return true;
    }
    return true;
  }
}
