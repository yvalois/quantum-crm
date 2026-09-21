const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
const correlationIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;
const workerIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

export const provisioningOperationStatuses = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;
export type ProvisioningOperationStatus = (typeof provisioningOperationStatuses)[number];

export const provisioningOperationSteps = [
  "VALIDATE",
  "CREATE_DATABASE",
  "CREATE_SECRETS",
  "CREATE_STORAGE",
  "WRITE_CONFIGURATION",
  "START_CONTAINERS",
  "CONFIGURE_HTTPS",
  "CREATE_ADMINISTRATOR",
  "VERIFY",
  "ACTIVATE",
] as const;
export type ProvisioningOperationStep = (typeof provisioningOperationSteps)[number];

interface ProvisioningOperationIdentity {
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly releaseId: string;
  readonly requestedByOperatorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly requestedCapacity: ProvisioningCapacity;
}

export interface ProvisioningCapacity {
  readonly cpuMillicores: number;
  readonly memoryMiB: number;
  readonly storageMiB: number;
}

export interface CapacityReservation {
  readonly id: string;
  readonly capacity: ProvisioningCapacity;
}

export interface ProvisioningOperationDraft extends ProvisioningOperationIdentity {
  readonly status: "PENDING";
  readonly currentStep: "VALIDATE";
}

export interface ProvisioningOperationLease {
  readonly owner: string;
  readonly expiresAt: Date;
  readonly lastHeartbeatAt: Date;
}

export interface ProvisioningOperation extends ProvisioningOperationIdentity {
  readonly id: string;
  readonly status: ProvisioningOperationStatus;
  readonly currentStep: ProvisioningOperationStep;
  readonly attempt: number;
  readonly version: bigint;
  readonly lease: ProvisioningOperationLease | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly capacityReservation: CapacityReservation;
}

export interface RequestProvisioningCommand extends ProvisioningOperationIdentity {
  readonly expectedTenantVersion: bigint;
}

export interface ProvisioningRequestResult {
  readonly operation: ProvisioningOperation;
  readonly tenantVersion: bigint;
  readonly idempotentReplay: boolean;
}

export interface ClaimProvisioningOperationCommand {
  readonly workerId: string;
  readonly leaseDurationSeconds: number;
}

export interface RenewProvisioningOperationLeaseCommand extends ClaimProvisioningOperationCommand {
  readonly operationId: string;
  readonly expectedVersion: bigint;
}

export interface ProvisioningOperationRepository {
  readonly request: (command: RequestProvisioningCommand) => Promise<ProvisioningRequestResult>;
  readonly claimNext: (
    command: ClaimProvisioningOperationCommand,
  ) => Promise<ProvisioningOperation | null>;
  readonly renewLease: (
    command: RenewProvisioningOperationLeaseCommand,
  ) => Promise<ProvisioningOperation | null>;
}

export class ProvisioningOperationValidationError extends Error {
  public constructor(field: string) {
    super(`Invalid provisioning operation field: ${field}`);
    this.name = "ProvisioningOperationValidationError";
  }
}

export class ProvisioningOperationConflictError extends Error {
  public constructor() {
    super("Provisioning operation conflicts with existing state");
    this.name = "ProvisioningOperationConflictError";
  }
}

export class InfrastructureServerNotAdmissibleError extends Error {
  public constructor() {
    super("Infrastructure server is not available for admission");
    this.name = "InfrastructureServerNotAdmissibleError";
  }
}

export class InfrastructureCapacityExceededError extends Error {
  public constructor() {
    super("Infrastructure server has insufficient available capacity");
    this.name = "InfrastructureCapacityExceededError";
  }
}

function uuid(field: string, value: string): string {
  const normalized = value.toLowerCase();
  if (!uuidPattern.test(normalized)) throw new ProvisioningOperationValidationError(field);
  return normalized;
}

function validDate(field: string, value: Date): Date {
  if (Number.isNaN(value.getTime())) throw new ProvisioningOperationValidationError(field);
  return new Date(value.getTime());
}

function identity(input: ProvisioningOperationIdentity): ProvisioningOperationIdentity {
  if (!idempotencyKeyPattern.test(input.idempotencyKey)) {
    throw new ProvisioningOperationValidationError("idempotencyKey");
  }
  if (!correlationIdPattern.test(input.correlationId)) {
    throw new ProvisioningOperationValidationError("correlationId");
  }
  const requestedCapacity = provisioningCapacity(input.requestedCapacity);
  return Object.freeze({
    tenantProfileId: uuid("tenantProfileId", input.tenantProfileId),
    serverId: uuid("serverId", input.serverId),
    releaseId: uuid("releaseId", input.releaseId),
    requestedByOperatorId: uuid("requestedByOperatorId", input.requestedByOperatorId),
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    requestedCapacity,
  });
}

