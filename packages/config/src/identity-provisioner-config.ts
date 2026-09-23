import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import type { QcrmEnvironment } from "./process-config.js";
import {
  loadSecretFile,
  SecretFileError,
  type SecretFileSystem,
  type SecretValue,
} from "./secret-value.js";

const keycloakProvisionerClientSecretPath = "/run/secrets/qcrm_keycloak_provisioner_client_secret";
const redisAdminUrlPath = "/run/secrets/qcrm_platform_redis_admin_url";

export const identityProvisionerEnvironmentKeys = Object.freeze([
  "QCRM_KEYCLOAK_ADMIN_ORIGIN",
  "QCRM_KEYCLOAK_PROVISIONER_CLIENT_ID",
  "QCRM_KEYCLOAK_PROVISIONER_CLIENT_SECRET_FILE",
  "QCRM_PLATFORM_IDENTITY_ORIGIN",
  "QCRM_PLATFORM_REDIS_ADMIN_URL_FILE",
] as const);

export interface IdentityProvisionerConfig {
  readonly schemaVersion: "identity-provisioner-config/v1";
  readonly keycloakAdminOrigin: string;
  readonly keycloakProvisionerClientId: string;
  readonly keycloakProvisionerClientSecret: SecretValue;
  readonly identityOrigin: string;
  readonly redisAdminUrl: SecretValue;
}

function exactOrigin(value: string, protocols: readonly string[]): string | undefined {
  try {
    const url = new URL(value);
    if (
      !protocols.includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export function parseIdentityProvisionerConfig(
  serviceName: string,
  environmentName: QcrmEnvironment,
  environment: Readonly<Record<string, string | undefined>>,
  fileSystem?: SecretFileSystem,
): IdentityProvisionerConfig {
  const adminOrigin = z
    .string()
    .trim()
    .transform((value) => exactOrigin(value, ["http:", "https:"]))
    .safeParse(environment.QCRM_KEYCLOAK_ADMIN_ORIGIN);
  const identityOrigin = z
    .string()
    .trim()
    .transform((value) => exactOrigin(value, ["https:"]))
    .safeParse(environment.QCRM_PLATFORM_IDENTITY_ORIGIN);
  const clientId = z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]{2,62}$/u)
    .safeParse(environment.QCRM_KEYCLOAK_PROVISIONER_CLIENT_ID);
  if (!adminOrigin.success || !adminOrigin.data) {
    throw new ConfigurationError(serviceName, ["QCRM_KEYCLOAK_ADMIN_ORIGIN"]);
  }
  if (!identityOrigin.success || !identityOrigin.data) {
    throw new ConfigurationError(serviceName, ["QCRM_PLATFORM_IDENTITY_ORIGIN"]);
  }
  if (!clientId.success) {
    throw new ConfigurationError(serviceName, ["QCRM_KEYCLOAK_PROVISIONER_CLIENT_ID"]);
  }

  const load = (
    key: string,
    value: string | undefined,
    expectedPath: string,
    logicalName: string,
  ) => {
    if (!z.string().trim().min(1).safeParse(value).success) {
      throw new ConfigurationError(serviceName, [key]);
    }
    try {
      return loadSecretFile(logicalName, value ?? "", {
        environment: environmentName,
        expectedProtectedPath: expectedPath,
        ...(fileSystem ? { fileSystem } : {}),
      });
    } catch (error) {
      if (error instanceof SecretFileError) throw new ConfigurationError(serviceName, [key]);
      throw error;
    }
  };

  const keycloakProvisionerClientSecret = load(
    "QCRM_KEYCLOAK_PROVISIONER_CLIENT_SECRET_FILE",
    environment.QCRM_KEYCLOAK_PROVISIONER_CLIENT_SECRET_FILE,
    keycloakProvisionerClientSecretPath,
    "Keycloak provisioner client secret",
  );
  const redisAdminUrl = load(
    "QCRM_PLATFORM_REDIS_ADMIN_URL_FILE",
    environment.QCRM_PLATFORM_REDIS_ADMIN_URL_FILE,
    redisAdminUrlPath,
    "platform Redis admin URL",
  );
  try {
    const redis = new URL(redisAdminUrl.expose());
    if (
      !["redis:", "rediss:"].includes(redis.protocol) ||
      !redis.username ||
      !redis.password ||
      !redis.hostname ||
      redis.pathname !== "/0"
    ) {
      throw new Error("invalid Redis URL");
    }
  } catch {
    throw new ConfigurationError(serviceName, ["QCRM_PLATFORM_REDIS_ADMIN_URL_FILE"]);
  }

  return Object.freeze({
    schemaVersion: "identity-provisioner-config/v1",
    keycloakAdminOrigin: adminOrigin.data,
    keycloakProvisionerClientId: clientId.data,
    keycloakProvisionerClientSecret,
    identityOrigin: identityOrigin.data,
    redisAdminUrl,
  });
}
