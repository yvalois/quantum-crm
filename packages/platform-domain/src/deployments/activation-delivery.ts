const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
const correlationIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

export const activationDeliveryStatuses = [
  "PENDING",
  "CLAIMED",
  "DELIVERED",
  "CONSUMED",
  "EXPIRED",
  "DISCARDED",
] as const;
export type ActivationDeliveryStatus = (typeof activationDeliveryStatuses)[number];
export const activationDeliveryResultCodes = [
  "DELIVERED",
  "CONSUMED",
  "WAITER_ABSENT",
  "EXPIRED",
  "UNKNOWN_DELIVERY",
  "CONSUMED_AFTER_UNKNOWN_DELIVERY",
  "RECONCILIATION_UNAVAILABLE",
] as const;
export type ActivationDeliveryResultCode = (typeof activationDeliveryResultCodes)[number];
export const activationDeliveryTtlMilliseconds = 30 * 60 * 1_000;

export interface ActivationDeliveryIntent {
  readonly id: string;
  readonly tenantProfileId: string;
  readonly requestedByOperatorId: string;
  readonly administratorSubject: string;
  readonly generation: number;
  readonly expiresAt: Date;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly status: ActivationDeliveryStatus;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly resultCode: ActivationDeliveryResultCode | null;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export const tenantInitialAdministratorStatuses = [
  "PENDING",
  "ACTIVATION_ISSUED",
  "CONSUMED",
] as const;
export type TenantInitialAdministratorStatus = (typeof tenantInitialAdministratorStatuses)[number];
export interface TenantInitialAdministrator {
  readonly tenantProfileId: string;
  readonly subject: string | null;
  readonly generation: number;
  readonly status: TenantInitialAdministratorStatus;
  readonly expiresAt: Date | null;
  readonly consumedAt: Date | null;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export interface RequestActivationDeliveryCommand {
  readonly id: string;
  readonly tenantProfileId: string;
  readonly requestedByOperatorId: string;
  readonly expectedTenantVersion: bigint;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly correlationId: string;
  readonly now: Date;
}
export interface ClaimActivationDeliveryCommand {
  readonly workerId: string;
  readonly leaseDurationSeconds: number;
  readonly now: Date;
}
export interface CompleteActivationDeliveryCommand {
  readonly intentId: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly status: "DELIVERED" | "DISCARDED" | "EXPIRED";
  readonly resultCode: ActivationDeliveryResultCode;
  readonly now: Date;
}
export interface ReconcileInitialAdministratorCommand {
  readonly tenantProfileId: string;
  readonly subject: string;
  readonly expectedVersion: bigint;
  readonly now: Date;
}
export interface ConsumeInitialAdministratorCommand {
  readonly tenantProfileId: string;
  readonly subject: string;
  readonly generation: number;
  readonly now: Date;
}
export interface ActivationDeliveryRepository {
  readonly request: (
    command: RequestActivationDeliveryCommand,
  ) => Promise<{ readonly intent: ActivationDeliveryIntent; readonly idempotentReplay: boolean }>;
  readonly claimNext: (
    command: ClaimActivationDeliveryCommand,
  ) => Promise<ActivationDeliveryIntent | null>;
  readonly complete: (
    command: CompleteActivationDeliveryCommand,
  ) => Promise<ActivationDeliveryIntent | null>;
  readonly reconcileInitialAdministrator: (
    command: ReconcileInitialAdministratorCommand,
  ) => Promise<TenantInitialAdministrator | null>;
  readonly findInitialAdministrator: (
    tenantProfileId: string,
  ) => Promise<TenantInitialAdministrator | null>;
  readonly consumeInitialAdministrator: (
    command: ConsumeInitialAdministratorCommand,
  ) => Promise<TenantInitialAdministrator | null>;
}
export class ActivationDeliveryValidationError extends Error {
  public constructor() {
    super("Invalid activation delivery intent");
    this.name = "ActivationDeliveryValidationError";
  }
}
function validDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
export function createActivationDeliveryIntent(
  input: Omit<
    ActivationDeliveryIntent,
    "status" | "version" | "updatedAt" | "leaseOwner" | "leaseExpiresAt" | "resultCode"
  >,
): ActivationDeliveryIntent {
  if (
    !uuidPattern.test(input.id) ||
    !uuidPattern.test(input.tenantProfileId) ||
    !uuidPattern.test(input.requestedByOperatorId) ||
    !validDate(input.createdAt) ||
    !validDate(input.expiresAt) ||
    input.administratorSubject.length < 1 ||
    input.administratorSubject.length > 255 ||
    !Number.isInteger(input.generation) ||
    input.generation < 1 ||
    !idempotencyKeyPattern.test(input.idempotencyKey) ||
    !correlationIdPattern.test(input.correlationId) ||
    !/^[0-9a-f]{64}$/u.test(input.payloadHash) ||
    input.expiresAt.getTime() - input.createdAt.getTime() !== activationDeliveryTtlMilliseconds
  )
    throw new ActivationDeliveryValidationError();
  return Object.freeze({
    ...input,
    status: "PENDING",
    leaseOwner: null,
    leaseExpiresAt: null,
    resultCode: null,
    version: 1n,
    updatedAt: input.createdAt,
  });
}
export function transitionActivationDelivery(
  intent: ActivationDeliveryIntent,
  status: Exclude<ActivationDeliveryStatus, "PENDING">,
  now: Date,
): ActivationDeliveryIntent {
  if (
    !validDate(now) ||
    !activationDeliveryStatuses.includes(status) ||
    (intent.status !== "PENDING" && intent.status !== "CLAIMED" && intent.status !== "DELIVERED")
  )
    throw new ActivationDeliveryValidationError();
  if (status === "CLAIMED" && intent.status !== "PENDING")
    throw new ActivationDeliveryValidationError();
  if ((status === "DELIVERED" || status === "DISCARDED") && intent.status !== "CLAIMED")
    throw new ActivationDeliveryValidationError();
  if (status === "CONSUMED" && intent.status !== "DELIVERED")
    throw new ActivationDeliveryValidationError();
  if (now > intent.expiresAt && status !== "EXPIRED") throw new ActivationDeliveryValidationError();
  return Object.freeze({ ...intent, status, version: intent.version + 1n, updatedAt: now });
}

/**
 * A worker may complete only the intent it currently owns.  `CONSUMED` is
 * deliberately absent here: consumption is observed later from Keycloak and
 * can only advance a durable `DELIVERED` intent.
 *
 * A provider call can time out after issuing a link.  Those outcomes remain
 * `DELIVERED` so the generation is durably reserved; `resultCode` tells the
 * operator whether the ephemeral hand-off was confirmed.  This prevents a
 * retry from issuing another credential for the same generation.
 */
export function completeActivationDelivery(
  intent: ActivationDeliveryIntent,
  completion: Pick<CompleteActivationDeliveryCommand, "status" | "resultCode">,
  now: Date,
): ActivationDeliveryIntent {
  if (intent.status !== "CLAIMED") throw new ActivationDeliveryValidationError();
  const valid =
    (completion.status === "DELIVERED" &&
      [
        "DELIVERED",
        "WAITER_ABSENT",
        "EXPIRED",
        "UNKNOWN_DELIVERY",
        "CONSUMED_AFTER_UNKNOWN_DELIVERY",
        "RECONCILIATION_UNAVAILABLE",
      ].includes(completion.resultCode)) ||
    (completion.status === "DISCARDED" &&
      ["WAITER_ABSENT", "EXPIRED"].includes(completion.resultCode)) ||
    (completion.status === "EXPIRED" && completion.resultCode === "EXPIRED");
  if (!valid) throw new ActivationDeliveryValidationError();
  return transitionActivationDelivery(intent, completion.status, now);
}

export function transitionTenantInitialAdministrator(
  administrator: TenantInitialAdministrator,
  status: Exclude<TenantInitialAdministratorStatus, "PENDING">,
  now: Date,
  expiresAt?: Date,
): TenantInitialAdministrator {
  if (
    !validDate(now) ||
    !tenantInitialAdministratorStatuses.includes(status) ||
    administrator.version < 1n
  )
    throw new ActivationDeliveryValidationError();
  if (
    status === "ACTIVATION_ISSUED" &&
    administrator.status !== "PENDING" &&
    administrator.status !== "ACTIVATION_ISSUED"
  )
    throw new ActivationDeliveryValidationError();
  if (
    status === "ACTIVATION_ISSUED" &&
    (!expiresAt ||
      !validDate(expiresAt) ||
      expiresAt.getTime() - now.getTime() !== activationDeliveryTtlMilliseconds)
  )
    throw new ActivationDeliveryValidationError();
  if (status === "CONSUMED" && administrator.status !== "ACTIVATION_ISSUED")
    throw new ActivationDeliveryValidationError();
  return Object.freeze({
    ...administrator,
    generation:
      status === "ACTIVATION_ISSUED" ? administrator.generation + 1 : administrator.generation,
    status,
    expiresAt: status === "ACTIVATION_ISSUED" ? (expiresAt ?? null) : administrator.expiresAt,
    consumedAt: status === "CONSUMED" ? now : administrator.consumedAt,
    version: administrator.version + 1n,
    updatedAt: now,
  });
}
