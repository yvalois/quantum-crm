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

export const provisioningValidationFailureCodes = [
  "TENANT_STATE_INVALID",
  "TENANT_PLACEMENT_MISMATCH",
  "SERVER_UNAVAILABLE",
  "RELEASE_NOT_VALIDATED",
  "RESERVATION_INVALID",
  "CAPACITY_ACCOUNTING_INVALID",
  "DATABASE_TARGET_CONFLICT",
  "DATABASE_UNAVAILABLE",
  "DATABASE_PERMISSION_DENIED",
  "DATABASE_IDENTITY_MISMATCH",
  "SECRET_TARGET_CONFLICT",
  "SECRET_UNAVAILABLE",
  "SECRET_PERMISSION_DENIED",
  "SECRET_IDENTITY_MISMATCH",
] as const;
export type ProvisioningValidationFailureCode = (typeof provisioningValidationFailureCodes)[number];

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
  readonly failureCode: ProvisioningValidationFailureCode | null;
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

interface ProvisioningOperationLeaseCommand {
  readonly workerId: string;
  readonly leaseDurationSeconds: number;
}

export interface ClaimProvisioningOperationCommand extends ProvisioningOperationLeaseCommand {
  readonly supportedSteps: readonly ProvisioningOperationStep[];
}

export interface RenewProvisioningOperationLeaseCommand extends ProvisioningOperationLeaseCommand {
  readonly operationId: string;
  readonly expectedVersion: bigint;
}

export interface CompleteProvisioningValidationCommand {
  readonly operationId: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
}

export interface CompleteProvisioningDatabaseCommand {
  readonly operationId: string;
  readonly tenantProfileId: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
  readonly databaseName: string;
  readonly migratorRoleName: string;
  readonly runtimeRoleName: string;
  readonly failureCode?: ProvisioningValidationFailureCode;
}

export const tenantDatabaseSecretKinds = ["MIGRATOR_PASSWORD", "RUNTIME_PASSWORD"] as const;
export type TenantDatabaseSecretKind = (typeof tenantDatabaseSecretKinds)[number];

export interface TenantDatabaseSecretReference {
  readonly kind: TenantDatabaseSecretKind;
  readonly secretRef: string;
  readonly version: bigint;
}

export interface CompleteProvisioningSecretsCommand {
  readonly operationId: string;
  readonly tenantProfileId: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
  readonly secrets: readonly TenantDatabaseSecretReference[];
  readonly failureCode?: ProvisioningValidationFailureCode;
}

export interface ProvisioningValidationResult {
  readonly operation: ProvisioningOperation;
  readonly tenantVersion: bigint;
  readonly outcome: "ADVANCED" | "FAILED";
  readonly failureCode: ProvisioningValidationFailureCode | null;
}

export interface TenantDatabaseIdentity {
  readonly databaseName: string;
  readonly migratorRoleName: string;
  readonly runtimeRoleName: string;
}

export interface TenantDatabaseProvisionCommand {
  readonly tenantProfileId: string;
  readonly serverId: string;
}

export interface TenantDatabaseProvisioningResult extends TenantDatabaseIdentity {
  readonly reconciled: boolean;
}

export interface TenantDatabaseProvisioner {
  readonly provision: (
    command: TenantDatabaseProvisionCommand,
  ) => Promise<TenantDatabaseProvisioningResult>;
}

export interface TenantDatabaseSecretsProvisionCommand {
  readonly tenantProfileId: string;
  readonly serverId: string;
}

export interface TenantDatabaseSecretsProvisioningResult {
  readonly secrets: readonly TenantDatabaseSecretReference[];
  readonly reconciled: boolean;
}

export interface TenantDatabaseSecretsProvisioner {
  readonly provision: (
    command: TenantDatabaseSecretsProvisionCommand,
  ) => Promise<TenantDatabaseSecretsProvisioningResult>;
}

export interface ProvisioningValidationSnapshot {
  readonly tenant: {
    readonly status: "PENDING" | "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "ERROR";
    readonly serverId: string | null;
    readonly releaseId: string | null;
  };
  readonly server: {
    readonly status: "AVAILABLE" | "DRAINING" | "UNAVAILABLE";
    readonly reservedCapacity: ProvisioningCapacity;
  };
  readonly release: { readonly status: "CANDIDATE" | "VALIDATED" | "RETIRED" };
  readonly reservation: {
    readonly tenantProfileId: string;
    readonly serverId: string;
    readonly releaseId: string;
    readonly status: "RESERVED" | "ACTIVE" | "RELEASED";
    readonly capacity: ProvisioningCapacity;
  };
}

