import type { ProfileOperatorRepository } from "@quantum-crm/platform-domain";

import type { TenantIamBootstrapClient } from "./tenant-iam-bootstrap-client.js";

export interface ProfileOperatorCallback {
  readonly deliver: (input: {
    readonly correlationId: string;
    readonly requestedByOperatorId: string;
    readonly assignmentId: string;
    readonly activationUrl: string;
    readonly temporaryPassword: string;
  }) => Promise<{ readonly accepted: boolean }>;
}

export class ProfileOperatorExecutor {
  public constructor(
    private readonly repository: ProfileOperatorRepository,
    private readonly tenantIam: Pick<TenantIamBootstrapClient, "createAdministrator">,
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
      const provisioned = await this.tenantIam.createAdministrator({
        tenantProfileId: value.tenantProfileId,
        displayName: value.displayName,
        email: value.email,
        idempotencyKey: value.id,
        correlationId: value.correlationId,
      });
      const completed = await this.repository.complete({
        assignmentId: value.id,
        workerId: this.workerId,
        expectedVersion: value.version,
        memberId: provisioned.memberId,
        oidcSubject: provisioned.subject,
        now: new Date(),
      });
      if (!completed) return true;
      await this.callback.deliver({
        correlationId: value.correlationId,
        requestedByOperatorId: value.requestedByOperatorId,
        assignmentId: value.id,
        activationUrl: provisioned.activationUrl,
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
