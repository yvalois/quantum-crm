const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const keyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export const tenantDecommissioningStatuses = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export type TenantDecommissioningStatus = (typeof tenantDecommissioningStatuses)[number];

/**
 * Steps are intentionally destructive in dependency order. The executor must
 * persist each completed step before attempting the next one.
 */
export const tenantDecommissioningSteps = [
  "VALIDATE",
  "STOP_CONTAINERS",
  "REMOVE_HTTPS",
  "REMOVE_IDENTITY",
  "REMOVE_CONFIGURATION",
  "REMOVE_STORAGE",
  "REMOVE_DATABASE",
  "RELEASE_CAPACITY",
  "TOMBSTONE",
] as const;
export type TenantDecommissioningStep = (typeof tenantDecommissioningSteps)[number];

export const tenantDecommissioningFailureCodes = [
  "TENANT_STATE_INVALID",
  "TARGET_CONFLICT",
  "CONTAINERS_UNAVAILABLE",
  "HTTPS_UNAVAILABLE",
  "IDENTITY_UNAVAILABLE",
  "CONFIGURATION_UNAVAILABLE",
  "STORAGE_UNAVAILABLE",
  "DATABASE_UNAVAILABLE",
  "CAPACITY_ACCOUNTING_INVALID",
  "PERMISSION_DENIED",
] as const;
export type TenantDecommissioningFailureCode =
  (typeof tenantDecommissioningFailureCodes)[number];

