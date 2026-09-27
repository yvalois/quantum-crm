import { CrmPermissionCatalog, type CrmPermission } from "@quantum-crm/contracts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export const iamPermissions = CrmPermissionCatalog;
export type IamPermission = CrmPermission;
export type CommercialScope = "PROFILE" | "OWN";
export interface CommercialActor {
  readonly memberId: string;
  readonly scope: CommercialScope;
}
export const initialRoleCodes = ["ADMINISTRATOR", "SUPERVISOR", "ADVISOR"] as const;
export type InitialRoleCode = (typeof initialRoleCodes)[number];
export type RoleCode = InitialRoleCode | `CUSTOM_${string}`;
export interface IamRole {
  readonly id: string;
  readonly code: RoleCode;
  readonly displayName: string;
  readonly system: boolean;
  readonly authorizationRevision: bigint;
  readonly permissions: readonly IamPermission[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export type MemberStatus = "INVITED" | "ACTIVE" | "DEACTIVATED";
export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface IamMember {
  readonly id: string;
  readonly oidcSubject: string | null;
  readonly displayName: string;
  readonly email: string;
  readonly status: MemberStatus;
  readonly authorizationRevision: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deactivatedAt: Date | null;
}

export interface IamInvitation {
  readonly id: string;
  readonly memberId: string;
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly createdAt: Date;
}

export function permissionsForInitialRole(roleCode: InitialRoleCode): readonly IamPermission[] {
  switch (roleCode) {
    case "ADMINISTRATOR":
      return Object.freeze([...iamPermissions]);
    case "SUPERVISOR":
      return Object.freeze([
        "crm:contacts:read",
        "crm:contacts:create",
        "crm:contacts:update",
        "crm:sales:read",
        "crm:sales:create",
        "crm:sales:move",
        "crm:tasks:read",
        "crm:tasks:create",
        "crm:tasks:update",
      ]);
    case "ADVISOR":
      return Object.freeze([
        "crm:contacts:read",
        "crm:contacts:create",
        "crm:contacts:update",
        "crm:sales:read",
        "crm:sales:create",
        "crm:sales:move",
        "crm:tasks:read",
        "crm:tasks:create",
        "crm:tasks:update",
      ]);
  }
}

const customRoleCodePattern = /^CUSTOM_[A-Z0-9_]{1,71}$/u;

export function isRoleCode(value: string): value is RoleCode {
  return initialRoleCodes.includes(value as InitialRoleCode) || customRoleCodePattern.test(value);
}

export function createCustomRole(input: {
  readonly id: string;
  readonly code: RoleCode;
  readonly displayName: string;
  readonly permissions: readonly IamPermission[];
  readonly now: Date;
}): IamRole {
  requireUuid(input.id);
  requireDate(input.now);
  if (!customRoleCodePattern.test(input.code)) throw new IamMemberValidationError();
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 160) throw new IamMemberValidationError();
  const permissions = [...new Set(input.permissions)];
  if (permissions.some((permission) => !iamPermissions.includes(permission))) {
    throw new IamMemberValidationError();
  }
  return Object.freeze({
    id: input.id,
    code: input.code,
    displayName,
    system: false,
    authorizationRevision: 1n,
    permissions: Object.freeze(permissions),
    createdAt: input.now,
    updatedAt: input.now,
  });
}

export function updateCustomRole(input: {
  readonly role: IamRole;
  readonly displayName?: string;
  readonly permissions?: readonly IamPermission[];
  readonly now: Date;
}): IamRole {
  if (input.role.system || (input.displayName === undefined && input.permissions === undefined)) {
    throw new IamMemberValidationError();
  }
  requireDate(input.now);
  const displayName = input.displayName === undefined ? input.role.displayName : input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 160) throw new IamMemberValidationError();
  const permissions = input.permissions === undefined ? input.role.permissions : [...new Set(input.permissions)];
  if (permissions.some((permission) => !iamPermissions.includes(permission))) {
    throw new IamMemberValidationError();
  }
  return Object.freeze({
    ...input.role,
    displayName,
    permissions: Object.freeze(permissions),
    authorizationRevision: input.role.authorizationRevision + 1n,
    updatedAt: input.now,
  });
}

export class IamMemberValidationError extends Error {
  public constructor() {
    super("Invalid IAM member state");
    this.name = "IamMemberValidationError";
  }
}

