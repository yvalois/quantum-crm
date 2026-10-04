const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const keyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;

export const tenantReleasePromotionStatuses = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
] as const;
export type TenantReleasePromotionStatus = (typeof tenantReleasePromotionStatuses)[number];
export const tenantReleasePromotionSteps = [
  "VALIDATE",
  "MIGRATE",
  "RECONCILE",
  "VERIFY",
  "ACTIVATE",
] as const;
export type TenantReleasePromotionStep = (typeof tenantReleasePromotionSteps)[number];
export const tenantReleasePromotionFailureCodes = [
  "TENANT_STATE_INVALID",
  "RELEASE_NOT_VALIDATED",
  "TARGET_CONFLICT",
  "MIGRATION_FAILED",
  "RECONCILIATION_FAILED",
  "VERIFICATION_FAILED",
  "PERMISSION_DENIED",
  "UNAVAILABLE",
] as const;
export type TenantReleasePromotionFailureCode = (typeof tenantReleasePromotionFailureCodes)[number];

export interface TenantReleasePromotion {
  readonly id: string;
  readonly tenantProfileId: string;
  readonly previousReleaseId: string;
  readonly targetReleaseId: string;
  readonly requestedByOperatorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly status: TenantReleasePromotionStatus;
  readonly currentStep: TenantReleasePromotionStep;
  readonly attempt: number;
  readonly version: bigint;
  readonly failureCode: TenantReleasePromotionFailureCode | null;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RequestTenantReleasePromotionCommand {
  readonly id: string;
  readonly tenantProfileId: string;
  readonly targetReleaseId: string;
  readonly requestedByOperatorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly expectedTenantVersion: bigint;
}
export interface TenantReleasePromotionRequestResult {
  readonly promotion: TenantReleasePromotion;
  readonly tenantVersion: bigint;
  readonly idempotentReplay: boolean;
}
export interface ClaimTenantReleasePromotionCommand {
  readonly workerId: string;
  readonly leaseDurationSeconds: number;
}
export interface TenantReleasePromotionContext {
  readonly serverId: string;
  readonly quotaMiB: number;
  readonly configurationRevision: bigint;
}
export interface ResolveTenantReleasePromotionContextCommand {
  readonly id: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
}
export interface AdvanceTenantReleasePromotionCommand {
  readonly id: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
  readonly currentStep: TenantReleasePromotionStep;
  readonly nextStep: TenantReleasePromotionStep;
}
export interface CompleteTenantReleasePromotionCommand {
  readonly id: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
  readonly failureCode?: TenantReleasePromotionFailureCode;
}
export interface TenantReleasePromotionRepository {
  readonly request: (
    command: RequestTenantReleasePromotionCommand,
  ) => Promise<TenantReleasePromotionRequestResult>;
  readonly claimNext: (
    command: ClaimTenantReleasePromotionCommand,
  ) => Promise<TenantReleasePromotion | null>;
  readonly resolveContext: (
    command: ResolveTenantReleasePromotionContextCommand,
  ) => Promise<TenantReleasePromotionContext | null>;
  readonly advance: (
    command: AdvanceTenantReleasePromotionCommand,
  ) => Promise<TenantReleasePromotion | null>;
  readonly complete: (
    command: CompleteTenantReleasePromotionCommand,
  ) => Promise<TenantReleasePromotion | null>;
}
export class TenantReleasePromotionValidationError extends Error {
  public constructor(public readonly field: string) {
    super(`Invalid tenant release promotion field: ${field}`);
    this.name = "TenantReleasePromotionValidationError";
  }
}
export class TenantReleasePromotionConflictError extends Error {
  public constructor() {
    super("Tenant release promotion conflicts with existing state");
    this.name = "TenantReleasePromotionConflictError";
  }
}
function uuid(field: string, value: string): string {
  if (!uuidPattern.test(value)) throw new TenantReleasePromotionValidationError(field);
  return value;
}
function key(field: string, value: string): string {
  if (!keyPattern.test(value)) throw new TenantReleasePromotionValidationError(field);
  return value;
}
export function validateTenantReleasePromotionRequest(
  input: RequestTenantReleasePromotionCommand,
): RequestTenantReleasePromotionCommand {
  uuid("id", input.id);
  uuid("tenantProfileId", input.tenantProfileId);
  uuid("targetReleaseId", input.targetReleaseId);
  uuid("requestedByOperatorId", input.requestedByOperatorId);
  key("idempotencyKey", input.idempotencyKey);
  key("correlationId", input.correlationId);
  if (input.expectedTenantVersion < 1n)
    throw new TenantReleasePromotionValidationError("expectedTenantVersion");
  return Object.freeze({ ...input });
}
export function validateTenantReleasePromotionClaim(
  input: ClaimTenantReleasePromotionCommand,
): ClaimTenantReleasePromotionCommand {
  key("workerId", input.workerId);
  if (!Number.isInteger(input.leaseDurationSeconds) || input.leaseDurationSeconds < 1)
    throw new TenantReleasePromotionValidationError("leaseDurationSeconds");
  return Object.freeze({ ...input });
}
export function validateTenantReleasePromotionContext(
  input: ResolveTenantReleasePromotionContextCommand,
): ResolveTenantReleasePromotionContextCommand {
  uuid("id", input.id);
  key("workerId", input.workerId);
  if (input.expectedVersion < 1n)
    throw new TenantReleasePromotionValidationError("expectedVersion");
  if (!Number.isInteger(input.attempt) || input.attempt < 1)
    throw new TenantReleasePromotionValidationError("attempt");
  return Object.freeze({ ...input });
}
export function validateTenantReleasePromotionAdvance(
  input: AdvanceTenantReleasePromotionCommand,
): AdvanceTenantReleasePromotionCommand {
  uuid("id", input.id);
  key("workerId", input.workerId);
  if (input.expectedVersion < 1n)
    throw new TenantReleasePromotionValidationError("expectedVersion");
  if (!Number.isInteger(input.attempt) || input.attempt < 1)
    throw new TenantReleasePromotionValidationError("attempt");
  if (
    !tenantReleasePromotionSteps.includes(input.currentStep) ||
    !tenantReleasePromotionSteps.includes(input.nextStep)
  )
    throw new TenantReleasePromotionValidationError("step");
  const expectedNext: Record<TenantReleasePromotionStep, TenantReleasePromotionStep | null> = {
    VALIDATE: "MIGRATE",
    MIGRATE: "RECONCILE",
    RECONCILE: "VERIFY",
    VERIFY: "ACTIVATE",
    ACTIVATE: null,
  };
  if (expectedNext[input.currentStep] !== input.nextStep)
    throw new TenantReleasePromotionValidationError("step");
  return Object.freeze({ ...input });
}
export function validateTenantReleasePromotionCompletion(
  input: CompleteTenantReleasePromotionCommand,
): CompleteTenantReleasePromotionCommand {
  uuid("id", input.id);
  key("workerId", input.workerId);
  if (input.expectedVersion < 1n)
    throw new TenantReleasePromotionValidationError("expectedVersion");
  if (!Number.isInteger(input.attempt) || input.attempt < 1)
    throw new TenantReleasePromotionValidationError("attempt");
  if (
    input.failureCode !== undefined &&
    !tenantReleasePromotionFailureCodes.includes(input.failureCode)
  )
    throw new TenantReleasePromotionValidationError("failureCode");
  return Object.freeze({ ...input });
}

export class TenantReleasePromotionService {
  public constructor(private readonly repository: TenantReleasePromotionRepository) {}

  public request(
    command: RequestTenantReleasePromotionCommand,
  ): Promise<TenantReleasePromotionRequestResult> {
    return this.repository.request(validateTenantReleasePromotionRequest(command));
  }
}
