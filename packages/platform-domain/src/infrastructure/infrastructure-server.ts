const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const codePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const credentialReferencePattern = /^secret:\/\/[a-z0-9][a-z0-9/_-]{2,253}$/u;

export const infrastructureServerStatuses = ["AVAILABLE", "DRAINING", "UNAVAILABLE"] as const;
export type InfrastructureServerStatus = (typeof infrastructureServerStatuses)[number];

export const infrastructureServerArchitectures = ["X86_64", "ARM64"] as const;
export type InfrastructureServerArchitecture = (typeof infrastructureServerArchitectures)[number];

export interface ServerCapacity {
  readonly cpuMillicores: number;
  readonly memoryMiB: number;
  readonly storageMiB: number;
}

export interface InfrastructureServerDraft {
  readonly code: string;
  readonly displayName: string;
  readonly provider: string;
  readonly region: string;
  readonly publicIpv4: string;
  readonly operatingSystem: string;
  readonly architecture: InfrastructureServerArchitecture;
  readonly status: InfrastructureServerStatus;
  readonly totalCapacity: ServerCapacity;
  readonly reservedCapacity: ServerCapacity;
  readonly operationCredentialRef: string;
  readonly confirmedAt: Date;
}

export interface InfrastructureServer extends InfrastructureServerDraft {
  readonly id: string;
  readonly availableCapacity: ServerCapacity;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class InfrastructureServerValidationError extends Error {
  public constructor(field: string) {
    super(`Invalid infrastructure server field: ${field}`);
    this.name = "InfrastructureServerValidationError";
  }
}

function text(field: string, value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new InfrastructureServerValidationError(field);
  }
  return normalized;
}

function ipv4(value: string): string {
  const normalized = value.trim();
  const parts = normalized.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^(?:0|[1-9][0-9]{0,2})$/u.test(part) || Number(part) > 255)
  ) {
    throw new InfrastructureServerValidationError("publicIpv4");
  }
  return normalized;
}

function capacity(field: string, value: ServerCapacity, allowZero: boolean): ServerCapacity {
  const minimum = allowZero ? 0 : 1;
  for (const [dimension, amount] of Object.entries(value)) {
    if (!Number.isSafeInteger(amount) || amount < minimum) {
      throw new InfrastructureServerValidationError(`${field}.${dimension}`);
    }
  }
  return Object.freeze({ ...value });
}

function date(field: string, value: Date): Date {
  if (Number.isNaN(value.getTime())) throw new InfrastructureServerValidationError(field);
  return new Date(value.getTime());
}

function assertReservedWithinTotal(total: ServerCapacity, reserved: ServerCapacity): void {
  if (
    reserved.cpuMillicores > total.cpuMillicores ||
    reserved.memoryMiB > total.memoryMiB ||
    reserved.storageMiB > total.storageMiB
  ) {
    throw new InfrastructureServerValidationError("reservedCapacity");
  }
}

export function createInfrastructureServerDraft(
  input: Omit<InfrastructureServerDraft, "code" | "publicIpv4"> & {
    readonly code: string;
    readonly publicIpv4: string;
  },
): InfrastructureServerDraft {
  const code = input.code.trim().toLowerCase();
  if (!codePattern.test(code)) throw new InfrastructureServerValidationError("code");
  if (!infrastructureServerArchitectures.includes(input.architecture)) {
    throw new InfrastructureServerValidationError("architecture");
  }
  if (!infrastructureServerStatuses.includes(input.status)) {
    throw new InfrastructureServerValidationError("status");
  }
  const totalCapacity = capacity("totalCapacity", input.totalCapacity, false);
  const reservedCapacity = capacity("reservedCapacity", input.reservedCapacity, true);
  assertReservedWithinTotal(totalCapacity, reservedCapacity);
  const operationCredentialRef = input.operationCredentialRef.trim().toLowerCase();
  if (!credentialReferencePattern.test(operationCredentialRef)) {
    throw new InfrastructureServerValidationError("operationCredentialRef");
  }
  return Object.freeze({
    code,
    displayName: text("displayName", input.displayName, 160),
    provider: text("provider", input.provider, 120),
    region: text("region", input.region, 120),
    publicIpv4: ipv4(input.publicIpv4),
    operatingSystem: text("operatingSystem", input.operatingSystem, 160),
    architecture: input.architecture,
    status: input.status,
    totalCapacity,
    reservedCapacity,
    operationCredentialRef,
    confirmedAt: date("confirmedAt", input.confirmedAt),
  });
}

export function hydrateInfrastructureServer(
  input: InfrastructureServerDraft & {
    readonly id: string;
    readonly version: bigint;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  },
): InfrastructureServer {
  const id = input.id.toLowerCase();
  if (!uuidPattern.test(id)) throw new InfrastructureServerValidationError("id");
  if (input.version < 1n) throw new InfrastructureServerValidationError("version");
  const draft = createInfrastructureServerDraft(input);
  const createdAt = date("createdAt", input.createdAt);
  const updatedAt = date("updatedAt", input.updatedAt);
  if (updatedAt < createdAt) throw new InfrastructureServerValidationError("updatedAt");
  return Object.freeze({
    ...draft,
    id,
    availableCapacity: Object.freeze({
      cpuMillicores: draft.totalCapacity.cpuMillicores - draft.reservedCapacity.cpuMillicores,
      memoryMiB: draft.totalCapacity.memoryMiB - draft.reservedCapacity.memoryMiB,
      storageMiB: draft.totalCapacity.storageMiB - draft.reservedCapacity.storageMiB,
    }),
    version: input.version,
    createdAt,
    updatedAt,
  });
}