export interface ProvisioningOperationRepository {
  readonly request: (command: RequestProvisioningCommand) => Promise<ProvisioningRequestResult>;
  readonly claimNext: (
    command: ClaimProvisioningOperationCommand,
  ) => Promise<ProvisioningOperation | null>;
  readonly renewLease: (
    command: RenewProvisioningOperationLeaseCommand,
  ) => Promise<ProvisioningOperation | null>;
  readonly completeValidation: (
    command: CompleteProvisioningValidationCommand,
  ) => Promise<ProvisioningValidationResult | null>;
  readonly completeDatabase: (
    command: CompleteProvisioningDatabaseCommand,
  ) => Promise<ProvisioningValidationResult | null>;
  readonly completeSecrets: (
    command: CompleteProvisioningSecretsCommand,
  ) => Promise<ProvisioningValidationResult | null>;
}

export function tenantDatabaseIdentity(tenantProfileId: string): TenantDatabaseIdentity {
  const normalized = uuid("tenantProfileId", tenantProfileId);
  const compact = normalized.replaceAll("-", "");
  return Object.freeze({
    databaseName: `qcrm_t_${compact}`,
    migratorRoleName: `qcrm_m_${compact}`,
    runtimeRoleName: `qcrm_r_${compact}`,
  });
}

export function tenantDatabaseSecretReference(
  tenantProfileId: string,
  kind: TenantDatabaseSecretKind,
): TenantDatabaseSecretReference {
  const normalized = uuid("tenantProfileId", tenantProfileId);
  if (!tenantDatabaseSecretKinds.includes(kind)) {
    throw new ProvisioningOperationValidationError("secret.kind");
  }
  const fileName = kind === "MIGRATOR_PASSWORD" ? "migrator-password" : "runtime-password";
  return Object.freeze({
    kind,
    secretRef: `tenant/${normalized}/${fileName}`,
    version: 1n,
  });
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
  if (
    input.supportedSteps.length === 0 ||
    new Set(input.supportedSteps).size !== input.supportedSteps.length ||
    input.supportedSteps.some((step) => !provisioningOperationSteps.includes(step))
  ) {
    throw new ProvisioningOperationValidationError("supportedSteps");
  }
  return Object.freeze({ ...input, supportedSteps: Object.freeze([...input.supportedSteps]) });
}

export function validateProvisioningLeaseRenewal(
  input: RenewProvisioningOperationLeaseCommand,
): RenewProvisioningOperationLeaseCommand {
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
  if (input.expectedVersion < 1n) {
    throw new ProvisioningOperationValidationError("expectedVersion");
  }
  return Object.freeze({
    workerId: input.workerId,
    leaseDurationSeconds: input.leaseDurationSeconds,
    operationId: uuid("operationId", input.operationId),
    expectedVersion: input.expectedVersion,
  });
}

export function validateCompleteProvisioningValidation(
  input: CompleteProvisioningValidationCommand,
): CompleteProvisioningValidationCommand {
  if (!workerIdPattern.test(input.workerId)) {
    throw new ProvisioningOperationValidationError("workerId");
  }
  if (input.expectedVersion < 1n) {
    throw new ProvisioningOperationValidationError("expectedVersion");
  }
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new ProvisioningOperationValidationError("attempt");
  }
  return Object.freeze({
    operationId: uuid("operationId", input.operationId),
    workerId: input.workerId,
    expectedVersion: input.expectedVersion,
    attempt: input.attempt,
  });
}

export function validateCompleteProvisioningDatabase(
  input: CompleteProvisioningDatabaseCommand,
): CompleteProvisioningDatabaseCommand {
  const identity = tenantDatabaseIdentity(input.tenantProfileId);
  if (
    input.databaseName !== identity.databaseName ||
    input.migratorRoleName !== identity.migratorRoleName ||
    input.runtimeRoleName !== identity.runtimeRoleName
  ) {
    throw new ProvisioningOperationValidationError("databaseIdentity");
  }
  if (!workerIdPattern.test(input.workerId)) {
    throw new ProvisioningOperationValidationError("workerId");
  }
  if (input.expectedVersion < 1n) {
    throw new ProvisioningOperationValidationError("expectedVersion");
  }
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new ProvisioningOperationValidationError("attempt");
  }
  if (input.failureCode && !provisioningValidationFailureCodes.includes(input.failureCode)) {
    throw new ProvisioningOperationValidationError("failureCode");
  }
  return Object.freeze({
    operationId: uuid("operationId", input.operationId),
    tenantProfileId: uuid("tenantProfileId", input.tenantProfileId),
    workerId: input.workerId,
    expectedVersion: input.expectedVersion,
    attempt: input.attempt,
    databaseName: input.databaseName,
    migratorRoleName: input.migratorRoleName,
    runtimeRoleName: input.runtimeRoleName,
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
  });
}

