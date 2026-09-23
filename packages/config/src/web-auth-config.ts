import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import type { QcrmEnvironment } from "./process-config.js";
import {
  loadSecretFile,
  SecretFileError,
  type SecretFileSystem,
  type SecretValue,
} from "./secret-value.js";

export interface WebAuthConfig {
  readonly schemaVersion: string;
  readonly environment: QcrmEnvironment;
  readonly origin: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: SecretValue;
  readonly redisUrl: SecretValue;
  readonly sessionNamespace: string;
  readonly callbackUrl: string;
  readonly signedOutUrl: string;
  readonly requiredAcr: "2";
  readonly loginTransactionTtlSeconds: 300;
  readonly sessionIdleTtlSeconds: 1800;
  readonly sessionAbsoluteTtlSeconds: 28800;
  readonly secureCookies: boolean;
}

export interface ParsedWebAuthConfig extends Omit<WebAuthConfig, "schemaVersion"> {
  readonly apiOrigin: string;
}

export interface WebAuthConfigOptions {
  readonly application: string;
  readonly originEnvironmentKey: string;
  readonly apiOriginEnvironmentKey: string;
  readonly clientSecretPath: string;
  readonly redisUrlPath: string;
  readonly sessionNamespace: string;
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

export function parseWebAuthConfig(
  environment: Readonly<Record<string, string | undefined>>,
  options: WebAuthConfigOptions,
  fileSystem?: SecretFileSystem,
): ParsedWebAuthConfig {
  const environmentName = z
    .enum(["local", "test", "preview", "staging", "production"])
    .safeParse(environment.QCRM_ENV ?? "local");
  const parsedEnvironment = environmentName.success ? environmentName.data : "production";
  const originValue = z.string().trim().url().safeParse(environment[options.originEnvironmentKey]);
  const issuerValue = z.string().trim().url().safeParse(environment.QCRM_OIDC_ISSUER);
  const apiOriginValue = z
    .string()
    .trim()
    .url()
    .safeParse(environment[options.apiOriginEnvironmentKey]);
  const clientId = z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u)
    .safeParse(environment.QCRM_OIDC_CLIENT_ID);
  const origin = originValue.success ? exactOrigin(originValue.data, parsedEnvironment) : undefined;
  const issuer = issuerValue.success
    ? keycloakIssuer(issuerValue.data, parsedEnvironment)
    : undefined;
  const apiOrigin = apiOriginValue.success ? exactOrigin(apiOriginValue.data, "local") : undefined;
  const namespace = z
    .string()
    .regex(/^[a-z][a-z0-9:-]{0,127}$/u)
    .safeParse(options.sessionNamespace);
  const invalid = [
    ...(environmentName.success ? [] : ["QCRM_ENV"]),
    ...(origin ? [] : [options.originEnvironmentKey]),
    ...(issuer ? [] : ["QCRM_OIDC_ISSUER"]),
    ...(apiOrigin ? [] : [options.apiOriginEnvironmentKey]),
    ...(clientId.success ? [] : ["QCRM_OIDC_CLIENT_ID"]),
    ...(namespace.success ? [] : ["sessionNamespace"]),
  ];
  if (
    !environmentName.success ||
    !origin ||
    !issuer ||
    !apiOrigin ||
    !clientId.success ||
    !namespace.success
  ) {
    throw new ConfigurationError(options.application, invalid);
  }

  let clientSecret: SecretValue;
  try {
    clientSecret = loadSecretFile(
      "QCRM_OIDC_CLIENT_SECRET_FILE",
      environment.QCRM_OIDC_CLIENT_SECRET_FILE ?? "",
      {
        environment: environmentName.data,
        expectedProtectedPath: options.clientSecretPath,
        ...(fileSystem ? { fileSystem } : {}),
      },
    );
  } catch (error) {
    if (error instanceof SecretFileError) {
      throw new ConfigurationError(options.application, ["QCRM_OIDC_CLIENT_SECRET_FILE"]);
    }
    throw error;
  }

  let redisUrl: SecretValue;
  try {
    redisUrl = loadSecretFile(
      "QCRM_SESSION_REDIS_URL_FILE",
      environment.QCRM_SESSION_REDIS_URL_FILE ?? "",
      {
        environment: environmentName.data,
        expectedProtectedPath: options.redisUrlPath,
        ...(fileSystem ? { fileSystem } : {}),
      },
    );
    const parsedRedisUrl = new URL(redisUrl.expose());
    if (
      !["redis:", "rediss:"].includes(parsedRedisUrl.protocol) ||
      parsedRedisUrl.pathname === ""
    ) {
      throw new Error("Invalid Redis URL");
    }
  } catch {
    throw new ConfigurationError(options.application, ["QCRM_SESSION_REDIS_URL_FILE"]);
  }

  const normalizedOrigin = origin.origin;
  return Object.freeze({
    environment: environmentName.data,
    origin: normalizedOrigin,
    apiOrigin: apiOrigin.origin,
    issuer: issuer.toString(),
    clientId: clientId.data,
    clientSecret,
    redisUrl,
    sessionNamespace: namespace.data,
    callbackUrl: `${normalizedOrigin}/api/auth/callback/keycloak`,
    signedOutUrl: `${normalizedOrigin}/signed-out`,
    requiredAcr: "2",
    loginTransactionTtlSeconds: 300,
    sessionIdleTtlSeconds: 1800,
    sessionAbsoluteTtlSeconds: 28800,
    secureCookies: origin.protocol === "https:",
  });
}
