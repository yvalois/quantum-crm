import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import { isValidPostgresUrl } from "./database-config.js";
import {
  loadSecretFile,
  SecretFileError,
  type SecretFileSystem,
  type SecretValue,
} from "./secret-value.js";

const environmentSchema = z.enum(["local", "test", "preview", "staging", "production"]);
const migrationSecretPath = "/run/secrets/qcrm_migration_database_url";

export type MigrationHistory = "platform";

export interface MigrationDatabaseConfig {
  readonly schemaVersion: "migration-database-config/v1";
  readonly history: MigrationHistory;
  readonly connectionUrl: SecretValue;
}

export function parseMigrationDatabaseConfig(
  history: MigrationHistory,
  environment: Readonly<Record<string, string | undefined>>,
  fileSystem?: SecretFileSystem,
): MigrationDatabaseConfig {
  const environmentResult = environmentSchema.safeParse(environment.QCRM_ENV);
  const pathResult = z
    .string()
    .trim()
    .min(1)
    .safeParse(environment.QCRM_MIGRATION_DATABASE_URL_FILE);
  const serviceName = `prisma-${history}`;

  if (!environmentResult.success || !pathResult.success) {
    throw new ConfigurationError(serviceName, [
      ...(!environmentResult.success ? ["QCRM_ENV"] : []),
      ...(!pathResult.success ? ["QCRM_MIGRATION_DATABASE_URL_FILE"] : []),
    ]);
  }

  let connectionUrl: SecretValue;
  try {
    connectionUrl = loadSecretFile("migration database URL", pathResult.data, {
      environment: environmentResult.data,
      expectedProtectedPath: migrationSecretPath,
      ...(fileSystem ? { fileSystem } : {}),
    });
  } catch (error) {
    if (error instanceof SecretFileError) {
      throw new ConfigurationError(serviceName, ["QCRM_MIGRATION_DATABASE_URL_FILE"]);
    }

    throw error;
  }

  if (!isValidPostgresUrl(connectionUrl.expose())) {
    throw new ConfigurationError(serviceName, ["QCRM_MIGRATION_DATABASE_URL_FILE"]);
  }

  return Object.freeze({
    schemaVersion: "migration-database-config/v1",
    history,
    connectionUrl,
  });
}

export function loadMigrationDatabaseConfig(history: MigrationHistory): MigrationDatabaseConfig {
  return parseMigrationDatabaseConfig(history, process.env);
}

export const expectedMigrationDatabaseSecretPath = migrationSecretPath;
