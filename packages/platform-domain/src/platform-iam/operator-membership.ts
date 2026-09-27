const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const oidcSubjectPattern = /^[!-~]{1,255}$/u;

export const platformOperatorStatuses = ["PENDING", "ACTIVE", "SUSPENDED"] as const;
export const platformPermissions = [
  "tenants:read",
  "tenants:manage",
  "configuration:read",
  "configuration:manage",
  "deployments:read",
  "deployments:execute",
  "deployments:activate",
  "operators:manage",
] as const;

export type PlatformOperatorStatus = (typeof platformOperatorStatuses)[number];
export type PlatformPermission = (typeof platformPermissions)[number];

export interface PlatformOperatorMembershipDraft {
  readonly oidcSubject: string;
  readonly status: PlatformOperatorStatus;
  readonly permissions: readonly PlatformPermission[];
}

export interface PlatformOperatorMembership extends PlatformOperatorMembershipDraft {
  readonly id: string;
  readonly authorizationRevision: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class PlatformOperatorMembershipValidationError extends Error {
  public constructor(field: string) {
    super(`Invalid platform operator membership field: ${field}`);
    this.name = "PlatformOperatorMembershipValidationError";
  }
}

function uuid(field: string, value: string): string {
  const normalized = value.toLowerCase();
  if (!uuidPattern.test(normalized)) {
    throw new PlatformOperatorMembershipValidationError(field);
  }

  return normalized;
}

function date(field: string, value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new PlatformOperatorMembershipValidationError(field);
  }

  return new Date(value.getTime());
}

function normalizePermissions(
  permissions: readonly PlatformPermission[],
): readonly PlatformPermission[] {
  if (permissions.some((permission) => !platformPermissions.includes(permission))) {
    throw new PlatformOperatorMembershipValidationError("permissions");
  }

  return Object.freeze([...new Set(permissions)].sort());
}

export function createPlatformOperatorMembershipDraft(input: {
  readonly oidcSubject: string;
  readonly status?: PlatformOperatorStatus;
  readonly permissions?: readonly PlatformPermission[];
}): PlatformOperatorMembershipDraft {
  const oidcSubject = input.oidcSubject.trim();
  if (!oidcSubjectPattern.test(oidcSubject)) {
    throw new PlatformOperatorMembershipValidationError("oidcSubject");
  }

  const status = input.status ?? "PENDING";
  if (!platformOperatorStatuses.includes(status)) {
    throw new PlatformOperatorMembershipValidationError("status");
  }

  return Object.freeze({
    oidcSubject,
    status,
    permissions: normalizePermissions(input.permissions ?? []),
  });
}

export function hydratePlatformOperatorMembership(
  input: PlatformOperatorMembershipDraft & {
    readonly id: string;
    readonly authorizationRevision: bigint;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  },
): PlatformOperatorMembership {
  if (input.authorizationRevision < 1n) {
    throw new PlatformOperatorMembershipValidationError("authorizationRevision");
  }

  const draft = createPlatformOperatorMembershipDraft(input);
  const createdAt = date("createdAt", input.createdAt);
  const updatedAt = date("updatedAt", input.updatedAt);
  if (updatedAt < createdAt) {
    throw new PlatformOperatorMembershipValidationError("updatedAt");
  }

  return Object.freeze({
    ...draft,
    id: uuid("id", input.id),
    authorizationRevision: input.authorizationRevision,
    createdAt,
    updatedAt,
  });
}
