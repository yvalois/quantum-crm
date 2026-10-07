import type { TenantHttpsUpstreamServiceName } from "./tenant-https-route.js";
import type { TenantOidcIdentity } from "./tenant-oidc-identity.js";
import type { InfrastructureServerRepository } from "../infrastructure/infrastructure-server-service.js";
import {
  PlatformReleaseNotDeployableError,
  type PlatformReleaseRepository,
} from "../releases/platform-release-service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
const correlationIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;
const workerIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;
const configurationRefPattern = /^tenant\/[0-9a-f-]{36}\/configuration\.json$/u;
const cancellationReasonControlPattern = /\p{Cc}+/gu;

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
  "MIGRATE_DATABASE",
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
  "MIGRATION_TARGET_CONFLICT",
  "MIGRATION_UNAVAILABLE",
  "MIGRATION_PERMISSION_DENIED",
  "MIGRATION_IDENTITY_MISMATCH",
  "SECRET_TARGET_CONFLICT",
  "SECRET_UNAVAILABLE",
  "SECRET_PERMISSION_DENIED",
  "SECRET_IDENTITY_MISMATCH",
  "STORAGE_TARGET_CONFLICT",
  "STORAGE_UNAVAILABLE",
  "STORAGE_PERMISSION_DENIED",
  "STORAGE_IDENTITY_MISMATCH",
  "CONFIGURATION_TARGET_CONFLICT",
  "CONFIGURATION_UNAVAILABLE",
  "CONFIGURATION_PERMISSION_DENIED",
  "CONFIGURATION_IDENTITY_MISMATCH",
  "CONTAINERS_TARGET_CONFLICT",
  "CONTAINERS_UNAVAILABLE",
  "CONTAINERS_PERMISSION_DENIED",
  "CONTAINERS_IDENTITY_MISMATCH",
  "HTTPS_TARGET_CONFLICT",
  "HTTPS_UNAVAILABLE",
  "HTTPS_PERMISSION_DENIED",
  "HTTPS_IDENTITY_MISMATCH",
  "IDENTITY_TARGET_CONFLICT",
  "IDENTITY_UNAVAILABLE",
  "IDENTITY_PERMISSION_DENIED",
  "IDENTITY_IDENTITY_MISMATCH",
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

export interface ProvisioningOperationCancellation {
  readonly cancelledByOperatorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly reason: string;
  readonly expectedVersion: bigint;
  readonly tenantVersion: bigint;
  readonly result: "CANCELLED";
  readonly cancelledAt: Date;
}

export interface ProvisioningOperation extends ProvisioningOperationIdentity {
  readonly id: string;
  readonly status: ProvisioningOperationStatus;
  readonly currentStep: ProvisioningOperationStep;
  readonly attempt: number;
  readonly version: bigint;
  readonly failureCode: ProvisioningValidationFailureCode | null;
  readonly lease: ProvisioningOperationLease | null;
  readonly cancellation: ProvisioningOperationCancellation | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly capacityReservation: CapacityReservation;
}

export interface RequestProvisioningCommand extends ProvisioningOperationIdentity {
  readonly expectedTenantVersion: bigint;
}

export interface RequestAutomaticProvisioningCommand {
  readonly tenantProfileId: string;
  readonly requestedByOperatorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly expectedTenantVersion: bigint;
}

/** Baseline aislado para un CRM nuevo; la plataforma, no el operador, lo reserva. */
export const automaticTenantProvisioningCapacity: ProvisioningCapacity = Object.freeze({
  cpuMillicores: 500,
  memoryMiB: 1024,
  storageMiB: 10_240,
});

export interface ProvisioningRequestResult {
  readonly operation: ProvisioningOperation;
  readonly tenantVersion: bigint;
  readonly idempotentReplay: boolean;
}

export interface CancelProvisioningOperationCommand {
  readonly tenantProfileId: string;
  readonly operationId: string;
  readonly requestedByOperatorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly reason: string;
  readonly expectedVersion: bigint;
}

