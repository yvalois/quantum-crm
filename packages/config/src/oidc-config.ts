import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import type { QcrmEnvironment } from "./process-config.js";

export const oidcEnvironmentKeys = Object.freeze([
  "QCRM_OIDC_ISSUER",
  "QCRM_OIDC_AUDIENCE",
  "QCRM_OIDC_REQUIRED_ACR",
  "QCRM_OIDC_MAX_TOKEN_AGE_SECONDS",
] as const);

export interface OidcDefinition {
  readonly provider: "keycloak";
  readonly boundary: "platform";
}

export interface OidcConfig {
  readonly schemaVersion: "oidc-config/v1";
  readonly provider: "keycloak";
  readonly boundary: "platform";
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUrl: string;
  readonly requiredAcr: string;
  readonly allowedAlgorithms: readonly ["RS256"];
  readonly maxTokenAgeSeconds: number;
  readonly clockToleranceSeconds: number;
  readonly jwksTimeoutMs: number;
  readonly jwksCooldownMs: number;
  readonly jwksCacheMaxAgeMs: number;
}

function isProtectedEnvironment(environment: QcrmEnvironment): boolean {
  return environment === "preview" || environment === "staging" || environment === "production";
}

function parseKeycloakIssuer(value: string, environment: QcrmEnvironment): URL | undefined {
  try {
    const issuer = new URL(value);
    if (
      !["http:", "https:"].includes(issuer.protocol) ||
      (isProtectedEnvironment(environment) && issuer.protocol !== "https:") ||
      issuer.username.length > 0 ||
      issuer.password.length > 0 ||
      issuer.search.length > 0 ||
      issuer.hash.length > 0 ||
      !/^\/(?:[A-Za-z0-9._~-]+\/)*realms\/[A-Za-z0-9._-]+$/u.test(issuer.pathname)
    ) {
      return undefined;
    }

    return issuer;
  } catch {
    return undefined;
  }
}

export function parseOidcConfig(
  serviceName: string,
  definition: OidcDefinition,
  environmentName: QcrmEnvironment,
  environment: Readonly<Record<string, string | undefined>>,
): OidcConfig {
  const issuerValue = z.string().trim().url().safeParse(environment.QCRM_OIDC_ISSUER);
  const audience = z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u)
    .safeParse(environment.QCRM_OIDC_AUDIENCE);
  const requiredAcr = z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u)
    .safeParse(environment.QCRM_OIDC_REQUIRED_ACR);
  const maxTokenAge = z.coerce
    .number()
    .int()
    .min(60)
    .max(900)
    .default(300)
    .safeParse(environment.QCRM_OIDC_MAX_TOKEN_AGE_SECONDS);
  const issuer = issuerValue.success
    ? parseKeycloakIssuer(issuerValue.data, environmentName)
    : undefined;

  const invalidKeys = [
    ...(issuer ? [] : ["QCRM_OIDC_ISSUER"]),
    ...(audience.success ? [] : ["QCRM_OIDC_AUDIENCE"]),
    ...(requiredAcr.success ? [] : ["QCRM_OIDC_REQUIRED_ACR"]),
    ...(maxTokenAge.success ? [] : ["QCRM_OIDC_MAX_TOKEN_AGE_SECONDS"]),
  ];
  if (issuer === undefined || !audience.success || !requiredAcr.success || !maxTokenAge.success) {
    throw new ConfigurationError(serviceName, invalidKeys);
  }

  const normalizedIssuer = issuer.toString();
  return Object.freeze({
    schemaVersion: "oidc-config/v1",
    provider: definition.provider,
    boundary: definition.boundary,
    issuer: normalizedIssuer,
    audience: audience.data,
    jwksUrl: `${normalizedIssuer}/protocol/openid-connect/certs`,
    requiredAcr: requiredAcr.data,
    allowedAlgorithms: Object.freeze(["RS256"] as const),
    maxTokenAgeSeconds: maxTokenAge.data,
    clockToleranceSeconds: 5,
    jwksTimeoutMs: 5_000,
    jwksCooldownMs: 30_000,
    jwksCacheMaxAgeMs: 600_000,
  });
}
