import type { OidcConfig, SecretValue } from "@quantum-crm/config";
import {
  createRemoteJWKSet,
  jwtVerify,
  type CryptoKey,
  type FlattenedJWSInput,
  type JWSHeaderParameters,
} from "jose";

import type { OidcAccessTokenVerifier, VerifiedOidcIdentity } from "./platform-auth.js";

type JwksResolver = (
  protectedHeader?: JWSHeaderParameters,
  token?: FlattenedJWSInput,
) => Promise<CryptoKey>;

export interface KeycloakOidcVerifierOptions {
  readonly keyResolver?: JwksResolver;
  readonly currentDate?: () => Date;
}

export class OidcAccessTokenVerificationError extends Error {
  public constructor() {
    super("OIDC access token verification failed");
    this.name = "OidcAccessTokenVerificationError";
  }
}

function audiences(value: string | readonly string[] | undefined): readonly string[] {
  if (typeof value === "string") {
    return Object.freeze([value]);
  }

  if (Array.isArray(value) && value.every((audience) => typeof audience === "string")) {
    return Object.freeze([...value]);
  }

  throw new OidcAccessTokenVerificationError();
}

export function createKeycloakOidcAccessTokenVerifier(
  config: OidcConfig,
  options: KeycloakOidcVerifierOptions = {},
): OidcAccessTokenVerifier {
  const keyResolver =
    options.keyResolver ??
    createRemoteJWKSet(new URL(config.jwksUrl), {
      timeoutDuration: config.jwksTimeoutMs,
      cooldownDuration: config.jwksCooldownMs,
      cacheMaxAge: config.jwksCacheMaxAgeMs,
    });

  return Object.freeze({
    verifyAccessToken: async (accessToken: SecretValue): Promise<VerifiedOidcIdentity> => {
      try {
        const compactToken = accessToken.expose();
        if (compactToken.length < 1 || compactToken.length > 16_384 || /\s/u.test(compactToken)) {
          throw new OidcAccessTokenVerificationError();
        }

        const currentDate = options.currentDate?.();
        const { payload, protectedHeader } = await jwtVerify(compactToken, keyResolver, {
          algorithms: [...config.allowedAlgorithms],
          issuer: config.issuer,
          audience: config.audience,
          requiredClaims: ["sub", "iat", "exp", "auth_time", "typ", "acr", "qcrm_principal_type"],
          maxTokenAge: config.maxTokenAgeSeconds,
          clockTolerance: config.clockToleranceSeconds,
          ...(currentDate ? { currentDate } : {}),
        });

        if (
          protectedHeader.alg !== "RS256" ||
          (protectedHeader.typ !== "JWT" && protectedHeader.typ !== "at+jwt") ||
          typeof protectedHeader.kid !== "string" ||
          protectedHeader.kid.length < 1 ||
          protectedHeader.kid.length > 128 ||
          protectedHeader.jku !== undefined ||
          protectedHeader.jwk !== undefined ||
          protectedHeader.x5u !== undefined ||
          protectedHeader.x5c !== undefined ||
          payload.typ !== "Bearer" ||
          payload.qcrm_principal_type !== "human" ||
          payload.acr !== config.requiredAcr ||
          typeof payload.sub !== "string" ||
          typeof payload.iss !== "string" ||
          typeof payload.iat !== "number" ||
          typeof payload.auth_time !== "number" ||
          !Number.isInteger(payload.auth_time) ||
          payload.auth_time < 0 ||
          payload.auth_time > payload.iat + config.clockToleranceSeconds
        ) {
          throw new OidcAccessTokenVerificationError();
        }

        return Object.freeze({
          verification: "oidc-access-token/v1",
          subject: payload.sub,
          issuer: payload.iss,
          audiences: audiences(payload.aud),
          principalType: "human",
          multiFactorAuthenticated: true,
          authenticatedAt: new Date(payload.auth_time * 1_000),
        });
      } catch {
        throw new OidcAccessTokenVerificationError();
      }
    },
  });
}
