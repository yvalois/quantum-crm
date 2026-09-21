import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import {
  databaseEnvironmentKeys,
  databaseAdminEnvironmentKeys,
  parseDatabaseConfig,
  type DatabaseConfig,
  type DatabaseDefinition,
} from "./database-config.js";
import {
  oidcEnvironmentKeys,
  parseOidcConfig,
  type OidcConfig,
  type OidcDefinition,
} from "./oidc-config.js";
import type { SecretFileSystem } from "./secret-value.js";
import {
  parseStorageConfig,
  storageEnvironmentKeys,
  type StorageConfig,
} from "./storage-config.js";

const qcrmEnvironmentSchema = z.enum(["local", "test", "preview", "staging", "production"]);
const processEnvironmentKeys = [
  "QCRM_ENV",
  "QCRM_HOST",
  "QCRM_PORT",
  "QCRM_SHUTDOWN_TIMEOUT_MS",
] as const;
const tenantSecretEnvironmentKey = "QCRM_TENANT_SECRET_DIRECTORY" as const;
const tenantConfigurationEnvironmentKey = "QCRM_TENANT_CONFIGURATION_DIRECTORY" as const;
const safeDefaultEnvironments = new Set<QcrmEnvironment>(["local", "test"]);
const placeholderPattern = /^(?:change[_-]?me|example|placeholder|todo)$/i;

export type QcrmEnvironment = z.infer<typeof qcrmEnvironmentSchema>;

export const processDefinitions = Object.freeze({
  api: Object.freeze({
    serviceName: "api",
    defaultHost: "0.0.0.0",
    defaultPort: 3001,
    database: Object.freeze({ target: "crm", requiresTenant: true }),
  }),
  "admin-api": Object.freeze({
    serviceName: "admin-api",
    defaultHost: "0.0.0.0",
    defaultPort: 3002,
    database: Object.freeze({ target: "platform", requiresTenant: false }),
    oidc: Object.freeze({ provider: "keycloak", boundary: "platform" }),
  }),
  worker: Object.freeze({
    serviceName: "worker",
    defaultHost: "127.0.0.1",
    defaultPort: 3101,
    database: Object.freeze({ target: "crm", requiresTenant: true }),
  }),
  "deploy-executor": Object.freeze({
    serviceName: "deploy-executor",
    defaultHost: "127.0.0.1",
    defaultPort: 3102,
    database: Object.freeze({ target: "platform", requiresTenant: false, requiresAdmin: true }),
    requiresTenantSecretDirectory: true,
    requiresTenantConfigurationDirectory: true,
    requiresStorageAdmin: true,
  }),
  "agent-runtime": Object.freeze({
    serviceName: "agent-runtime",
    defaultHost: "127.0.0.1",
    defaultPort: 3103,
  }),
});

export type ProcessName = keyof typeof processDefinitions;

export interface ProcessDefinition {
  readonly serviceName: string;
  readonly defaultHost: string;
  readonly defaultPort: number;
  readonly database?: DatabaseDefinition;
  readonly oidc?: OidcDefinition;
  readonly requiresTenantSecretDirectory?: boolean;
  readonly requiresTenantConfigurationDirectory?: boolean;
  readonly requiresStorageAdmin?: boolean;
}

export interface ProcessConfig {
  readonly schemaVersion: "process-config/v1";
  readonly serviceName: string;
  readonly environment: QcrmEnvironment;
  readonly host: string;
  readonly port: number;
  readonly shutdownTimeoutMs: number;
  readonly database?: DatabaseConfig;
  readonly oidc?: OidcConfig;
  readonly tenantSecretDirectory?: string;
  readonly tenantConfigurationDirectory?: string;
  readonly storage?: StorageConfig;
}

function readEnvironment(): NodeJS.ProcessEnv {
  return process.env;
}

export function loadProcessConfig(definition: ProcessDefinition): ProcessConfig {
  return parseProcessConfig(definition, readEnvironment());
}

export function loadServiceConfig(serviceName: ProcessName): ProcessConfig {
  return parseServiceConfig(serviceName, readEnvironment());
}

export function requireDatabaseConfig(config: ProcessConfig): DatabaseConfig {
  if (!config.database) {
    throw new ConfigurationError(config.serviceName, ["QCRM_DATABASE_URL_FILE"]);
  }

  return config.database;
}

export function requireOidcConfig(config: ProcessConfig): OidcConfig {
  if (!config.oidc) {
    throw new ConfigurationError(config.serviceName, ["QCRM_OIDC_ISSUER"]);
  }

  return config.oidc;
}

export function parseServiceConfig(
  serviceName: ProcessName,
  environment: Readonly<Record<string, string | undefined>>,
  fileSystem?: SecretFileSystem,
): ProcessConfig {
  return parseProcessConfig(processDefinitions[serviceName], environment, fileSystem);
}

