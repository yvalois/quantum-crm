import type { SecretValue } from "@quantum-crm/config";
import { CrmPermissionSchema, type CrmPermission } from "@quantum-crm/contracts";

import type { OidcAccessTokenVerifier, VerifiedOidcIdentity } from "./oidc-access-token.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const subjectPattern = /^[!-~]{1,255}$/u;
const correlationIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

export interface CrmMembershipSnapshot {
  readonly id: string;
  readonly oidcSubject: string;
  readonly status: "INVITED" | "ACTIVE" | "DEACTIVATED";
  readonly permissions: readonly string[];
  readonly authorizationRevision: bigint;
  readonly commercialScope?: "PROFILE" | "OWN";
}

export interface CrmMembershipReader {
  findAuthorizationByOidcSubject(oidcSubject: string): Promise<CrmMembershipSnapshot | null>;
}

export interface CrmAuthPolicy {
  readonly tenantId: string;
  readonly issuer: string;
  readonly audience: string;
  readonly allowedPermissions: readonly CrmPermission[];
}

export interface CrmAuthContext {
  readonly schemaVersion: "crm-auth-context/v1";
  readonly boundary: "crm";
  readonly tenantId: string;
  readonly principal: Readonly<{
    type: "human";
    id: string;
    oidcSubject: string;
  }>;
  readonly permissions: readonly CrmPermission[];
  readonly authorizationRevision: bigint;
  readonly commercialScope: "PROFILE" | "OWN";
  readonly authenticatedAt: string;
  readonly correlationId: string;
}

export type CrmAuthenticationFailure = "IDENTITY_REJECTED" | "MEMBERSHIP_REJECTED";

export class CrmAuthenticationError extends Error {
  public constructor(public readonly code: CrmAuthenticationFailure) {
    super("CRM authentication denied");
    this.name = "CrmAuthenticationError";
  }
}

export class CrmAuthorizationError extends Error {
  public constructor() {
    super("CRM authorization denied");
    this.name = "CrmAuthorizationError";
  }
}

function rejectIdentity(): never {
  throw new CrmAuthenticationError("IDENTITY_REJECTED");
}

function normalizePermissions(
  permissions: readonly string[],
  allowedPermissions: readonly CrmPermission[],
): readonly CrmPermission[] {
  const allowed = new Set(allowedPermissions);
  if (
    allowed.size !== allowedPermissions.length ||
    allowedPermissions.some((permission) => !CrmPermissionSchema.safeParse(permission).success) ||
    permissions.some(
      (permission) => !CrmPermissionSchema.safeParse(permission).success || !allowed.has(permission as CrmPermission),
    )
  ) {
    throw new CrmAuthenticationError("MEMBERSHIP_REJECTED");
  }
  return Object.freeze([...new Set(permissions as readonly CrmPermission[])].sort());
}

function isValidIdentity(
  identity: VerifiedOidcIdentity,
  policy: CrmAuthPolicy,
  correlationId: string,
  now: Date,
): boolean {
  return (
    identity.verification === "oidc-access-token/v1" &&
    identity.issuer === policy.issuer &&
    identity.audiences.includes(policy.audience) &&
    identity.principalType === "human" &&
    subjectPattern.test(identity.subject) &&
    identity.authenticatedAt instanceof Date &&
    !Number.isNaN(identity.authenticatedAt.getTime()) &&
    !Number.isNaN(now.getTime()) &&
    identity.authenticatedAt.getTime() <= now.getTime() + 60_000 &&
    correlationIdPattern.test(correlationId) &&
    uuidPattern.test(policy.tenantId)
  );
}

export async function authenticateCrmMember(input: {
  readonly accessToken: SecretValue;
  readonly verifier: OidcAccessTokenVerifier;
  readonly memberships: CrmMembershipReader;
  readonly policy: CrmAuthPolicy;
  readonly correlationId: string;
  readonly now?: Date;
}): Promise<CrmAuthContext> {
  let identity: VerifiedOidcIdentity;
  try {
    identity = await input.verifier.verifyAccessToken(input.accessToken);
  } catch {
    return rejectIdentity();
  }
  const now = input.now ?? new Date();
  if (!isValidIdentity(identity, input.policy, input.correlationId, now)) return rejectIdentity();

  const membership = await input.memberships.findAuthorizationByOidcSubject(identity.subject);
  if (
    membership === null ||
    membership.oidcSubject !== identity.subject ||
    membership.status !== "ACTIVE" ||
    !uuidPattern.test(membership.id) ||
    membership.authorizationRevision < 1n ||
    !Array.isArray(membership.permissions)
  ) {
    throw new CrmAuthenticationError("MEMBERSHIP_REJECTED");
  }
  return Object.freeze({
    schemaVersion: "crm-auth-context/v1",
    boundary: "crm",
    tenantId: input.policy.tenantId,
    principal: Object.freeze({
      type: "human",
      id: membership.id,
      oidcSubject: membership.oidcSubject,
    }),
    permissions: normalizePermissions(membership.permissions, input.policy.allowedPermissions),
    authorizationRevision: membership.authorizationRevision,
    commercialScope: membership.commercialScope === "PROFILE" ? "PROFILE" : "OWN",
    authenticatedAt: identity.authenticatedAt.toISOString(),
    correlationId: input.correlationId,
  });
}

export function requireCrmPermission(context: CrmAuthContext, requiredPermission: CrmPermission): void {
  if (
    context.boundary !== "crm" ||
    !CrmPermissionSchema.safeParse(requiredPermission).success ||
    !context.permissions.includes(requiredPermission)
  ) {
    throw new CrmAuthorizationError();
  }
}
