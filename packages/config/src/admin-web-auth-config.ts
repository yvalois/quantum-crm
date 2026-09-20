import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import type { QcrmEnvironment } from "./process-config.js";
import {
  loadSecretFile,
  SecretFileError,
  type SecretFileSystem,
  type SecretValue,
} from "./secret-value.js";

export const adminWebOidcClientSecretPath = "/run/secrets/qcrm_oidc_client_secret";
export const adminWebSessionRedisUrlPath = "/run/secrets/qcrm_session_redis_url";

export interface AdminWebAuthConfig {
  readonly schemaVersion: "admin-web-auth-config/v1";
  readonly environment: QcrmEnvironment;
  readonly origin: string;
  readonly adminApiOrigin: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: SecretValue;
  readonly redisUrl: SecretValue;
  readonly callbackUrl: string;
  readonly signedOutUrl: string;
  readonly requiredAcr: "2";
  readonly loginTransactionTtlSeconds: 300;
  readonly sessionIdleTtlSeconds: 1800;
  readonly sessionAbsoluteTtlSeconds: 28800;
  readonly secureCookies: boolean;
}

function protectedEnvironment(environment: QcrmEnvironment): boolean {
  return environment === "preview" || environment === "staging" || environment === "production";
}

function exactOrigin(value: string, environment: QcrmEnvironment): URL | undefined {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      (protectedEnvironment(environment) && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function keycloakIssuer(value: string, environment: QcrmEnvironment): URL | undefined {
  const url = exactOrigin(value.replace(/\/$/u, ""), environment);
  if (url) {
    return undefined;
  }

  try {
    const issuer = new URL(value);
    if (
      !["http:", "https:"].includes(issuer.protocol) ||
      (protectedEnvironment(environment) && issuer.protocol !== "https:") ||
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash ||
      !/^\/(?:[A-Za-z0-9._~-]+\/)*realms\/[A-Za-z0-9._-]+$/u.test(issuer.pathname)
    ) {
      return undefined;
    }
    return issuer;
  } catch {
    return undefined;
  }
}

export function parseAdminWebAuthConfig(
  environment: Readonly<Record<string, string | undefined>>,
  fileSystem?: SecretFileSystem,
): AdminWebAuthConfig {
  const environmentName = z
    .enum(["local", "test", "preview", "staging", "production"])
    .safeParse(environment.QCRM_ENV ?? "local");
  const clientId = z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u)
    .safeParse(environment.QCRM_OIDC_CLIENT_ID);
  const parsedEnvironment = environmentName.success ? environmentName.data : "production";
  const originValue = z.string().trim().url().safeParse(environment.QCRM_ADMIN_WEB_ORIGIN);
  const issuerValue = z.string().trim().url().safeParse(environment.QCRM_OIDC_ISSUER);
  const adminApiOriginValue = z.string().trim().url().safeParse(environment.QCRM_ADMIN_API_ORIGIN);
  const origin = originValue.success ? exactOrigin(originValue.data, parsedEnvironment) : undefined;
  const issuer = issuerValue.success
    ? keycloakIssuer(issuerValue.data, parsedEnvironment)
    : undefined;
  const adminApiOrigin = adminApiOriginValue.success
    ? exactOrigin(adminApiOriginValue.data, "local")
    : undefined;
  const invalid = [
    ...(environmentName.success ? [] : ["QCRM_ENV"]),
    ...(origin ? [] : ["QCRM_ADMIN_WEB_ORIGIN"]),
    ...(issuer ? [] : ["QCRM_OIDC_ISSUER"]),
    ...(adminApiOrigin ? [] : ["QCRM_ADMIN_API_ORIGIN"]),
    ...(clientId.success ? [] : ["QCRM_OIDC_CLIENT_ID"]),
  ];

  if (!environmentName.success || !origin || !adminApiOrigin || !issuer || !clientId.success) {
    throw new ConfigurationError("admin-web", invalid);
  }

  try {
    const clientSecret = loadSecretFile(
      "QCRM_OIDC_CLIENT_SECRET_FILE",
      environment.QCRM_OIDC_CLIENT_SECRET_FILE ?? "",
      {
        environment: environmentName.data,
        expectedProtectedPath: adminWebOidcClientSecretPath,
        ...(fileSystem ? { fileSystem } : {}),
      },
    );
    const redisUrl = loadSecretFile(
      "QCRM_SESSION_REDIS_URL_FILE",
      environment.QCRM_SESSION_REDIS_URL_FILE ?? "",
      {
        environment: environmentName.data,
        expectedProtectedPath: adminWebSessionRedisUrlPath,
        ...(fileSystem ? { fileSystem } : {}),
      },
    );
    const parsedRedisUrl = new URL(redisUrl.expose());
    if (!(
      ["redis:", "rediss:"].includes(parsedRedisUrl.protocol) && parsedRedisUrl.pathname !== ""
    )) {
      throw new Error("Invalid Redis URL");
    }

    const normalizedOrigin = origin.origin;
    const normalizedIssuer = issuer.toString();
    return Object.freeze({
      schemaVersion: "admin-web-auth-config/v1",
      environment: environmentName.data,
      origin: normalizedOrigin,
      adminApiOrigin: adminApiOrigin.origin,
      issuer: normalizedIssuer,
      clientId: clientId.data,
      clientSecret,
      redisUrl,
      callbackUrl: `${normalizedOrigin}/api/auth/callback/keycloak`,
      signedOutUrl: `${normalizedOrigin}/signed-out`,
      requiredAcr: "2",
      loginTransactionTtlSeconds: 300,
      sessionIdleTtlSeconds: 1800,
      sessionAbsoluteTtlSeconds: 28800,
      secureCookies: origin.protocol === "https:",
    });
  } catch (error) {
    if (error instanceof SecretFileError && error.message.includes("OIDC")) {
      throw new ConfigurationError("admin-web", ["QCRM_OIDC_CLIENT_SECRET_FILE"]);
    }
    if (error instanceof SecretFileError) {
      throw new ConfigurationError("admin-web", ["QCRM_SESSION_REDIS_URL_FILE"]);
    }
    throw new ConfigurationError("admin-web", ["QCRM_SESSION_REDIS_URL_FILE"]);
  }
}

export function loadAdminWebAuthConfig(): AdminWebAuthConfig {
  return parseAdminWebAuthConfig(process.env);
}