export interface TenantDecommissioningOperation {
  readonly id: string;
  readonly tenantProfileId: string;
  readonly requestedByOperatorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly confirmationSlug: string;
  readonly status: TenantDecommissioningStatus;
  readonly currentStep: TenantDecommissioningStep;
  readonly attempt: number;
  readonly version: bigint;
  readonly failureCode: TenantDecommissioningFailureCode | null;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RequestTenantDecommissioningCommand {
  readonly tenantProfileId: string;
  readonly requestedByOperatorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly expectedTenantVersion: bigint;
  readonly confirmationSlug: string;
}

export interface TenantDecommissioningRequestResult {
  readonly operation: TenantDecommissioningOperation;
  readonly tenantVersion: bigint;
  readonly idempotentReplay: boolean;
}

export interface ClaimTenantDecommissioningCommand {
  readonly workerId: string;
  readonly leaseDurationSeconds: number;
}

export interface AdvanceTenantDecommissioningCommand {
  readonly id: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
  readonly currentStep: TenantDecommissioningStep;
  readonly nextStep: TenantDecommissioningStep;
}

export interface CompleteTenantDecommissioningCommand {
  readonly id: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
  readonly failureCode?: TenantDecommissioningFailureCode;
}

export interface TenantDecommissioningRuntimeContext {
  readonly serverId: string;
  readonly releaseId: string;
  readonly configurationRevision: bigint;
}

export interface TenantDecommissioningRepository {
  readonly request: (
    command: RequestTenantDecommissioningCommand,
  ) => Promise<TenantDecommissioningRequestResult>;
  readonly claimNext: (
    command: ClaimTenantDecommissioningCommand,
  ) => Promise<TenantDecommissioningOperation | null>;
  readonly resolveRuntimeContext: (command: {
    readonly id: string;
    readonly workerId: string;
    readonly expectedVersion: bigint;
    readonly attempt: number;
  }) => Promise<TenantDecommissioningRuntimeContext | null>;
  readonly advance: (
    command: AdvanceTenantDecommissioningCommand,
  ) => Promise<TenantDecommissioningOperation | null>;
  readonly complete: (
    command: CompleteTenantDecommissioningCommand,
  ) => Promise<TenantDecommissioningOperation | null>;
}

export class TenantDecommissioningValidationError extends Error {
  public constructor(public readonly field: string) {
    super(`Invalid tenant decommissioning field: ${field}`);
    this.name = "TenantDecommissioningValidationError";
  }
}

export class TenantDecommissioningConflictError extends Error {
  public constructor() {
    super("Tenant decommissioning conflicts with existing state");
    this.name = "TenantDecommissioningConflictError";
  }
}

function uuid(field: string, value: string): string {
  const normalized = value.toLowerCase();
  if (!uuidPattern.test(normalized)) throw new TenantDecommissioningValidationError(field);
  return normalized;
}

function key(field: string, value: string): string {
  if (!keyPattern.test(value)) throw new TenantDecommissioningValidationError(field);
  return value;
}

function version(field: string, value: bigint): bigint {
  if (value < 1n) throw new TenantDecommissioningValidationError(field);
  return value;
}

function attempt(value: number): number {
  if (!Number.isInteger(value) || value < 1)
    throw new TenantDecommissioningValidationError("attempt");
  return value;
}

export function validateTenantDecommissioningRequest(
  input: RequestTenantDecommissioningCommand,
): RequestTenantDecommissioningCommand {
  const confirmationSlug = input.confirmationSlug.trim().toLowerCase();
  uuid("tenantProfileId", input.tenantProfileId);
  uuid("requestedByOperatorId", input.requestedByOperatorId);
  key("idempotencyKey", input.idempotencyKey);
  key("correlationId", input.correlationId);
  version("expectedTenantVersion", input.expectedTenantVersion);
  if (!slugPattern.test(confirmationSlug))
    throw new TenantDecommissioningValidationError("confirmationSlug");
  return Object.freeze({ ...input, confirmationSlug });
}

export function validateTenantDecommissioningClaim(
  input: ClaimTenantDecommissioningCommand,
): ClaimTenantDecommissioningCommand {
  key("workerId", input.workerId);
  if (!Number.isInteger(input.leaseDurationSeconds) || input.leaseDurationSeconds < 1)
    throw new TenantDecommissioningValidationError("leaseDurationSeconds");
  return Object.freeze({ ...input });
}

const expectedNextStep: Readonly<
  Record<TenantDecommissioningStep, TenantDecommissioningStep | null>
> = Object.freeze({
  VALIDATE: "STOP_CONTAINERS",
  STOP_CONTAINERS: "REMOVE_HTTPS",
  REMOVE_HTTPS: "REMOVE_IDENTITY",
  REMOVE_IDENTITY: "REMOVE_CONFIGURATION",
  REMOVE_CONFIGURATION: "REMOVE_STORAGE",
  REMOVE_STORAGE: "REMOVE_DATABASE",
  REMOVE_DATABASE: "RELEASE_CAPACITY",
  RELEASE_CAPACITY: "TOMBSTONE",
  TOMBSTONE: null,
});

export function validateTenantDecommissioningAdvance(
  input: AdvanceTenantDecommissioningCommand,
): AdvanceTenantDecommissioningCommand {
  uuid("id", input.id);
  key("workerId", input.workerId);
  version("expectedVersion", input.expectedVersion);
  attempt(input.attempt);
  if (
    !tenantDecommissioningSteps.includes(input.currentStep) ||
    !tenantDecommissioningSteps.includes(input.nextStep) ||
    expectedNextStep[input.currentStep] !== input.nextStep
  ) {
    throw new TenantDecommissioningValidationError("step");
  }
  return Object.freeze({ ...input });
}

export function validateTenantDecommissioningCompletion(
  input: CompleteTenantDecommissioningCommand,
): CompleteTenantDecommissioningCommand {
  uuid("id", input.id);
  key("workerId", input.workerId);
  version("expectedVersion", input.expectedVersion);
  attempt(input.attempt);
  if (
    input.failureCode !== undefined &&
    !tenantDecommissioningFailureCodes.includes(input.failureCode)
  ) {
    throw new TenantDecommissioningValidationError("failureCode");
  }
  return Object.freeze({ ...input });
}

export class DecommissionTenantProfileService {
  public constructor(private readonly repository: TenantDecommissioningRepository) {}

  public request(
    command: RequestTenantDecommissioningCommand,
  ): Promise<TenantDecommissioningRequestResult> {
    return this.repository.request(validateTenantDecommissioningRequest(command));
  }
}
