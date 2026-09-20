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
export {
  createKeycloakOidcAccessTokenVerifier,
  OidcAccessTokenVerificationError,
  type KeycloakOidcVerifierOptions,
} from "./keycloak-oidc-verifier.js";

export const OIDC_ACCESS_TOKEN_VERIFIER = Symbol("OIDC_ACCESS_TOKEN_VERIFIER");

export const packageIdentity = "@quantum-crm/auth" as const;
