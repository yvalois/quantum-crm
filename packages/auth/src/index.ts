export {
  authenticatePlatformOperator,
  PlatformAuthenticationError,
  PlatformAuthorizationError,
  requirePlatformPermission,
  type OidcAccessTokenVerifier,
  type PlatformAuthContext,
  type PlatformAuthenticationFailure,
  type PlatformAuthPolicy,
  type PlatformMembershipReader,
  type PlatformMembershipSnapshot,
  type VerifiedOidcIdentity,
} from "./platform-auth.js";

export const packageIdentity = "@quantum-crm/auth" as const;
