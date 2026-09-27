import type { ActivationDeliveryRepository } from "@quantum-crm/platform-domain";

import type { TenantInitialAdministratorProvisioner } from "./tenant-initial-administrator-provisioner.js";

/** Private transport boundary.  The URL is intentionally scoped to this call and
 * must not be logged, queued, returned from a durable operation, or retried. */
export interface ActivationDeliveryCallback {
  readonly deliver: (input: {
    readonly intentId: string;
    readonly tenantProfileId: string;
    readonly operatorId: string;
    readonly generation: number;
    readonly correlationId: string;
    readonly url: string;
  }) => Promise<{ readonly accepted: boolean }>;
}

export class ActivationDeliveryExecutor {
  public constructor(
    private readonly deliveries: ActivationDeliveryRepository,
    private readonly provisioner: TenantInitialAdministratorProvisioner,
    private readonly callback: ActivationDeliveryCallback,
    private readonly workerId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async runOnce(): Promise<boolean> {
    const now = this.now();
    const intent = await this.deliveries.claimNext({
      workerId: this.workerId,
      leaseDurationSeconds: 60,
      now,
    });
    if (!intent) return false;
    let providerMayHaveIssued = false;
    try {
      // The provider is idempotent only for the current generation. Once the
      // issue call has started, a timeout is an unknown external result and it
      // is never safe to generate a replacement from this worker.
      providerMayHaveIssued = true;
      const issued = await this.provisioner.issueActivation({
        tenantProfileId: intent.tenantProfileId,
        administratorSubject: intent.administratorSubject,
        generation: intent.generation,
      });
      // An expiry mismatch is unsafe: the durable operation is the authority for
      // the display window, so do not expose it.  The provider may nevertheless
      // have issued it, therefore reserve this generation durably.
      if (
        new Date(issued.expiresAt).getTime() < now.getTime() ||
        new Date(issued.expiresAt).getTime() > intent.expiresAt.getTime() + 5_000
      ) {
        await this.deliveries.complete({
          intentId: intent.id,
          workerId: this.workerId,
          expectedVersion: intent.version,
          status: "DELIVERED",
          resultCode: "EXPIRED",
          now: this.now(),
        });
        return true;
      }
      const delivered = await this.callback.deliver({
        intentId: intent.id,
        tenantProfileId: intent.tenantProfileId,
        operatorId: intent.requestedByOperatorId,
        generation: intent.generation,
        correlationId: intent.correlationId,
        url: issued.url,
      });
      // A missing waiter is not proof that the URL was not exposed (the
      // callback can race request teardown), so the generation remains issued.
      await this.deliveries.complete({
        intentId: intent.id,
        workerId: this.workerId,
        expectedVersion: intent.version,
        status: "DELIVERED",
        resultCode: delivered.accepted ? "DELIVERED" : "WAITER_ABSENT",
        now: this.now(),
      });
      return true;
    } catch {
      if (!providerMayHaveIssued) return true;
      // An issue/callback timeout is not proof that no operator saw a link.
      // Reconcile the provider first, then make the attempt terminal. A fresh
      // operator request is required for a new generation; automatic retry may
      // otherwise revoke a link that could have been delivered.
      try {
        const status = await this.provisioner.activationStatus({
          tenantProfileId: intent.tenantProfileId,
          administratorSubject: intent.administratorSubject,
          generation: intent.generation,
        });
        // Do not move the administrator to CONSUMED here.  `VERIFY` must
        // observe that state separately and consumes only a DELIVERED intent.
        // The result code preserves whether Keycloak confirmed consumption.
        await this.deliveries.complete({
          intentId: intent.id,
          workerId: this.workerId,
          expectedVersion: intent.version,
          status: "DELIVERED",
          resultCode:
            status === "CONSUMED" ? "CONSUMED_AFTER_UNKNOWN_DELIVERY" : "UNKNOWN_DELIVERY",
          now: this.now(),
        });
      } catch {
        // The provider cannot be queried, but that is still not proof that it
        // did not issue. Reserve the generation rather than permit lease
        // recovery to call issueActivation again for it.
        await this.deliveries
          .complete({
            intentId: intent.id,
            workerId: this.workerId,
            expectedVersion: intent.version,
            status: "DELIVERED",
            resultCode: "RECONCILIATION_UNAVAILABLE",
            now: this.now(),
          })
          .catch(() => undefined);
      }
      return true;
    }
  }
}
