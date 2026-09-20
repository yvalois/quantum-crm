const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
const correlationIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

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

export interface ProvisioningOperationDraft {
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly releaseId: string;
  readonly requestedByOperatorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly status: "PENDING";
  readonly currentStep: "VALIDATE";
}

export interface ProvisioningOperation extends ProvisioningOperationDraft {
  readonly id: string;
  readonly attempt: number;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RequestProvisioningCommand {
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly releaseId: string;
  readonly requestedByOperatorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly expectedTenantVersion: bigint;
}

export interface ProvisioningRequestResult {
  readonly operation: ProvisioningOperation;
  readonly tenantVersion: bigint;
  readonly idempotentReplay: boolean;
}

export interface ProvisioningOperationRepository {
  readonly request: (command: RequestProvisioningCommand) => Promise<ProvisioningRequestResult>;
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

function uuid(field: string, value: string): string {
  const normalized = value.toLowerCase();
  if (!uuidPattern.test(normalized)) throw new ProvisioningOperationValidationError(field);
  return normalized;
}

function validDate(field: string, value: Date): Date {
  if (Number.isNaN(value.getTime())) throw new ProvisioningOperationValidationError(field);
  return new Date(value.getTime());
}

export function createProvisioningOperationDraft(
  input: Omit<ProvisioningOperationDraft, "status" | "currentStep">,
): ProvisioningOperationDraft {
  if (!idempotencyKeyPattern.test(input.idempotencyKey)) {
    throw new ProvisioningOperationValidationError("idempotencyKey");
  }
  if (!correlationIdPattern.test(input.correlationId)) {
    throw new ProvisioningOperationValidationError("correlationId");
  }
  return Object.freeze({
    tenantProfileId: uuid("tenantProfileId", input.tenantProfileId),
    serverId: uuid("serverId", input.serverId),
    releaseId: uuid("releaseId", input.releaseId),
    requestedByOperatorId: uuid("requestedByOperatorId", input.requestedByOperatorId),
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    status: "PENDING",
    currentStep: "VALIDATE",
  });
}

export function hydrateProvisioningOperation(
  input: ProvisioningOperationDraft & {
    readonly id: string;
    readonly attempt: number;
    readonly version: bigint;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  },
): ProvisioningOperation {
  if (!Number.isInteger(input.attempt) || input.attempt < 0) {
    throw new ProvisioningOperationValidationError("attempt");
  }
  if (input.version < 1n) throw new ProvisioningOperationValidationError("version");
  const draft = createProvisioningOperationDraft(input);
  const createdAt = validDate("createdAt", input.createdAt);
  const updatedAt = validDate("updatedAt", input.updatedAt);
  if (updatedAt < createdAt) throw new ProvisioningOperationValidationError("updatedAt");
  return Object.freeze({
    ...draft,
    id: uuid("id", input.id),
    attempt: input.attempt,
    version: input.version,
    createdAt,
    updatedAt,
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