export function parseProcessConfig(
  definition: ProcessDefinition,
  environment: Readonly<Record<string, string | undefined>>,
  fileSystem?: SecretFileSystem,
): ProcessConfig {
  const allowedKeys = new Set<string>([
    ...processEnvironmentKeys,
    ...(definition.database ? databaseEnvironmentKeys : []),
    ...(definition.database?.requiresAdmin ? databaseAdminEnvironmentKeys : []),
    ...(definition.oidc ? oidcEnvironmentKeys : []),
    ...(definition.requiresTenantSecretDirectory ? [tenantSecretEnvironmentKey] : []),
    ...(definition.requiresTenantConfigurationDirectory ? [tenantConfigurationEnvironmentKey] : []),
    ...(definition.requiresStorageAdmin ? storageEnvironmentKeys : []),
  ]);
  const unknownKeys = Object.keys(environment)
    .filter((key) => key.startsWith("QCRM_") && !allowedKeys.has(key))
    .sort();

  if (unknownKeys.length > 0) {
    throw new ConfigurationError(definition.serviceName, unknownKeys);
  }

  const parsedEnvironment = qcrmEnvironmentSchema.safeParse(environment.QCRM_ENV ?? "local");
  if (!parsedEnvironment.success) {
    throw new ConfigurationError(definition.serviceName, ["QCRM_ENV"]);
  }

  const allowSafeDefaults = safeDefaultEnvironments.has(parsedEnvironment.data);
  const hostSchema = z
    .string()
    .trim()
    .min(1)
    .refine((value) => !placeholderPattern.test(value));

  const schema = z.object({
    QCRM_ENV: qcrmEnvironmentSchema,
    QCRM_HOST: hostSchema,
    QCRM_PORT: z.coerce.number().int().min(1).max(65_535),
    QCRM_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
  });
  const result = schema.safeParse({
    ...environment,
    QCRM_ENV: parsedEnvironment.data,
    QCRM_HOST: environment.QCRM_HOST ?? (allowSafeDefaults ? definition.defaultHost : undefined),
    QCRM_PORT: environment.QCRM_PORT ?? (allowSafeDefaults ? definition.defaultPort : undefined),
  });

  if (!result.success) {
    const invalidKeys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))]
      .filter((key) => key !== "undefined")
      .sort();
    throw new ConfigurationError(definition.serviceName, invalidKeys);
  }

  const database = definition.database
    ? parseDatabaseConfig(
        definition.serviceName,
        definition.database,
        result.data.QCRM_ENV,
        environment,
        fileSystem,
      )
    : undefined;
  const oidc = definition.oidc
    ? parseOidcConfig(definition.serviceName, definition.oidc, result.data.QCRM_ENV, environment)
    : undefined;
  let tenantSecretDirectory: string | undefined;
  if (definition.requiresTenantSecretDirectory) {
    const configured =
      environment[tenantSecretEnvironmentKey] ??
      (allowSafeDefaults ? "/tmp/qcrm-tenant-secrets" : undefined);
    if (
      !configured ||
      !configured.startsWith("/") ||
      configured.length > 255 ||
      /[\0\r\n]/u.test(configured) ||
      configured === "/"
    ) {
      throw new ConfigurationError(definition.serviceName, [tenantSecretEnvironmentKey]);
    }
    tenantSecretDirectory = configured;
  }

  let tenantConfigurationDirectory: string | undefined;
  if (definition.requiresTenantConfigurationDirectory) {
    const configured = environment[tenantConfigurationEnvironmentKey];
    if (
      !configured ||
      !configured.startsWith("/") ||
      configured.length > 255 ||
      /[\0\r\n]/u.test(configured) ||
      configured === "/"
    ) {
      throw new ConfigurationError(definition.serviceName, [tenantConfigurationEnvironmentKey]);
    }
    tenantConfigurationDirectory = configured;
  }

  const storage = definition.requiresStorageAdmin
    ? parseStorageConfig(definition.serviceName, result.data.QCRM_ENV, environment, fileSystem)
    : undefined;

  return Object.freeze({
    schemaVersion: "process-config/v1",
    serviceName: definition.serviceName,
    environment: result.data.QCRM_ENV,
    host: result.data.QCRM_HOST,
    port: result.data.QCRM_PORT,
    shutdownTimeoutMs: result.data.QCRM_SHUTDOWN_TIMEOUT_MS,
    ...(database ? { database } : {}),
    ...(oidc ? { oidc } : {}),
    ...(tenantSecretDirectory ? { tenantSecretDirectory } : {}),
    ...(tenantConfigurationDirectory ? { tenantConfigurationDirectory } : {}),
    ...(storage ? { storage } : {}),
  });
}