export function validateCompleteProvisioningSecrets(
  input: CompleteProvisioningSecretsCommand,
): CompleteProvisioningSecretsCommand {
  if (!workerIdPattern.test(input.workerId)) {
    throw new ProvisioningOperationValidationError("workerId");
  }
  if (input.expectedVersion < 1n) {
    throw new ProvisioningOperationValidationError("expectedVersion");
  }
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new ProvisioningOperationValidationError("attempt");
  }
  const expected = tenantDatabaseSecretKinds.map((kind) =>
    tenantDatabaseSecretReference(input.tenantProfileId, kind),
  );
  if (
    input.secrets.length !== expected.length ||
    input.secrets.some(
      (secret) =>
        !expected.some(
          (candidate) =>
            candidate.kind === secret.kind &&
            candidate.secretRef === secret.secretRef &&
            candidate.version === secret.version,
        ),
    )
  ) {
    throw new ProvisioningOperationValidationError("secrets");
  }
  if (input.failureCode && !provisioningValidationFailureCodes.includes(input.failureCode)) {
    throw new ProvisioningOperationValidationError("failureCode");
  }
  return Object.freeze({
    operationId: uuid("operationId", input.operationId),
    tenantProfileId: uuid("tenantProfileId", input.tenantProfileId),
    workerId: input.workerId,
    expectedVersion: input.expectedVersion,
    attempt: input.attempt,
    secrets: Object.freeze(input.secrets.map((secret) => Object.freeze({ ...secret }))),
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
  });
}

function sameCapacity(left: ProvisioningCapacity, right: ProvisioningCapacity): boolean {
  return (
    left.cpuMillicores === right.cpuMillicores &&
    left.memoryMiB === right.memoryMiB &&
    left.storageMiB === right.storageMiB
  );
}

export function evaluateProvisioningValidation(
  operation: ProvisioningOperation,
  snapshot: ProvisioningValidationSnapshot,
): ProvisioningValidationFailureCode | null {
  if (snapshot.tenant.status !== "PROVISIONING") return "TENANT_STATE_INVALID";
  if (
    snapshot.tenant.serverId !== operation.serverId ||
    snapshot.tenant.releaseId !== operation.releaseId
  ) {
    return "TENANT_PLACEMENT_MISMATCH";
  }
  if (snapshot.server.status !== "AVAILABLE") return "SERVER_UNAVAILABLE";
  if (snapshot.release.status !== "VALIDATED") return "RELEASE_NOT_VALIDATED";
  if (
    snapshot.reservation.status !== "RESERVED" ||
    snapshot.reservation.tenantProfileId !== operation.tenantProfileId ||
    snapshot.reservation.serverId !== operation.serverId ||
    snapshot.reservation.releaseId !== operation.releaseId ||
    !sameCapacity(snapshot.reservation.capacity, operation.requestedCapacity)
  ) {
    return "RESERVATION_INVALID";
  }
  if (
    snapshot.server.reservedCapacity.cpuMillicores < operation.requestedCapacity.cpuMillicores ||
    snapshot.server.reservedCapacity.memoryMiB < operation.requestedCapacity.memoryMiB ||
    snapshot.server.reservedCapacity.storageMiB < operation.requestedCapacity.storageMiB
  ) {
    return "CAPACITY_ACCOUNTING_INVALID";
  }
  return null;
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
    readonly failureCode?: ProvisioningValidationFailureCode | null;
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
  const failureCode = input.failureCode ?? null;
  if (
    failureCode !== null &&
    (input.status !== "FAILED" || !provisioningValidationFailureCodes.includes(failureCode))
  ) {
    throw new ProvisioningOperationValidationError("failureCode");
  }
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
    failureCode,
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
