import {
  tenantDatabaseIdentity,
  type ProvisioningOperationRepository,
  type TenantDatabaseProvisioner,
} from "@quantum-crm/platform-domain";
import { TenantDatabaseProvisioningError } from "@quantum-crm/database";

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
      ? (["VALIDATE", "CREATE_DATABASE"] as const)
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
    if (operation.currentStep !== "CREATE_DATABASE" || !this.databaseProvisioner) return false;
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
}