function requireUuid(value: string): void {
  if (!uuidPattern.test(value)) throw new IamMemberValidationError();
}

function requireDate(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new IamMemberValidationError();
  }
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 160) throw new IamMemberValidationError();
  return normalized;
}

function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 320 || !emailPattern.test(normalized)) {
    throw new IamMemberValidationError();
  }
  return normalized;
}

export function createInvitedMember(input: {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly now: Date;
}): IamMember {
  requireUuid(input.id);
  requireDate(input.now);
  return Object.freeze({
    id: input.id,
    oidcSubject: null,
    displayName: normalizeDisplayName(input.displayName),
    email: normalizeEmail(input.email),
    status: "INVITED",
    authorizationRevision: 1n,
    createdAt: input.now,
    updatedAt: input.now,
    deactivatedAt: null,
  });
}

/**
 * The initial membership is intentionally not an invitation: its subject was
 * already verified by the isolated identity/provisioning path. Its profile
 * fields are deterministic placeholders until the identity profile is synced;
 * no caller can choose a role, tenant or email through this command.
 */
export function createBootstrapAdministrator(input: {
  readonly id: string;
  readonly oidcSubject: string;
  readonly now: Date;
}): IamMember {
  requireUuid(input.id);
  requireDate(input.now);
  if (!/^[!-~]{1,255}$/u.test(input.oidcSubject)) throw new IamMemberValidationError();
  return Object.freeze({
    id: input.id,
    oidcSubject: input.oidcSubject,
    displayName: "Administrador inicial",
    email: `${input.oidcSubject}@bootstrap.invalid`,
    status: "ACTIVE",
    authorizationRevision: 1n,
    createdAt: input.now,
    updatedAt: input.now,
    deactivatedAt: null,
  });
}

export function activateMember(input: {
  readonly member: IamMember;
  readonly oidcSubject: string;
  readonly now: Date;
}): IamMember {
  if (
    input.member.status !== "INVITED" ||
    input.member.oidcSubject !== null ||
    input.oidcSubject.length < 1 ||
    input.oidcSubject.length > 255
  ) {
    throw new IamMemberValidationError();
  }
  requireDate(input.now);
  return Object.freeze({
    ...input.member,
    oidcSubject: input.oidcSubject,
    status: "ACTIVE",
    authorizationRevision: input.member.authorizationRevision + 1n,
    updatedAt: input.now,
  });
}

export function updateMemberProfile(input: {
  readonly member: IamMember;
  readonly displayName?: string;
  readonly email?: string;
  readonly now: Date;
}): IamMember {
  if (input.displayName === undefined && input.email === undefined) {
    throw new IamMemberValidationError();
  }
  requireDate(input.now);
  return Object.freeze({
    ...input.member,
    ...(input.displayName === undefined
      ? {}
      : { displayName: normalizeDisplayName(input.displayName) }),
    ...(input.email === undefined ? {} : { email: normalizeEmail(input.email) }),
    updatedAt: input.now,
  });
}

export function deactivateMember(input: {
  readonly member: IamMember;
  readonly now: Date;
}): IamMember {
  if (input.member.status === "DEACTIVATED") throw new IamMemberValidationError();
  requireDate(input.now);
  return Object.freeze({
    ...input.member,
    status: "DEACTIVATED",
    authorizationRevision: input.member.authorizationRevision + 1n,
    updatedAt: input.now,
    deactivatedAt: input.now,
  });
}

export function createInvitation(input: {
  readonly id: string;
  readonly memberId: string;
  readonly now: Date;
  readonly expiresAt: Date;
}): IamInvitation {
  requireUuid(input.id);
  requireUuid(input.memberId);
  requireDate(input.now);
  requireDate(input.expiresAt);
  if (input.expiresAt <= input.now) throw new IamMemberValidationError();
  return Object.freeze({
    id: input.id,
    memberId: input.memberId,
    status: "PENDING",
    expiresAt: input.expiresAt,
    acceptedAt: null,
    createdAt: input.now,
  });
}

export function acceptInvitation(input: {
  readonly invitation: IamInvitation;
  readonly now: Date;
}): IamInvitation {
  requireDate(input.now);
  if (input.invitation.status !== "PENDING" || input.invitation.expiresAt <= input.now) {
    throw new IamMemberValidationError();
  }
  return Object.freeze({ ...input.invitation, status: "ACCEPTED", acceptedAt: input.now });
}
