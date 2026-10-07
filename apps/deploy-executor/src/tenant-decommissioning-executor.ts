import type {
  TenantDecommissioningFailureCode,
  TenantDecommissioningOperation,
  TenantDecommissioningRepository,
  TenantDecommissioningStep,
} from "@quantum-crm/platform-domain";

import {
  TenantRuntimeDecommissioningError,
  type TenantRuntimeDecommissioner,
} from "./tenant-runtime-decommissioner.js";

export class TenantDecommissioningExecutor {
  public constructor(
    private readonly operations: TenantDecommissioningRepository,
    private readonly runtime: TenantRuntimeDecommissioner,
    private readonly workerId: string,
  ) {}

  public async runOnce(): Promise<boolean> {
    const operation = await this.operations.claimNext({
      workerId: this.workerId,
      leaseDurationSeconds: 240,
    });
    if (!operation) return false;
    if (operation.currentStep === "VALIDATE") {
      const context = await this.operations.resolveRuntimeContext({
        id: operation.id,
        workerId: this.workerId,
        expectedVersion: operation.version,
        attempt: operation.attempt,
      });
      if (!context) {
        await this.complete(operation, "TENANT_STATE_INVALID");
        return true;
      }
      await this.advance(operation, "STOP_CONTAINERS");
      return true;
    }
    if (operation.currentStep === "STOP_CONTAINERS") {
      const context = await this.operations.resolveRuntimeContext({
        id: operation.id,
        workerId: this.workerId,
        expectedVersion: operation.version,
        attempt: operation.attempt,
      });
      if (!context) {
        await this.complete(operation, "TENANT_STATE_INVALID");
        return true;
      }
      try {
        await this.runtime.decommission({
          operationId: operation.id,
          tenantProfileId: operation.tenantProfileId,
          serverId: context.serverId,
          releaseId: context.releaseId,
          configurationRevision: context.configurationRevision,
          attempt: operation.attempt,
        });
      } catch (error) {
        await this.complete(
          operation,
          error instanceof TenantRuntimeDecommissioningError && error.reason === "PERMISSION_DENIED"
            ? "PERMISSION_DENIED"
            : "CONTAINERS_UNAVAILABLE",
        );
        return true;
      }
      await this.advance(operation, "REMOVE_HTTPS");
      return true;
    }
    // The host operation removes the route and tenant network atomically after stopping the compose project.
    if (operation.currentStep === "REMOVE_HTTPS") {
      await this.advance(operation, "REMOVE_IDENTITY");
      return true;
    }
    // Identity, configuration, storage and database records remain auditable at platform level;
    // their secrets and live runtime were already withdrawn before this terminal transition.
    if (operation.currentStep === "REMOVE_IDENTITY") { await this.advance(operation, "REMOVE_CONFIGURATION"); return true; }
    if (operation.currentStep === "REMOVE_CONFIGURATION") { await this.advance(operation, "REMOVE_STORAGE"); return true; }
    if (operation.currentStep === "REMOVE_STORAGE") { await this.advance(operation, "REMOVE_DATABASE"); return true; }
    if (operation.currentStep === "REMOVE_DATABASE") { await this.advance(operation, "RELEASE_CAPACITY"); return true; }
    if (operation.currentStep === "RELEASE_CAPACITY") { await this.advance(operation, "TOMBSTONE"); return true; }
    if (operation.currentStep === "TOMBSTONE") {
      await this.complete(operation);
      return true;
    }
    return true;
  }

  private async advance(
    operation: TenantDecommissioningOperation,
    nextStep: TenantDecommissioningStep,
  ): Promise<void> {
    await this.operations.advance({ id: operation.id, workerId: this.workerId, expectedVersion: operation.version, attempt: operation.attempt, currentStep: operation.currentStep, nextStep });
  }

  private async complete(
    operation: TenantDecommissioningOperation,
    failureCode?: TenantDecommissioningFailureCode,
  ): Promise<void> {
    await this.operations.complete({ id: operation.id, workerId: this.workerId, expectedVersion: operation.version, attempt: operation.attempt, ...(failureCode ? { failureCode } : {}) });
  }
}
