export { type OidcAccessTokenVerifier, type VerifiedOidcIdentity } from "./oidc-access-token.js";
export {
  authenticatePlatformOperator,
  PlatformAuthenticationError,
  PlatformAuthorizationError,
  requirePlatformPermission,
  type PlatformAuthContext,
  type PlatformAuthenticationFailure,
  type PlatformAuthPolicy,
  type PlatformMembershipReader,
  type PlatformMembershipSnapshot,
} from "./platform-auth.js";
export {
  authenticateCrmMember,
  CrmAuthenticationError,
  CrmAuthorizationError,
  requireCrmPermission,
  type CrmAuthContext,
  type CrmAuthenticationFailure,
  type CrmAuthPolicy,
  type CrmMembershipReader,
  type CrmMembershipSnapshot,
} from "./crm-auth.js";
export {
  createKeycloakOidcAccessTokenVerifier,
  OidcAccessTokenVerificationError,
  type KeycloakOidcVerifierOptions,
} from "./keycloak-oidc-verifier.js";

export const OIDC_ACCESS_TOKEN_VERIFIER = Symbol("OIDC_ACCESS_TOKEN_VERIFIER");
export const GITHUB_ACTIONS_RELEASE_PUBLISHER_VERIFIER = Symbol(
  "GITHUB_ACTIONS_RELEASE_PUBLISHER_VERIFIER",
);

export {
  createGithubActionsReleasePublisherVerifier,
  GithubActionsReleasePublisherVerificationError,
  type GithubActionsReleasePublisherVerifier,
  type GithubActionsReleasePublisherVerifierOptions,
  type VerifiedGithubActionsReleasePublisher,
} from "./github-actions-release-publisher-verifier.js";

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
