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
import {
  githubActionsReleasePublisherEnvironmentKeys,
  parseGithubActionsReleasePublisherConfig,
  type GithubActionsReleasePublisherConfig,
} from "./github-actions-release-publisher-config.js";
import { loadSecretFile, SecretValue, type SecretFileSystem } from "./secret-value.js";
import {
  parseStorageConfig,
  storageEnvironmentKeys,
  type StorageConfig,
} from "./storage-config.js";
import {
  identityProvisionerEnvironmentKeys,
  parseIdentityProvisionerConfig,
  type IdentityProvisionerConfig,
} from "./identity-provisioner-config.js";
import {
  activationDeliveryCallbackEnvironmentKeys,
  parseActivationDeliveryCallbackConfig,
  type ActivationDeliveryCallbackConfig,
} from "./activation-delivery-callback-config.js";

const qcrmEnvironmentSchema = z.enum(["local", "test", "preview", "staging", "production"]);
const processEnvironmentKeys = [
  "QCRM_ENV",
  "QCRM_HOST",
  "QCRM_PORT",
  "QCRM_SHUTDOWN_TIMEOUT_MS",
] as const;
const tenantSecretEnvironmentKey = "QCRM_TENANT_SECRET_DIRECTORY" as const;
const iamBootstrapClientEnvironmentKey = "QCRM_IAM_BOOTSTRAP_CLIENT_ID" as const;
const iamBootstrapClientSecretEnvironmentKey = "QCRM_IAM_BOOTSTRAP_CLIENT_SECRET_FILE" as const;
const tenantConfigurationEnvironmentKey = "QCRM_TENANT_CONFIGURATION_DIRECTORY" as const;
const deployHostSocketEnvironmentKey = "QCRM_DEPLOY_HOST_SOCKET_PATH" as const;
const deployHostConfigurationRootEnvironmentKey = "QCRM_DEPLOY_HOST_CONFIGURATION_ROOT" as const;
const deployHostComposeTemplateEnvironmentKey = "QCRM_DEPLOY_HOST_COMPOSE_TEMPLATE" as const;
const deployHostPlatformFoundationComposeTemplateEnvironmentKey =
  "QCRM_DEPLOY_HOST_PLATFORM_FOUNDATION_COMPOSE_TEMPLATE" as const;
const deployHostPlatformFoundationEnvironmentFileEnvironmentKey =
  "QCRM_DEPLOY_HOST_PLATFORM_FOUNDATION_ENV_FILE" as const;
const deployHostImageRegistryEnvironmentKey = "QCRM_DEPLOY_HOST_IMAGE_REGISTRY" as const;
const deployHostTenantEdgeNetworkEnvironmentKey = "QCRM_DEPLOY_HOST_TENANT_EDGE_NETWORK" as const;
const deployHostPlatformStorageNetworkEnvironmentKey =
  "QCRM_DEPLOY_HOST_PLATFORM_STORAGE_NETWORK" as const;
const deployHostPlatformSessionNetworkEnvironmentKey =
  "QCRM_DEPLOY_HOST_PLATFORM_SESSION_NETWORK" as const;
const deployHostPlatformOidcNetworkEnvironmentKey =
  "QCRM_DEPLOY_HOST_PLATFORM_OIDC_NETWORK" as const;
const deployHostPlatformDatabaseNetworkEnvironmentKey =
  "QCRM_DEPLOY_HOST_PLATFORM_DATABASE_NETWORK" as const;
const deployHostDatabaseSecretRootEnvironmentKey = "QCRM_DEPLOY_HOST_DATABASE_SECRET_ROOT" as const;
const deployHostTenantRouteRootEnvironmentKey = "QCRM_DEPLOY_HOST_TENANT_ROUTE_ROOT" as const;
const safeDefaultEnvironments = new Set<QcrmEnvironment>(["local", "test"]);
const placeholderPattern = /^(?:change[_-]?me|example|placeholder|todo)$/i;

export type QcrmEnvironment = z.infer<typeof qcrmEnvironmentSchema>;

