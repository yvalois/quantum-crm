import type { SecretValue } from "@quantum-crm/config";

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
