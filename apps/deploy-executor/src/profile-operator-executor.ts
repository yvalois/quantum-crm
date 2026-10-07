import type { ProfileOperatorRepository } from "@quantum-crm/platform-domain";

import type { PlatformOperatorProvisioner } from "./platform-operator-provisioner.js";

export interface ProfileOperatorCallback {
  readonly deliver: (input: {
    readonly correlationId: string;
    readonly requestedByOperatorId: string;
    readonly assignmentId: string;
    readonly temporaryPassword: string;
  }) => Promise<{ readonly accepted: boolean }>;
}

export class ProfileOperatorExecutor {
  public constructor(
    private readonly repository: ProfileOperatorRepository,
    private readonly provisioner: PlatformOperatorProvisioner,
    private readonly callback: ProfileOperatorCallback,
    private readonly workerId: string,
  ) {}

  public async runOnce(): Promise<boolean> {
    const value = await this.repository.claimNext({
      workerId: this.workerId,
      leaseDurationSeconds: 60,
      now: new Date(),
    });
    if (!value) return false;
    try {
      const provisioned = await this.provisioner.provision({
        assignmentId: value.id,
        displayName: value.displayName,
        email: value.email,
      });
      const completed = await this.repository.complete({
        assignmentId: value.id,
        workerId: this.workerId,
        expectedVersion: value.version,
        oidcSubject: provisioned.subject,
        now: new Date(),
      });
      if (!completed) return true;
      await this.callback.deliver({
        correlationId: value.correlationId,
        requestedByOperatorId: value.requestedByOperatorId,
        assignmentId: value.id,
        temporaryPassword: provisioned.temporaryPassword,
      });
    } catch {
      await this.repository
        .fail({
          assignmentId: value.id,
          workerId: this.workerId,
          expectedVersion: value.version,
          now: new Date(),
        })
        .catch(() => undefined);
    }
    return true;
  }
}
