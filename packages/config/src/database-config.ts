import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import {
  loadSecretFile,
  SecretFileError,
  type SecretFileSystem,
  type SecretValue,
} from "./secret-value.js";
import type { QcrmEnvironment } from "./process-config.js";

const databaseUrlFile = "/run/secrets/qcrm_database_url";
const tenantIdSchema = z.string().uuid();

export const databaseEnvironmentKeys = Object.freeze([
  "QCRM_DATABASE_URL_FILE",
  "QCRM_TENANT_ID",
] as const);

export type DatabaseTarget = "crm" | "platform";

export interface DatabaseDefinition {
  readonly target: DatabaseTarget;
  readonly requiresTenant: boolean;
}

export interface DatabaseConfig {
  readonly schemaVersion: "database-config/v1";
  readonly target: DatabaseTarget;
  readonly tenantId?: string;
  readonly connectionUrl: SecretValue;
  readonly poolMax: number;
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly lockTimeoutMs: number;
  readonly idleInTransactionTimeoutMs: number;
}

function isValidPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.username.length > 0 &&
      url.password.length > 0 &&
      url.hostname.length > 0 &&
      url.pathname.length > 1 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

export function parseDatabaseConfig(
  serviceName: string,
  definition: DatabaseDefinition,
  environmentName: QcrmEnvironment,
  environment: Readonly<Record<string, string | undefined>>,
  fileSystem?: SecretFileSystem,
): DatabaseConfig {
  const urlFileResult = z.string().trim().min(1).safeParse(environment.QCRM_DATABASE_URL_FILE);
  if (!urlFileResult.success) {
    throw new ConfigurationError(serviceName, ["QCRM_DATABASE_URL_FILE"]);
  }

  const tenantResult = tenantIdSchema.safeParse(environment.QCRM_TENANT_ID);
  if (
    (definition.requiresTenant && !tenantResult.success) ||
    (!definition.requiresTenant && environment.QCRM_TENANT_ID !== undefined)
  ) {
    throw new ConfigurationError(serviceName, ["QCRM_TENANT_ID"]);
  }

  let connectionUrl: SecretValue;
  try {
    connectionUrl = loadSecretFile("database URL", urlFileResult.data, {
      environment: environmentName,
      expectedProtectedPath: databaseUrlFile,
      ...(fileSystem ? { fileSystem } : {}),
    });
  } catch (error) {
    if (error instanceof SecretFileError) {
      throw new ConfigurationError(serviceName, ["QCRM_DATABASE_URL_FILE"]);
    }

    throw error;
  }

  if (!isValidPostgresUrl(connectionUrl.expose())) {
    throw new ConfigurationError(serviceName, ["QCRM_DATABASE_URL_FILE"]);
  }

  return Object.freeze({
    schemaVersion: "database-config/v1",
    target: definition.target,
    ...(tenantResult.success ? { tenantId: tenantResult.data } : {}),
    connectionUrl,
    poolMax: 5,
    connectionTimeoutMs: 5_000,
    statementTimeoutMs: 15_000,
    lockTimeoutMs: 5_000,
    idleInTransactionTimeoutMs: 10_000,
  });
}

export const expectedDatabaseSecretPath = databaseUrlFile;