export interface ProvisioningCancellationResult {
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

export interface CompleteProvisioningMigrationCommand {
  readonly operationId: string;
  readonly tenantProfileId: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
  readonly failureCode?: ProvisioningValidationFailureCode;
}

export const tenantStorageSecretKinds = ["ACCESS_KEY", "SECRET_KEY"] as const;
export type TenantStorageSecretKind = (typeof tenantStorageSecretKinds)[number];

export interface TenantStorageSecretReference {
  readonly kind: TenantStorageSecretKind;
  readonly secretRef: string;
  readonly version: bigint;
}

export interface TenantStorageBucketReference {
  readonly kind: "INCOMING" | "OBJECTS";
  readonly bucketName: string;
  readonly quotaMiB: number;
  readonly versioning: "ENABLED";
}

export interface CompleteProvisioningStorageCommand {
  readonly operationId: string;
  readonly tenantProfileId: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
  readonly quotaMiB: number;
  readonly buckets: readonly TenantStorageBucketReference[];
  readonly secrets: readonly TenantStorageSecretReference[];
  readonly failureCode?: ProvisioningValidationFailureCode;
}

export interface CompleteProvisioningConfigurationCommand {
  readonly operationId: string;
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly releaseId: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
  readonly manifestRef: string;
  readonly revision: bigint;
  readonly failureCode?: ProvisioningValidationFailureCode;
}

export const tenantContainerServiceNames = [
  "crm-web",
  "portal-web",
  "api",
  "worker",
  "agent-runtime",
] as const;

export type TenantContainerServiceName = (typeof tenantContainerServiceNames)[number];

export interface CompleteProvisioningContainersCommand {
  readonly operationId: string;
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly releaseId: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
  readonly manifestRef: string;
  readonly configurationRevision: bigint;
  readonly projectName: string;
  readonly services: readonly TenantContainerServiceName[];
  readonly ready: boolean;
  readonly reconciled: boolean;
  readonly failureCode?: ProvisioningValidationFailureCode;
}

export interface CompleteProvisioningHttpsCommand {
  readonly operationId: string;
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly releaseId: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
  readonly hostname: string;
  readonly edgeNetworkName: string;
  readonly upstreamServices: readonly TenantHttpsUpstreamServiceName[];
  readonly configurationRevision: bigint;
  readonly routeGeneration: bigint;
  readonly configured: boolean;
  readonly reconciled: boolean;
  readonly failureCode?: ProvisioningValidationFailureCode;
}

export interface ResolveProvisioningHttpsContextCommand {
  readonly operationId: string;
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly releaseId: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
}

export interface ProvisioningHttpsContext {
  readonly hostname: string;
  readonly edgeNetworkName: string;
  readonly upstreamServices: readonly TenantHttpsUpstreamServiceName[];
  readonly configurationRevision: bigint;
}

export interface ResolveProvisioningIdentityContextCommand {
  readonly operationId: string;
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly releaseId: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
}

export interface ProvisioningIdentityContext {
  readonly hostname: string;
}

export interface ProvisioningInitialAdministratorContext {
  readonly displayName: string;
  readonly email: string;
}

export interface ResolveProvisioningInitialAdministratorContextCommand {
  readonly operationId: string;
  readonly tenantProfileId: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
}

export interface CompleteProvisioningInitialAdministratorCommand {
  readonly operationId: string;
  readonly tenantProfileId: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
}

export interface CompleteProvisioningVerificationCommand extends CompleteProvisioningInitialAdministratorCommand {}
export interface CompleteProvisioningActivationCommand extends CompleteProvisioningInitialAdministratorCommand {}

export interface TenantStorageProvisioningCommand {
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly quotaMiB: number;
}

export interface TenantStorageProvisioningResult {
  readonly buckets: readonly TenantStorageBucketReference[];
  readonly secrets: readonly TenantStorageSecretReference[];
  readonly reconciled: boolean;
}

export interface TenantStorageProvisioner {
  readonly provision: (
    command: TenantStorageProvisioningCommand,
  ) => Promise<TenantStorageProvisioningResult>;
}

export interface TenantConfigurationProvisioningCommand {
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly releaseId: string;
  readonly quotaMiB: number;
  readonly hostname: string;
  readonly identity: TenantOidcIdentity;
}

export interface TenantConfigurationProvisioningResult {
  readonly manifestRef: string;
  readonly revision: bigint;
  readonly reconciled: boolean;
}

export interface TenantConfigurationProvisioner {
  readonly provision: (
    command: TenantConfigurationProvisioningCommand,
  ) => Promise<TenantConfigurationProvisioningResult>;
}

export interface TenantContainerProvisioningCommand {
  readonly operationId: string;
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly releaseId: string;
  readonly manifestRef: string;
  readonly configurationRevision: bigint;
  readonly attempt: number;
}

export interface TenantContainerProvisioningResult {
  readonly projectName: string;
  readonly services: readonly TenantContainerServiceName[];
  readonly ready: boolean;
  readonly reconciled: boolean;
}

export interface TenantContainerProvisioner {
  readonly provision: (
    command: TenantContainerProvisioningCommand,
  ) => Promise<TenantContainerProvisioningResult>;
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
    readonly status:
      "PENDING" | "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "ERROR" | "DECOMMISSIONING" | "DELETED";
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

export interface ProvisioningOperationCancellationRepository {
  readonly cancel: (
    command: CancelProvisioningOperationCommand,
  ) => Promise<ProvisioningCancellationResult>;
}

export interface ProvisioningOperationRepository {
  readonly request: (command: RequestProvisioningCommand) => Promise<ProvisioningRequestResult>;
  readonly findLatestByTenantProfileId: (
    tenantProfileId: string,
  ) => Promise<ProvisioningOperation | null>;
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
  readonly completeMigration: (
    command: CompleteProvisioningMigrationCommand,
  ) => Promise<ProvisioningValidationResult | null>;
  readonly completeStorage: (
    command: CompleteProvisioningStorageCommand,
  ) => Promise<ProvisioningValidationResult | null>;
  readonly completeConfiguration: (
    command: CompleteProvisioningConfigurationCommand,
  ) => Promise<ProvisioningValidationResult | null>;
  readonly completeContainers: (
    command: CompleteProvisioningContainersCommand,
  ) => Promise<ProvisioningValidationResult | null>;
  readonly completeHttps: (
    command: CompleteProvisioningHttpsCommand,
  ) => Promise<ProvisioningValidationResult | null>;
  readonly resolveHttpsContext: (
    command: ResolveProvisioningHttpsContextCommand,
  ) => Promise<ProvisioningHttpsContext | null>;
  readonly resolveIdentityContext: (
    command: ResolveProvisioningIdentityContextCommand,
  ) => Promise<ProvisioningIdentityContext | null>;
  readonly resolveInitialAdministratorContext: (
    command: ResolveProvisioningInitialAdministratorContextCommand,
  ) => Promise<ProvisioningInitialAdministratorContext | null>;
  readonly completeInitialAdministrator: (
    command: CompleteProvisioningInitialAdministratorCommand,
  ) => Promise<ProvisioningOperation | null>;
  readonly completeVerification: (
    command: CompleteProvisioningVerificationCommand,
  ) => Promise<ProvisioningOperation | null>;
  readonly completeActivation: (
    command: CompleteProvisioningActivationCommand,
  ) => Promise<ProvisioningOperation | null>;
}

function validateFinalProvisioningStep(
  input: CompleteProvisioningInitialAdministratorCommand,
): CompleteProvisioningInitialAdministratorCommand {
  uuid("operationId", input.operationId);
  uuid("tenantProfileId", input.tenantProfileId);
  if (!workerIdPattern.test(input.workerId))
    throw new ProvisioningOperationValidationError("workerId");
  if (input.expectedVersion < 1n) throw new ProvisioningOperationValidationError("expectedVersion");
  if (!Number.isInteger(input.attempt) || input.attempt < 1)
    throw new ProvisioningOperationValidationError("attempt");
  return Object.freeze({ ...input });
}

export function validateResolveProvisioningInitialAdministratorContext(
  input: ResolveProvisioningInitialAdministratorContextCommand,
): ResolveProvisioningInitialAdministratorContextCommand {
  return validateFinalProvisioningStep(input);
}

export function validateCompleteProvisioningInitialAdministrator(
  input: CompleteProvisioningInitialAdministratorCommand,
): CompleteProvisioningInitialAdministratorCommand {
  return validateFinalProvisioningStep(input);
}

export function validateCompleteProvisioningVerification(
  input: CompleteProvisioningVerificationCommand,
): CompleteProvisioningVerificationCommand {
  return validateFinalProvisioningStep(input);
}

export function validateCompleteProvisioningActivation(
  input: CompleteProvisioningActivationCommand,
): CompleteProvisioningActivationCommand {
  return validateFinalProvisioningStep(input);
}

export function validateResolveProvisioningIdentityContext(
  input: ResolveProvisioningIdentityContextCommand,
): ResolveProvisioningIdentityContextCommand {
  uuid("operationId", input.operationId);
  uuid("tenantProfileId", input.tenantProfileId);
  uuid("serverId", input.serverId);
  uuid("releaseId", input.releaseId);
  if (!workerIdPattern.test(input.workerId)) {
    throw new ProvisioningOperationValidationError("workerId");
  }
  if (input.expectedVersion < 1n) {
    throw new ProvisioningOperationValidationError("expectedVersion");
  }
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new ProvisioningOperationValidationError("attempt");
  }
  return Object.freeze({ ...input });
}

export function validateResolveProvisioningHttpsContext(
  input: ResolveProvisioningHttpsContextCommand,
): ResolveProvisioningHttpsContextCommand {
  uuid("operationId", input.operationId);
  uuid("tenantProfileId", input.tenantProfileId);
  uuid("serverId", input.serverId);
  uuid("releaseId", input.releaseId);
  if (!workerIdPattern.test(input.workerId)) {
    throw new ProvisioningOperationValidationError("workerId");
  }
  if (input.expectedVersion < 1n) {
    throw new ProvisioningOperationValidationError("expectedVersion");
  }
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new ProvisioningOperationValidationError("attempt");
  }
  return Object.freeze({ ...input });
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

export function tenantStorageBucketReference(
  tenantProfileId: string,
  kind: TenantStorageBucketReference["kind"],
  quotaMiB: number,
): TenantStorageBucketReference {
  const normalized = uuid("tenantProfileId", tenantProfileId);
  if (kind !== "INCOMING" && kind !== "OBJECTS") {
    throw new ProvisioningOperationValidationError("storage.bucket.kind");
  }
  if (!Number.isInteger(quotaMiB) || quotaMiB < 1) {
    throw new ProvisioningOperationValidationError("storage.bucket.quotaMiB");
  }
  const compact = normalized.replaceAll("-", "");
  return Object.freeze({
    kind,
    bucketName: `qcrm-${compact}-${kind.toLowerCase()}`,
    quotaMiB,
    versioning: "ENABLED" as const,
  });
}

export function tenantStorageSecretReference(
  tenantProfileId: string,
  kind: TenantStorageSecretKind,
): TenantStorageSecretReference {
  const normalized = uuid("tenantProfileId", tenantProfileId);
  if (!tenantStorageSecretKinds.includes(kind)) {
    throw new ProvisioningOperationValidationError("storage.secret.kind");
  }
  const fileName = kind === "ACCESS_KEY" ? "storage-access-key" : "storage-secret-key";
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

export class ProvisioningOperationNotFoundError extends Error {
  public constructor() {
    super("Provisioning operation was not found");
    this.name = "ProvisioningOperationNotFoundError";
  }
}

export class ProvisioningOperationVersionConflictError extends Error {
  public constructor() {
    super("Provisioning operation version does not match");
    this.name = "ProvisioningOperationVersionConflictError";
  }
}

export class ProvisioningOperationNotCancellableError extends Error {
  public constructor() {
    super("Provisioning operation is not at a safe cancellation point");
    this.name = "ProvisioningOperationNotCancellableError";
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

function correlationId(value: string): string {
  if (!correlationIdPattern.test(value)) {
    throw new ProvisioningOperationValidationError("correlationId");
  }
  return value;
}

function validDate(field: string, value: Date): Date {
  if (Number.isNaN(value.getTime())) throw new ProvisioningOperationValidationError(field);
  return new Date(value.getTime());
}

export function sanitizeProvisioningCancellationReason(value: string): string {
  const normalized = value
    .replace(cancellationReasonControlPattern, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (normalized.length < 3 || normalized.length > 500) {
    throw new ProvisioningOperationValidationError("reason");
  }
  return normalized;
}

export function validateCancelProvisioningOperation(
  input: CancelProvisioningOperationCommand,
): CancelProvisioningOperationCommand {
  if (!idempotencyKeyPattern.test(input.idempotencyKey)) {
    throw new ProvisioningOperationValidationError("idempotencyKey");
  }
  if (input.expectedVersion < 1n) {
    throw new ProvisioningOperationValidationError("expectedVersion");
  }
  return Object.freeze({
    tenantProfileId: uuid("tenantProfileId", input.tenantProfileId),
    operationId: uuid("operationId", input.operationId),
    requestedByOperatorId: uuid("requestedByOperatorId", input.requestedByOperatorId),
    idempotencyKey: input.idempotencyKey,
    correlationId: correlationId(input.correlationId),
    reason: sanitizeProvisioningCancellationReason(input.reason),
    expectedVersion: input.expectedVersion,
  });
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

export function validateCompleteProvisioningMigration(
  input: CompleteProvisioningMigrationCommand,
): CompleteProvisioningMigrationCommand {
  uuid("operationId", input.operationId);
  uuid("tenantProfileId", input.tenantProfileId);
  if (!workerIdPattern.test(input.workerId))
    throw new ProvisioningOperationValidationError("workerId");
  if (input.expectedVersion < 1n) throw new ProvisioningOperationValidationError("expectedVersion");
  if (!Number.isInteger(input.attempt) || input.attempt < 1)
    throw new ProvisioningOperationValidationError("attempt");
  if (input.failureCode && !provisioningValidationFailureCodes.includes(input.failureCode))
    throw new ProvisioningOperationValidationError("failureCode");
  return Object.freeze({ ...input });
}

export function validateCompleteProvisioningStorage(
  input: CompleteProvisioningStorageCommand,
): CompleteProvisioningStorageCommand {
  if (!workerIdPattern.test(input.workerId)) {
    throw new ProvisioningOperationValidationError("workerId");
  }
  if (input.expectedVersion < 1n) {
    throw new ProvisioningOperationValidationError("expectedVersion");
  }
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new ProvisioningOperationValidationError("attempt");
  }
  if (!Number.isInteger(input.quotaMiB) || input.quotaMiB < 1) {
    throw new ProvisioningOperationValidationError("quotaMiB");
  }
  const expectedBuckets = [
    tenantStorageBucketReference(input.tenantProfileId, "INCOMING", input.quotaMiB),
    tenantStorageBucketReference(input.tenantProfileId, "OBJECTS", input.quotaMiB),
  ];
  const expectedSecrets = tenantStorageSecretKinds.map((kind) =>
    tenantStorageSecretReference(input.tenantProfileId, kind),
  );
  const bucketKeys = new Set(
    input.buckets.map(
      (bucket) => `${bucket.kind}:${bucket.bucketName}:${bucket.quotaMiB}:${bucket.versioning}`,
    ),
  );
  const expectedBucketKeys = new Set(
    expectedBuckets.map(
      (bucket) => `${bucket.kind}:${bucket.bucketName}:${bucket.quotaMiB}:${bucket.versioning}`,
    ),
  );
  if (
    bucketKeys.size !== expectedBucketKeys.size ||
    [...expectedBucketKeys].some((key) => !bucketKeys.has(key))
  ) {
    throw new ProvisioningOperationValidationError("buckets");
  }
  const secretKeys = new Set(
    input.secrets.map((secret) => `${secret.kind}:${secret.secretRef}:${secret.version}`),
  );
  const expectedSecretKeys = new Set(
    expectedSecrets.map((secret) => `${secret.kind}:${secret.secretRef}:${secret.version}`),
  );
  if (
    secretKeys.size !== expectedSecretKeys.size ||
    [...expectedSecretKeys].some((key) => !secretKeys.has(key))
  ) {
    throw new ProvisioningOperationValidationError("storage.secrets");
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
    quotaMiB: input.quotaMiB,
    buckets: Object.freeze(input.buckets.map((bucket) => Object.freeze({ ...bucket }))),
    secrets: Object.freeze(input.secrets.map((secret) => Object.freeze({ ...secret }))),
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
  });
}

export function validateCompleteProvisioningConfiguration(
  input: CompleteProvisioningConfigurationCommand,
): CompleteProvisioningConfigurationCommand {
  const tenantProfileId = uuid("tenantProfileId", input.tenantProfileId);
  uuid("serverId", input.serverId);
  uuid("releaseId", input.releaseId);
  if (!workerIdPattern.test(input.workerId)) {
    throw new ProvisioningOperationValidationError("workerId");
  }
  if (input.expectedVersion < 1n) {
    throw new ProvisioningOperationValidationError("expectedVersion");
  }
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new ProvisioningOperationValidationError("attempt");
  }
  if (!configurationRefPattern.test(input.manifestRef)) {
    throw new ProvisioningOperationValidationError("manifestRef");
  }
  if (input.manifestRef !== `tenant/${tenantProfileId}/configuration.json`) {
    throw new ProvisioningOperationValidationError("manifestRef");
  }
  if (input.revision < 1n) {
    throw new ProvisioningOperationValidationError("revision");
  }
  if (input.failureCode && !provisioningValidationFailureCodes.includes(input.failureCode)) {
    throw new ProvisioningOperationValidationError("failureCode");
  }
  return Object.freeze({
    operationId: uuid("operationId", input.operationId),
    tenantProfileId,
    serverId: uuid("serverId", input.serverId),
    releaseId: uuid("releaseId", input.releaseId),
    workerId: input.workerId,
    expectedVersion: input.expectedVersion,
    attempt: input.attempt,
    manifestRef: input.manifestRef,
    revision: input.revision,
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
  });
}

export function validateCompleteProvisioningContainers(
  input: CompleteProvisioningContainersCommand,
): CompleteProvisioningContainersCommand {
  const tenantProfileId = uuid("tenantProfileId", input.tenantProfileId);
  uuid("serverId", input.serverId);
  uuid("releaseId", input.releaseId);
  if (!workerIdPattern.test(input.workerId)) {
    throw new ProvisioningOperationValidationError("workerId");
  }
  if (input.expectedVersion < 1n) {
    throw new ProvisioningOperationValidationError("expectedVersion");
  }
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new ProvisioningOperationValidationError("attempt");
  }
  if (!configurationRefPattern.test(input.manifestRef)) {
    throw new ProvisioningOperationValidationError("manifestRef");
  }
  if (input.manifestRef !== `tenant/${tenantProfileId}/configuration.json`) {
    throw new ProvisioningOperationValidationError("manifestRef");
  }
  if (input.configurationRevision < 1n) {
    throw new ProvisioningOperationValidationError("configurationRevision");
  }
  if (!/^qcrm-t-[0-9a-f-]{36}$/u.test(input.projectName)) {
    throw new ProvisioningOperationValidationError("projectName");
  }
  const services = [...new Set(input.services)];
  if (
    services.length !== tenantContainerServiceNames.length ||
    tenantContainerServiceNames.some((service) => !services.includes(service))
  ) {
    throw new ProvisioningOperationValidationError("services");
  }
  if (typeof input.ready !== "boolean") {
    throw new ProvisioningOperationValidationError("ready");
  }
  if (typeof input.reconciled !== "boolean") {
    throw new ProvisioningOperationValidationError("reconciled");
  }
  if (input.failureCode && !provisioningValidationFailureCodes.includes(input.failureCode)) {
    throw new ProvisioningOperationValidationError("failureCode");
  }
  return Object.freeze({
    operationId: uuid("operationId", input.operationId),
    tenantProfileId,
    serverId: uuid("serverId", input.serverId),
    releaseId: uuid("releaseId", input.releaseId),
    workerId: input.workerId,
    expectedVersion: input.expectedVersion,
    attempt: input.attempt,
    manifestRef: input.manifestRef,
    configurationRevision: input.configurationRevision,
    projectName: input.projectName,
    services: Object.freeze([...services].sort() as TenantContainerServiceName[]),
    ready: input.ready,
    reconciled: input.reconciled,
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
  });
}

export function validateCompleteProvisioningHttps(
  input: CompleteProvisioningHttpsCommand,
): CompleteProvisioningHttpsCommand {
  const tenantProfileId = uuid("tenantProfileId", input.tenantProfileId);
  uuid("serverId", input.serverId);
  uuid("releaseId", input.releaseId);
  if (!workerIdPattern.test(input.workerId)) {
    throw new ProvisioningOperationValidationError("workerId");
  }
  if (input.expectedVersion < 1n) {
    throw new ProvisioningOperationValidationError("expectedVersion");
  }
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new ProvisioningOperationValidationError("attempt");
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[0-9-]+\.nip\.io$/u.test(input.hostname)) {
    throw new ProvisioningOperationValidationError("hostname");
  }
  if (input.edgeNetworkName !== `qcrm-tenant-edge-${tenantProfileId}`) {
    throw new ProvisioningOperationValidationError("edgeNetworkName");
  }
  const upstreams = [...new Set(input.upstreamServices)];
  if (
    upstreams.length === 0 ||
    upstreams.some((service) => !["api", "crm-web", "portal-web"].includes(service))
  ) {
    throw new ProvisioningOperationValidationError("upstreamServices");
  }
  if (input.configurationRevision < 1n) {
    throw new ProvisioningOperationValidationError("configurationRevision");
  }
  if (input.routeGeneration < 1n) {
    throw new ProvisioningOperationValidationError("routeGeneration");
  }
  if (typeof input.configured !== "boolean" || typeof input.reconciled !== "boolean") {
    throw new ProvisioningOperationValidationError("routeState");
  }
  if (!input.failureCode && !input.configured) {
    throw new ProvisioningOperationValidationError("configured");
  }
  if (input.failureCode && !provisioningValidationFailureCodes.includes(input.failureCode)) {
    throw new ProvisioningOperationValidationError("failureCode");
  }
  return Object.freeze({
    operationId: uuid("operationId", input.operationId),
    tenantProfileId,
    serverId: uuid("serverId", input.serverId),
    releaseId: uuid("releaseId", input.releaseId),
    workerId: input.workerId,
    expectedVersion: input.expectedVersion,
    attempt: input.attempt,
    hostname: input.hostname,
    edgeNetworkName: input.edgeNetworkName,
    upstreamServices: Object.freeze(upstreams.sort() as TenantHttpsUpstreamServiceName[]),
    configurationRevision: input.configurationRevision,
    routeGeneration: input.routeGeneration,
    configured: input.configured,
    reconciled: input.reconciled,
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
    readonly cancellation?: ProvisioningOperationCancellation | null;
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

  if (input.cancellation && input.status !== "CANCELLED") {
    throw new ProvisioningOperationValidationError("cancellation");
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

  let cancellation: ProvisioningOperationCancellation | null = null;
  if (input.cancellation) {
    if (!idempotencyKeyPattern.test(input.cancellation.idempotencyKey)) {
      throw new ProvisioningOperationValidationError("cancellation.idempotencyKey");
    }
    if (
      input.cancellation.expectedVersion < 1n ||
      input.cancellation.tenantVersion < 1n ||
      input.cancellation.result !== "CANCELLED"
    ) {
      throw new ProvisioningOperationValidationError("cancellation.result");
    }
    cancellation = Object.freeze({
      cancelledByOperatorId: uuid(
        "cancellation.cancelledByOperatorId",
        input.cancellation.cancelledByOperatorId,
      ),
      idempotencyKey: input.cancellation.idempotencyKey,
      correlationId: correlationId(input.cancellation.correlationId),
      reason: sanitizeProvisioningCancellationReason(input.cancellation.reason),
      expectedVersion: input.cancellation.expectedVersion,
      tenantVersion: input.cancellation.tenantVersion,
      result: input.cancellation.result,
      cancelledAt: validDate("cancellation.cancelledAt", input.cancellation.cancelledAt),
    });
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
    cancellation,
    createdAt,
    updatedAt,
    capacityReservation,
  });
}

export class TenantProvisioningService {
  public constructor(
    private readonly repository: ProvisioningOperationRepository &
      ProvisioningOperationCancellationRepository,
    private readonly placement?: Readonly<{
      infrastructureServers: InfrastructureServerRepository;
      releases: PlatformReleaseRepository;
    }>,
  ) {}

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

  public findLatest(tenantProfileId: string): Promise<ProvisioningOperation | null> {
    return this.repository.findLatestByTenantProfileId(uuid("tenantProfileId", tenantProfileId));
  }

  public async requestAutomatically(
    command: RequestAutomaticProvisioningCommand,
  ): Promise<ProvisioningRequestResult> {
    if (!this.placement || command.expectedTenantVersion < 1n) {
      throw new ProvisioningOperationValidationError("automaticProvisioning");
    }
    const [releases, servers] = await Promise.all([
      this.placement.releases.list({ status: "VALIDATED", limit: 1 }),
      this.placement.infrastructureServers.list({ status: "AVAILABLE", limit: 100 }),
    ]);
    const release = releases[0];
    if (!release) throw new PlatformReleaseNotDeployableError();

    for (const server of servers) {
      const available = server.availableCapacity;
      if (
        available.cpuMillicores < automaticTenantProvisioningCapacity.cpuMillicores ||
        available.memoryMiB < automaticTenantProvisioningCapacity.memoryMiB ||
        available.storageMiB < automaticTenantProvisioningCapacity.storageMiB
      ) {
        continue;
      }
      try {
        return await this.request({
          ...command,
          serverId: server.id,
          releaseId: release.id,
          requestedCapacity: automaticTenantProvisioningCapacity,
        });
      } catch (error) {
        if (error instanceof InfrastructureCapacityExceededError) continue;
        throw error;
      }
    }
    throw new InfrastructureCapacityExceededError();
  }

  public cancel(
    command: CancelProvisioningOperationCommand,
  ): Promise<ProvisioningCancellationResult> {
    return this.repository.cancel(validateCancelProvisioningOperation(command));
  }
}
