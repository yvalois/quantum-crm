import type { ProvisioningOperationRepository } from "@quantum-crm/platform-domain";

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
    const operation = await this.repository.claimNext({
      workerId: this.options.workerId,
      leaseDurationSeconds: this.options.leaseDurationSeconds,
      supportedSteps: ["VALIDATE"],
    });
    if (!operation) return false;
    await this.repository.completeValidation({
      operationId: operation.id,
      workerId: this.options.workerId,
      expectedVersion: operation.version,
      attempt: operation.attempt,
    });
    return true;
  }
}