export const processDefinitions = Object.freeze({
  api: Object.freeze({
    serviceName: "api",
    defaultHost: "0.0.0.0",
    defaultPort: 3001,
    database: Object.freeze({ target: "crm", requiresTenant: true }),
    oidc: Object.freeze({ provider: "keycloak", boundary: "crm" }),
    requiresIamBootstrapClient: true,
    requiresIamBootstrapClientSecret: true,
  }),
  "admin-api": Object.freeze({
    serviceName: "admin-api",
    defaultHost: "0.0.0.0",
    defaultPort: 3002,
    database: Object.freeze({ target: "platform", requiresTenant: false }),
    oidc: Object.freeze({ provider: "keycloak", boundary: "platform" }),
    requiresGithubActionsReleasePublisher: true,
    requiresActivationDeliveryCallback: true,
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
    requiresDeployHostSocket: true,
    requiresIdentityProvisioner: true,
    requiresActivationDeliveryCallback: true,
  }),
  "deploy-host": Object.freeze({
    serviceName: "deploy-host",
    defaultHost: "127.0.0.1",
    defaultPort: 3200,
    requiresDeployHostSocket: true,
    requiresDeployHostComposeRuntime: true,
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
  readonly requiresGithubActionsReleasePublisher?: boolean;
  readonly requiresTenantSecretDirectory?: boolean;
  readonly requiresTenantConfigurationDirectory?: boolean;
  readonly requiresStorageAdmin?: boolean;
  readonly requiresDeployHostSocket?: boolean;
  readonly requiresDeployHostComposeRuntime?: boolean;
  readonly requiresIdentityProvisioner?: boolean;
  readonly requiresActivationDeliveryCallback?: boolean;
  readonly requiresIamBootstrapClient?: boolean;
  readonly requiresIamBootstrapClientSecret?: boolean;
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
  readonly githubActionsReleasePublisher?: GithubActionsReleasePublisherConfig;
  readonly tenantSecretDirectory?: string;
  readonly tenantConfigurationDirectory?: string;
  readonly deployHostSocketPath?: string;
  readonly deployHostConfigurationRoot?: string;
  readonly deployHostComposeTemplate?: string;
  readonly deployHostPlatformFoundationComposeTemplate?: string;
  readonly deployHostPlatformFoundationEnvironmentFile?: string;
  readonly deployHostImageRegistry?: string;
  readonly deployHostTenantEdgeNetwork?: string;
  readonly deployHostPlatformStorageNetwork?: string;
  readonly deployHostPlatformSessionNetwork?: string;
  readonly deployHostPlatformOidcNetwork?: string;
  readonly deployHostPlatformDatabaseNetwork?: string;
  readonly deployHostDatabaseSecretRoot?: string;
  readonly deployHostTenantRouteRoot?: string;
  readonly storage?: StorageConfig;
  readonly identityProvisioner?: IdentityProvisionerConfig;
  readonly activationDeliveryCallback?: ActivationDeliveryCallbackConfig;
  readonly iamBootstrapClientId?: "quantum-crm-bootstrap";
  readonly iamBootstrapClientSecret?: SecretValue;
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

export function requireGithubActionsReleasePublisherConfig(
  config: ProcessConfig,
): GithubActionsReleasePublisherConfig {
  if (!config.githubActionsReleasePublisher) {
    throw new ConfigurationError(config.serviceName, ["QCRM_GITHUB_ACTIONS_OIDC_AUDIENCE"]);
  }

  return config.githubActionsReleasePublisher;
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
    ...(definition.requiresGithubActionsReleasePublisher
      ? githubActionsReleasePublisherEnvironmentKeys
      : []),
    ...(definition.requiresTenantSecretDirectory ? [tenantSecretEnvironmentKey] : []),
    ...(definition.requiresIamBootstrapClient ? [iamBootstrapClientEnvironmentKey] : []),
    ...(definition.requiresIamBootstrapClientSecret
      ? [iamBootstrapClientSecretEnvironmentKey]
      : []),
    ...(definition.requiresTenantConfigurationDirectory ? [tenantConfigurationEnvironmentKey] : []),
    ...(definition.requiresStorageAdmin ? storageEnvironmentKeys : []),
    ...(definition.requiresIdentityProvisioner ? identityProvisionerEnvironmentKeys : []),
    ...(definition.requiresActivationDeliveryCallback
      ? activationDeliveryCallbackEnvironmentKeys
      : []),
    ...(definition.requiresDeployHostSocket ? [deployHostSocketEnvironmentKey] : []),
    ...(definition.requiresDeployHostComposeRuntime
      ? [
          deployHostConfigurationRootEnvironmentKey,
          deployHostComposeTemplateEnvironmentKey,
          deployHostPlatformFoundationComposeTemplateEnvironmentKey,
          deployHostPlatformFoundationEnvironmentFileEnvironmentKey,
          deployHostImageRegistryEnvironmentKey,
          deployHostTenantEdgeNetworkEnvironmentKey,
          deployHostPlatformStorageNetworkEnvironmentKey,
          deployHostPlatformSessionNetworkEnvironmentKey,
          deployHostPlatformOidcNetworkEnvironmentKey,
          deployHostPlatformDatabaseNetworkEnvironmentKey,
          deployHostDatabaseSecretRootEnvironmentKey,
          deployHostTenantRouteRootEnvironmentKey,
        ]
      : []),
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
  const githubActionsReleasePublisher = definition.requiresGithubActionsReleasePublisher
    ? parseGithubActionsReleasePublisherConfig(
        definition.serviceName,
        result.data.QCRM_ENV,
        environment,
      )
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

  let deployHostSocketPath: string | undefined;
  if (definition.requiresDeployHostSocket) {
    const configured =
      environment[deployHostSocketEnvironmentKey] ??
      (allowSafeDefaults ? "/run/deploy-host/adapter.sock" : undefined);
    if (
      !configured ||
      !configured.startsWith("/") ||
      configured.length > 255 ||
      /[\0\r\n]/u.test(configured) ||
      configured === "/"
    ) {
      throw new ConfigurationError(definition.serviceName, [deployHostSocketEnvironmentKey]);
    }
    deployHostSocketPath = configured;
  }

  let deployHostConfigurationRoot: string | undefined;
  let deployHostComposeTemplate: string | undefined;
  let deployHostPlatformFoundationComposeTemplate: string | undefined;
  let deployHostPlatformFoundationEnvironmentFile: string | undefined;
  let deployHostImageRegistry: string | undefined;
  let deployHostTenantEdgeNetwork: string | undefined;
  let deployHostPlatformStorageNetwork: string | undefined;
  let deployHostPlatformSessionNetwork: string | undefined;
  let deployHostPlatformOidcNetwork: string | undefined;
  let deployHostPlatformDatabaseNetwork: string | undefined;
  let deployHostDatabaseSecretRoot: string | undefined;
  let deployHostTenantRouteRoot: string | undefined;
  if (definition.requiresDeployHostComposeRuntime) {
    const configuredPath = (key: string, fallback: string | undefined): string => {
      const value = environment[key] ?? fallback;
      if (
        !value ||
        !value.startsWith("/") ||
        value.length > 255 ||
        /[\0\r\n]/u.test(value) ||
        value === "/"
      ) {
        throw new ConfigurationError(definition.serviceName, [key]);
      }
      return value;
    };
    const configuredName = (key: string, fallback: string | undefined): string => {
      const value = environment[key] ?? fallback;
      if (!value || value.length > 255 || !/^[A-Za-z0-9][A-Za-z0-9./_-]*$/u.test(value)) {
        throw new ConfigurationError(definition.serviceName, [key]);
      }
      return value;
    };
    deployHostConfigurationRoot = configuredPath(
      deployHostConfigurationRootEnvironmentKey,
      allowSafeDefaults ? "/tmp/qcrm-tenant-configuration" : undefined,
    );
    deployHostComposeTemplate = configuredPath(
      deployHostComposeTemplateEnvironmentKey,
      allowSafeDefaults ? "/tmp/qcrm-tenant.yaml" : undefined,
    );
    deployHostPlatformFoundationComposeTemplate = configuredPath(
      deployHostPlatformFoundationComposeTemplateEnvironmentKey,
      allowSafeDefaults ? "/tmp/qcrm-platform-foundation.yaml" : undefined,
    );
    deployHostPlatformFoundationEnvironmentFile = configuredPath(
      deployHostPlatformFoundationEnvironmentFileEnvironmentKey,
      allowSafeDefaults ? "/tmp/qcrm-platform-foundation.env" : undefined,
    );
    deployHostImageRegistry = configuredName(
      deployHostImageRegistryEnvironmentKey,
      allowSafeDefaults ? "ghcr.io/example/quantum-crm" : undefined,
    );
    deployHostTenantEdgeNetwork = configuredName(
      deployHostTenantEdgeNetworkEnvironmentKey,
      allowSafeDefaults ? "qcrm-tenant-edge" : undefined,
    );
    deployHostPlatformStorageNetwork = configuredName(
      deployHostPlatformStorageNetworkEnvironmentKey,
      allowSafeDefaults ? "qcrm-platform-storage" : undefined,
    );
    deployHostPlatformSessionNetwork = configuredName(
      deployHostPlatformSessionNetworkEnvironmentKey,
      allowSafeDefaults ? "qcrm-platform-session" : undefined,
    );
    deployHostPlatformOidcNetwork = configuredName(
      deployHostPlatformOidcNetworkEnvironmentKey,
      allowSafeDefaults ? "qcrm-platform-oidc" : undefined,
    );
    deployHostPlatformDatabaseNetwork = configuredName(
      deployHostPlatformDatabaseNetworkEnvironmentKey,
      allowSafeDefaults ? "qcrm-platform-database" : undefined,
    );
    deployHostDatabaseSecretRoot = configuredPath(
      deployHostDatabaseSecretRootEnvironmentKey,
      allowSafeDefaults ? "/tmp/qcrm-tenant-secrets" : undefined,
    );
    deployHostTenantRouteRoot = configuredPath(
      deployHostTenantRouteRootEnvironmentKey,
      allowSafeDefaults ? "/tmp/qcrm-tenant-routes" : undefined,
    );
  }

  const storage = definition.requiresStorageAdmin
    ? parseStorageConfig(definition.serviceName, result.data.QCRM_ENV, environment, fileSystem)
    : undefined;
  const identityProvisioner = definition.requiresIdentityProvisioner
    ? parseIdentityProvisionerConfig(
        definition.serviceName,
        result.data.QCRM_ENV,
        environment,
        fileSystem,
      )
    : undefined;
  const activationDeliveryCallback = definition.requiresActivationDeliveryCallback
    ? parseActivationDeliveryCallbackConfig(
        definition.serviceName,
        result.data.QCRM_ENV,
        environment,
        fileSystem,
      )
    : undefined;
  const iamBootstrapClientId = definition.requiresIamBootstrapClient
    ? environment.QCRM_IAM_BOOTSTRAP_CLIENT_ID === "quantum-crm-bootstrap"
      ? ("quantum-crm-bootstrap" as const)
      : (() => {
          throw new ConfigurationError(definition.serviceName, [iamBootstrapClientEnvironmentKey]);
        })()
    : undefined;
  let iamBootstrapClientSecret: SecretValue | undefined;
  if (definition.requiresIamBootstrapClientSecret) {
    const secretPath = environment[iamBootstrapClientSecretEnvironmentKey];
    if (secretPath === undefined && allowSafeDefaults) {
      iamBootstrapClientSecret = undefined;
    } else if (
      !secretPath ||
      !secretPath.startsWith("/") ||
      secretPath.length > 255 ||
      /[\0\r\n]/u.test(secretPath) ||
      secretPath === "/"
    ) {
      throw new ConfigurationError(definition.serviceName, [
        iamBootstrapClientSecretEnvironmentKey,
      ]);
    } else {
      iamBootstrapClientSecret = loadSecretFile("IAM bootstrap client secret", secretPath, {
        environment: result.data.QCRM_ENV,
        expectedProtectedPath: "/run/secrets/qcrm_iam_bootstrap_client_secret",
        ...(fileSystem ? { fileSystem } : {}),
      });
    }
  }

  return Object.freeze({
    schemaVersion: "process-config/v1",
    serviceName: definition.serviceName,
    environment: result.data.QCRM_ENV,
    host: result.data.QCRM_HOST,
    port: result.data.QCRM_PORT,
    shutdownTimeoutMs: result.data.QCRM_SHUTDOWN_TIMEOUT_MS,
    ...(database ? { database } : {}),
    ...(oidc ? { oidc } : {}),
    ...(githubActionsReleasePublisher ? { githubActionsReleasePublisher } : {}),
    ...(tenantSecretDirectory ? { tenantSecretDirectory } : {}),
    ...(tenantConfigurationDirectory ? { tenantConfigurationDirectory } : {}),
    ...(deployHostSocketPath ? { deployHostSocketPath } : {}),
    ...(deployHostConfigurationRoot ? { deployHostConfigurationRoot } : {}),
    ...(deployHostComposeTemplate ? { deployHostComposeTemplate } : {}),
    ...(deployHostPlatformFoundationComposeTemplate
      ? { deployHostPlatformFoundationComposeTemplate }
      : {}),
    ...(deployHostPlatformFoundationEnvironmentFile
      ? { deployHostPlatformFoundationEnvironmentFile }
      : {}),
    ...(deployHostImageRegistry ? { deployHostImageRegistry } : {}),
    ...(deployHostTenantEdgeNetwork ? { deployHostTenantEdgeNetwork } : {}),
    ...(deployHostPlatformStorageNetwork ? { deployHostPlatformStorageNetwork } : {}),
    ...(deployHostPlatformSessionNetwork ? { deployHostPlatformSessionNetwork } : {}),
    ...(deployHostPlatformOidcNetwork ? { deployHostPlatformOidcNetwork } : {}),
    ...(deployHostPlatformDatabaseNetwork ? { deployHostPlatformDatabaseNetwork } : {}),
    ...(deployHostDatabaseSecretRoot ? { deployHostDatabaseSecretRoot } : {}),
    ...(deployHostTenantRouteRoot ? { deployHostTenantRouteRoot } : {}),
    ...(storage ? { storage } : {}),
    ...(identityProvisioner ? { identityProvisioner } : {}),
    ...(activationDeliveryCallback ? { activationDeliveryCallback } : {}),
    ...(iamBootstrapClientId ? { iamBootstrapClientId } : {}),
    ...(iamBootstrapClientSecret ? { iamBootstrapClientSecret } : {}),
  });
}
