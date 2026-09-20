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

export {
  KeycloakPlatformOidcProvider,
  PlatformWebAuthenticationError,
  PlatformWebAuthService,
  type PlatformLoginCompletion,
  type PlatformLoginStart,
  type PlatformOidcProvider,
  type PlatformOidcRefreshTokenSet,
  type PlatformOidcTokenSet,
} from "./platform-web-auth.js";
export {
  newCsrfToken,
  newOpaqueHandle,
  PlatformSessionError,
  safeReturnTo,
  sessionKey,
  validateCsrf,
  validateRequestOrigin,
  type PlatformLoginTransaction,
  type PlatformSessionStore,
  type PlatformWebSession,
} from "./platform-web-session.js";
export {
  createRedisPlatformSessionStore,
  RedisPlatformSessionStore,
  type PlatformSessionRedisClient,
} from "./redis-platform-session-store.js";

export const packageIdentity = "@quantum-crm/auth" as const;
