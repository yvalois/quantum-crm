import type { SecretValue } from "@quantum-crm/config";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const subjectPattern = /^[!-~]{1,255}$/u;
const correlationIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;
const permissionPattern = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/u;

export interface VerifiedOidcIdentity {
  readonly verification: "oidc-access-token/v1";
  readonly subject: string;
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly principalType: "human" | "service" | "agent" | "automation";
  readonly multiFactorAuthenticated: boolean;
  readonly authenticatedAt: Date;
}

export interface OidcAccessTokenVerifier {
  verifyAccessToken(accessToken: SecretValue): Promise<VerifiedOidcIdentity>;
}

export interface PlatformMembershipSnapshot {
  readonly id: string;
  readonly oidcSubject: string;
  readonly status: "PENDING" | "ACTIVE" | "SUSPENDED";
  readonly permissions: readonly string[];
  readonly authorizationRevision: bigint;
}

export interface PlatformMembershipReader {
  findByOidcSubject(oidcSubject: string): Promise<PlatformMembershipSnapshot | null>;
}

export interface PlatformAuthPolicy {
  readonly issuer: string;
  readonly audience: string;
  readonly allowedPermissions: readonly string[];
}

export interface PlatformAuthContext {
  readonly schemaVersion: "platform-auth-context/v1";
  readonly boundary: "platform";
  readonly principal: Readonly<{
    type: "human";
    id: string;
    oidcSubject: string;
  }>;
  readonly permissions: readonly string[];
  readonly authorizationRevision: bigint;
  readonly authenticatedAt: string;
  readonly correlationId: string;
}

export type PlatformAuthenticationFailure =
  "IDENTITY_REJECTED" | "MFA_REQUIRED" | "MEMBERSHIP_REJECTED";

export class PlatformAuthenticationError extends Error {
  public constructor(public readonly code: PlatformAuthenticationFailure) {
    super("Platform authentication denied");
    this.name = "PlatformAuthenticationError";
  }
}

export class PlatformAuthorizationError extends Error {
  public constructor() {
    super("Platform authorization denied");
    this.name = "PlatformAuthorizationError";
  }
}

function rejectIdentity(): never {
  throw new PlatformAuthenticationError("IDENTITY_REJECTED");
}

function normalizePermissions(
  permissions: readonly string[],
  allowedPermissions: readonly string[],
): readonly string[] {
  const allowed = new Set(allowedPermissions);
  if (
    allowed.size !== allowedPermissions.length ||
    allowedPermissions.some((permission) => !permissionPattern.test(permission)) ||
    permissions.some(
      (permission) => !permissionPattern.test(permission) || !allowed.has(permission),
    )
  ) {
    throw new PlatformAuthenticationError("MEMBERSHIP_REJECTED");
  }

  return Object.freeze([...new Set(permissions)].sort());
}

export async function authenticatePlatformOperator(input: {
  readonly accessToken: SecretValue;
  readonly verifier: OidcAccessTokenVerifier;
  readonly memberships: PlatformMembershipReader;
  readonly policy: PlatformAuthPolicy;
  readonly correlationId: string;
  readonly now?: Date;
}): Promise<PlatformAuthContext> {
  let identity: VerifiedOidcIdentity;
  try {
    identity = await input.verifier.verifyAccessToken(input.accessToken);
  } catch {
    return rejectIdentity();
  }

  const now = input.now ?? new Date();
  if (
    identity.verification !== "oidc-access-token/v1" ||
    typeof identity.issuer !== "string" ||
    identity.issuer !== input.policy.issuer ||
    !Array.isArray(identity.audiences) ||
    !identity.audiences.includes(input.policy.audience) ||
    identity.principalType !== "human" ||
    typeof identity.subject !== "string" ||
    !subjectPattern.test(identity.subject) ||
    !(identity.authenticatedAt instanceof Date) ||
    Number.isNaN(identity.authenticatedAt.getTime()) ||
    Number.isNaN(now.getTime()) ||
    identity.authenticatedAt.getTime() > now.getTime() + 60_000 ||
    !correlationIdPattern.test(input.correlationId)
  ) {
    return rejectIdentity();
  }

  if (!identity.multiFactorAuthenticated) {
    throw new PlatformAuthenticationError("MFA_REQUIRED");
  }

  const membership = await input.memberships.findByOidcSubject(identity.subject);
  if (
    membership === null ||
    typeof membership.oidcSubject !== "string" ||
    membership.oidcSubject !== identity.subject ||
    membership.status !== "ACTIVE" ||
    typeof membership.id !== "string" ||
    !uuidPattern.test(membership.id) ||
    typeof membership.authorizationRevision !== "bigint" ||
    !Array.isArray(membership.permissions) ||
    membership.authorizationRevision < 1n
  ) {
    throw new PlatformAuthenticationError("MEMBERSHIP_REJECTED");
  }

  return Object.freeze({
    schemaVersion: "platform-auth-context/v1",
    boundary: "platform",
    principal: Object.freeze({
      type: "human",
      id: membership.id,
      oidcSubject: membership.oidcSubject,
    }),
    permissions: normalizePermissions(membership.permissions, input.policy.allowedPermissions),
    authorizationRevision: membership.authorizationRevision,
    authenticatedAt: identity.authenticatedAt.toISOString(),
    correlationId: input.correlationId,
  });
}

export function requirePlatformPermission(
  context: PlatformAuthContext,
  requiredPermission: string,
): void {
  if (
    context.boundary !== "platform" ||
    !permissionPattern.test(requiredPermission) ||
    !context.permissions.includes(requiredPermission)
  ) {
    throw new PlatformAuthorizationError();
  }
}
