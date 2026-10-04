import type {
  PlatformReleaseRepository,
  TenantContainerProvisioner,
  TenantReleasePromotionRepository,
} from "@quantum-crm/platform-domain";

import {
  TenantReleaseConfigurationProvisioningError,
  type TenantReleaseConfigurationProvisioner,
} from "./tenant-release-configuration-provisioner.js";
import { TenantContainerProvisioningError } from "./tenant-container-provisioner.js";
import {
  TenantCrmMigrationProvisioningError,
  type TenantCrmMigrationProvisioner,
} from "./tenant-crm-migration-provisioner.js";

export interface TenantReleasePromotionExecutorOptions {
  readonly workerId: string;
  readonly leaseDurationSeconds: number;
}

export class TenantReleasePromotionExecutor {
  public constructor(
    private readonly promotions: TenantReleasePromotionRepository,
    private readonly releases: PlatformReleaseRepository,
    private readonly configuration: TenantReleaseConfigurationProvisioner,
    private readonly migration: TenantCrmMigrationProvisioner,
    private readonly containers: TenantContainerProvisioner,
    private readonly options: TenantReleasePromotionExecutorOptions,
  ) {}

  public async runOnce(): Promise<boolean> {
    const promotion = await this.promotions.claimNext(this.options);
    if (!promotion) return false;
    if (promotion.currentStep === "ACTIVATE") {
      await this.promotions.complete({
        id: promotion.id,
        workerId: this.options.workerId,
        expectedVersion: promotion.version,
        attempt: promotion.attempt,
      });
      return true;
    }
    const context = await this.promotions.resolveContext({
      id: promotion.id,
      workerId: this.options.workerId,
      expectedVersion: promotion.version,
      attempt: promotion.attempt,
    });
    if (!context) {
      await this.fail(promotion.id, promotion.version, promotion.attempt, "TENANT_STATE_INVALID");
      return true;
    }
    if (promotion.currentStep === "VALIDATE") {
      const release = await this.releases.findById(promotion.targetReleaseId);
      if (!release || release.status !== "VALIDATED") {
        await this.fail(
          promotion.id,
          promotion.version,
          promotion.attempt,
          "RELEASE_NOT_VALIDATED",
        );
        return true;
      }
      await this.promotions.advance({
        id: promotion.id,
        workerId: this.options.workerId,
        expectedVersion: promotion.version,
        attempt: promotion.attempt,
        currentStep: "VALIDATE",
        nextStep: "MIGRATE",
      });
      return true;
    }
    if (promotion.currentStep === "MIGRATE") {
      try {
        await this.configuration.provision({
          tenantProfileId: promotion.tenantProfileId,
          targetReleaseId: promotion.targetReleaseId,
          expectedRevision: context.configurationRevision,
        });
        await this.migration.migrate({
          operationId: promotion.id,
          tenantProfileId: promotion.tenantProfileId,
          serverId: context.serverId,
          releaseId: promotion.targetReleaseId,
          attempt: promotion.attempt,
        });
      } catch (error) {
        const failureCode =
          error instanceof TenantCrmMigrationProvisioningError && error.reason === "UNAVAILABLE"
            ? "UNAVAILABLE"
            : error instanceof TenantReleaseConfigurationProvisioningError &&
                error.reason === "PERMISSION_DENIED"
              ? "PERMISSION_DENIED"
              : error instanceof TenantReleaseConfigurationProvisioningError &&
                  error.reason === "UNAVAILABLE"
                ? "UNAVAILABLE"
                : "MIGRATION_FAILED";
        await this.fail(promotion.id, promotion.version, promotion.attempt, failureCode);
        return true;
      }
      await this.promotions.advance({
        id: promotion.id,
        workerId: this.options.workerId,
        expectedVersion: promotion.version,
        attempt: promotion.attempt,
        currentStep: "MIGRATE",
        nextStep: "RECONCILE",
      });
      return true;
    }
    if (promotion.currentStep === "RECONCILE" || promotion.currentStep === "VERIFY") {
      try {
        const observed = await this.containers.provision({
          operationId: promotion.id,
          tenantProfileId: promotion.tenantProfileId,
          serverId: context.serverId,
          releaseId: promotion.targetReleaseId,
          manifestRef: `tenant/${promotion.tenantProfileId}/configuration.json`,
          configurationRevision: context.configurationRevision,
          attempt: promotion.attempt,
        });
        if (!observed.ready || !observed.reconciled) {
          await this.fail(
            promotion.id,
            promotion.version,
            promotion.attempt,
            "VERIFICATION_FAILED",
          );
          return true;
        }
      } catch (error) {
        const failureCode =
          error instanceof TenantContainerProvisioningError && error.reason === "UNAVAILABLE"
            ? "UNAVAILABLE"
            : "RECONCILIATION_FAILED";
        await this.fail(promotion.id, promotion.version, promotion.attempt, failureCode);
        return true;
      }
      await this.promotions.advance({
        id: promotion.id,
        workerId: this.options.workerId,
        expectedVersion: promotion.version,
        attempt: promotion.attempt,
        currentStep: promotion.currentStep,
        nextStep: promotion.currentStep === "RECONCILE" ? "VERIFY" : "ACTIVATE",
      });
      return true;
    }
    return true;
  }

  private async fail(
    id: string,
    expectedVersion: bigint,
    attempt: number,
    failureCode:
      | "TENANT_STATE_INVALID"
      | "RELEASE_NOT_VALIDATED"
      | "MIGRATION_FAILED"
      | "RECONCILIATION_FAILED"
      | "VERIFICATION_FAILED"
      | "PERMISSION_DENIED"
      | "UNAVAILABLE",
  ): Promise<void> {
    await this.promotions
      .complete({
        id,
        workerId: this.options.workerId,
        expectedVersion,
        attempt,
        failureCode,
      })
      .catch(() => undefined);
  }
}
