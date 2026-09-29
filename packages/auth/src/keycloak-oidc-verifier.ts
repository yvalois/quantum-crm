import type { OidcConfig, SecretValue } from "@quantum-crm/config";
import { ServicePermissionSchema } from "@quantum-crm/contracts";
import {
  createRemoteJWKSet,
  jwtVerify,
  type CryptoKey,
  type FlattenedJWSInput,
  type JWSHeaderParameters,
} from "jose";

import type { OidcAccessTokenVerifier, VerifiedOidcIdentity } from "./oidc-access-token.js";

type JwksResolver = (
  protectedHeader?: JWSHeaderParameters,
  token?: FlattenedJWSInput,
) => Promise<CryptoKey>;

export interface KeycloakOidcVerifierOptions {
  readonly keyResolver?: JwksResolver;
  readonly currentDate?: () => Date;
  readonly expectedPrincipalType?: "human" | "service";
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

function servicePermissions(value: unknown): readonly string[] {
  if (typeof value !== "string") return Object.freeze([]);
  const permissions = value
    .split(" ")
    .filter((entry) => /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/u.test(entry))
    .filter((entry) => ServicePermissionSchema.safeParse(entry).success);
  return Object.freeze([...new Set(permissions)].sort());
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
        const claimedPrincipalType = payloadPrincipalTypeHint(compactToken);
        const expectedPrincipalType = options.expectedPrincipalType ?? claimedPrincipalType;
        const { payload, protectedHeader } = await jwtVerify(compactToken, keyResolver, {
          algorithms: [...config.allowedAlgorithms],
          issuer: config.issuer,
          audience: config.audience,
          requiredClaims:
            expectedPrincipalType === "human"
              ? ["sub", "iat", "exp", "auth_time", "typ", "acr", "qcrm_principal_type"]
              : ["sub", "iat", "exp", "typ", "azp", "qcrm_principal_type"],
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
          (payload.qcrm_principal_type !== "human" && payload.qcrm_principal_type !== "service") ||
          payload.qcrm_principal_type !== expectedPrincipalType ||
          typeof payload.sub !== "string" ||
          typeof payload.iss !== "string" ||
          typeof payload.iat !== "number" ||
          (expectedPrincipalType === "human" &&
            (payload.acr !== config.requiredAcr ||
              typeof payload.auth_time !== "number" ||
              !Number.isInteger(payload.auth_time) ||
              payload.auth_time < 0 ||
              payload.auth_time > payload.iat + config.clockToleranceSeconds)) ||
          (expectedPrincipalType === "service" &&
            (typeof payload.azp !== "string" || !/^[a-z][a-z0-9-]{2,62}$/u.test(payload.azp)))
        ) {
          throw new OidcAccessTokenVerificationError();
        }

        return Object.freeze({
          verification: "oidc-access-token/v1",
          subject: payload.sub,
          issuer: payload.iss,
          audiences: audiences(payload.aud),
          principalType: expectedPrincipalType,
          ...(expectedPrincipalType === "service"
            ? {
                clientId: payload.azp as string,
                servicePermissions: servicePermissions(
                  payload.qcrm_service_permissions ?? payload.scope,
                ),
              }
            : {}),
          multiFactorAuthenticated: expectedPrincipalType === "human",
          authenticatedAt: new Date(
            (expectedPrincipalType === "human" ? (payload.auth_time as number) : payload.iat) *
              1_000,
          ),
        });
      } catch {
        throw new OidcAccessTokenVerificationError();
      }
    },
  });
}

function payloadPrincipalTypeHint(compactToken: string): "human" | "service" {
  try {
    const encoded = compactToken.split(".")[1];
    if (!encoded) throw new Error("missing payload");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      qcrm_principal_type?: unknown;
    };
    return payload.qcrm_principal_type === "service" ? "service" : "human";
  } catch {
    return "human";
  }
}