function provisioningCapacity(input: ProvisioningCapacity): ProvisioningCapacity {
  for (const [dimension, amount] of Object.entries(input)) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new ProvisioningOperationValidationError(`requestedCapacity.${dimension}`);
    }
  }
  return Object.freeze({ ...input });
}

export function validateProvisioningLeaseClaim(
  input: ClaimProvisioningOperationCommand,
): ClaimProvisioningOperationCommand {
  if (!workerIdPattern.test(input.workerId)) {
    throw new ProvisioningOperationValidationError("workerId");
  }
  if (
    !Number.isInteger(input.leaseDurationSeconds) ||
    input.leaseDurationSeconds < 10 ||
    input.leaseDurationSeconds > 300
  ) {
    throw new ProvisioningOperationValidationError("leaseDurationSeconds");
  }
  return Object.freeze({ ...input });
}

export function validateProvisioningLeaseRenewal(
  input: RenewProvisioningOperationLeaseCommand,
): RenewProvisioningOperationLeaseCommand {
  const claim = validateProvisioningLeaseClaim(input);
  if (input.expectedVersion < 1n) {
    throw new ProvisioningOperationValidationError("expectedVersion");
  }
  return Object.freeze({
    ...claim,
    operationId: uuid("operationId", input.operationId),
    expectedVersion: input.expectedVersion,
  });
}

export function createProvisioningOperationDraft(
  input: Omit<ProvisioningOperationDraft, "status" | "currentStep">,
): ProvisioningOperationDraft {
  return Object.freeze({
    ...identity(input),
    status: "PENDING",
    currentStep: "VALIDATE",
  });
}

export function hydrateProvisioningOperation(
  input: ProvisioningOperationIdentity & {
    readonly id: string;
    readonly status: ProvisioningOperationStatus;
    readonly currentStep: ProvisioningOperationStep;
    readonly attempt: number;
    readonly version: bigint;
    readonly lease: ProvisioningOperationLease | null;
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly capacityReservation: CapacityReservation;
  },
): ProvisioningOperation {
  if (!provisioningOperationStatuses.includes(input.status)) {
    throw new ProvisioningOperationValidationError("status");
  }
  if (!provisioningOperationSteps.includes(input.currentStep)) {
    throw new ProvisioningOperationValidationError("currentStep");
  }
  if (!Number.isInteger(input.attempt) || input.attempt < 0) {
    throw new ProvisioningOperationValidationError("attempt");
  }
  if (input.status === "RUNNING" && input.attempt < 1) {
    throw new ProvisioningOperationValidationError("attempt");
  }
  if (input.version < 1n) throw new ProvisioningOperationValidationError("version");
  if ((input.status === "RUNNING") !== (input.lease !== null)) {
    throw new ProvisioningOperationValidationError("lease");
  }

  const operationIdentity = identity(input);
  const createdAt = validDate("createdAt", input.createdAt);
  const updatedAt = validDate("updatedAt", input.updatedAt);
  if (updatedAt < createdAt) throw new ProvisioningOperationValidationError("updatedAt");

  let lease: ProvisioningOperationLease | null = null;
  if (input.lease) {
    if (!workerIdPattern.test(input.lease.owner)) {
      throw new ProvisioningOperationValidationError("lease.owner");
    }
    const expiresAt = validDate("lease.expiresAt", input.lease.expiresAt);
    const lastHeartbeatAt = validDate("lease.lastHeartbeatAt", input.lease.lastHeartbeatAt);
    if (lastHeartbeatAt > expiresAt) {
      throw new ProvisioningOperationValidationError("lease.lastHeartbeatAt");
    }
    lease = Object.freeze({ owner: input.lease.owner, expiresAt, lastHeartbeatAt });
  }

  const capacityReservation = Object.freeze({
    id: uuid("capacityReservation.id", input.capacityReservation.id),
    capacity: provisioningCapacity(input.capacityReservation.capacity),
  });

  return Object.freeze({
    ...operationIdentity,
    id: uuid("id", input.id),
    status: input.status,
    currentStep: input.currentStep,
    attempt: input.attempt,
    version: input.version,
    lease,
    createdAt,
    updatedAt,
    capacityReservation,
  });
}

export class TenantProvisioningService {
  public constructor(private readonly repository: ProvisioningOperationRepository) {}

  public request(command: RequestProvisioningCommand): Promise<ProvisioningRequestResult> {
    const draft = createProvisioningOperationDraft(command);
    if (command.expectedTenantVersion < 1n) {
      throw new ProvisioningOperationValidationError("expectedTenantVersion");
    }
    return this.repository.request({
      ...draft,
      expectedTenantVersion: command.expectedTenantVersion,
    });
  }
}
