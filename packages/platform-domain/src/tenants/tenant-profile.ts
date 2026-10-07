const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export const tenantProfileStatuses = [
  "PENDING",
  "PROVISIONING",
  "ACTIVE",
  "SUSPENDED",
  "ERROR",
  "DECOMMISSIONING",
  "DELETED",
] as const;

export type TenantProfileStatus = (typeof tenantProfileStatuses)[number];

export const tenantProfileLifecycleActions = [
  "START_PROVISIONING",
  "MARK_ACTIVE",
  "MARK_ERROR",
  "SUSPEND",
  "RESUME",
  "START_DECOMMISSIONING",
  "MARK_DELETED",
] as const;

export type TenantProfileLifecycleAction = (typeof tenantProfileLifecycleActions)[number];

export class TenantProfileLifecycleTransitionError extends Error {
  public constructor(
    public readonly currentStatus: TenantProfileStatus,
    public readonly action: TenantProfileLifecycleAction,
  ) {
    super(`Cannot apply ${action} to tenant profile in ${currentStatus}`);
    this.name = "TenantProfileLifecycleTransitionError";
  }
}

const lifecycleTransitions: Readonly<
  Record<
    TenantProfileLifecycleAction,
    Readonly<Partial<Record<TenantProfileStatus, TenantProfileStatus>>>
  >
> = Object.freeze({
  START_PROVISIONING: Object.freeze({
    PENDING: "PROVISIONING",
    PROVISIONING: "PROVISIONING",
    ERROR: "PROVISIONING",
  }),
  MARK_ACTIVE: Object.freeze({
    PROVISIONING: "ACTIVE",
    ACTIVE: "ACTIVE",
  }),
  MARK_ERROR: Object.freeze({
    PROVISIONING: "ERROR",
    ERROR: "ERROR",
  }),
  SUSPEND: Object.freeze({
    ACTIVE: "SUSPENDED",
    SUSPENDED: "SUSPENDED",
  }),
  RESUME: Object.freeze({
    SUSPENDED: "ACTIVE",
    ACTIVE: "ACTIVE",
  }),
  START_DECOMMISSIONING: Object.freeze({
    PENDING: "DECOMMISSIONING",
    ACTIVE: "DECOMMISSIONING",
    SUSPENDED: "DECOMMISSIONING",
    ERROR: "DECOMMISSIONING",
    DECOMMISSIONING: "DECOMMISSIONING",
  }),
  MARK_DELETED: Object.freeze({
    DECOMMISSIONING: "DELETED",
    DELETED: "DELETED",
  }),
});

export function transitionTenantProfileStatus(
  currentStatus: TenantProfileStatus,
  action: TenantProfileLifecycleAction,
): TenantProfileStatus {
  const nextStatus = lifecycleTransitions[action][currentStatus];
  if (!nextStatus) {
    throw new TenantProfileLifecycleTransitionError(currentStatus, action);
  }
  return nextStatus;
}

export interface TenantProfileDraft {
  readonly name: string;
  readonly slug: string;
  readonly adminContactName: string;
  readonly adminContactEmail: string;
  readonly status: TenantProfileStatus;
  readonly serverId?: string;
  readonly releaseId?: string;
}

export interface TenantProfile extends TenantProfileDraft {
  readonly id: string;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class TenantProfileValidationError extends Error {
  public constructor(field: string) {
    super(`Invalid tenant profile field: ${field}`);
    this.name = "TenantProfileValidationError";
  }
}

function requiredText(field: string, value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new TenantProfileValidationError(field);
  }

  return normalized;
}

function uuid(field: string, value: string): string {
  const normalized = value.toLowerCase();
  if (!uuidPattern.test(normalized)) {
    throw new TenantProfileValidationError(field);
  }

  return normalized;
}

function optionalUuid(field: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : uuid(field, value);
}

function date(field: string, value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new TenantProfileValidationError(field);
  }

  return new Date(value.getTime());
}

export function createTenantProfileDraft(input: {
  readonly name: string;
  readonly slug: string;
  readonly adminContactName: string;
  readonly adminContactEmail: string;
  readonly status?: TenantProfileStatus;
  readonly serverId?: string;
  readonly releaseId?: string;
}): TenantProfileDraft {
  const slug = input.slug.trim().toLowerCase();
  if (!slugPattern.test(slug)) {
    throw new TenantProfileValidationError("slug");
  }

  const adminContactEmail = input.adminContactEmail.trim().toLowerCase();
  if (adminContactEmail.length > 320 || !emailPattern.test(adminContactEmail)) {
    throw new TenantProfileValidationError("adminContactEmail");
  }

  const status = input.status ?? "PENDING";
  if (!tenantProfileStatuses.includes(status)) {
    throw new TenantProfileValidationError("status");
  }

  const serverId = optionalUuid("serverId", input.serverId);
  const releaseId = optionalUuid("releaseId", input.releaseId);

  return Object.freeze({
    name: requiredText("name", input.name, 160),
    slug,
    adminContactName: requiredText("adminContactName", input.adminContactName, 160),
    adminContactEmail,
    status,
    ...(serverId ? { serverId } : {}),
    ...(releaseId ? { releaseId } : {}),
  });
}

export function hydrateTenantProfile(
  input: TenantProfileDraft & {
    readonly id: string;
    readonly version: bigint;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  },
): TenantProfile {
  if (input.version < 1n) {
    throw new TenantProfileValidationError("version");
  }

  const draft = createTenantProfileDraft(input);
  const createdAt = date("createdAt", input.createdAt);
  const updatedAt = date("updatedAt", input.updatedAt);
  if (updatedAt < createdAt) {
    throw new TenantProfileValidationError("updatedAt");
  }

  return Object.freeze({
    ...draft,
    id: uuid("id", input.id),
    version: input.version,
    createdAt,
    updatedAt,
  });
}
