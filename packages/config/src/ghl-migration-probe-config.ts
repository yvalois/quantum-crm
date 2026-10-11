import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import type { QcrmEnvironment } from "./process-config.js";
import {
  loadSecretFile,
  SecretFileError,
  type SecretFileSystem,
  type SecretValue,
} from "./secret-value.js";

const ghlMigrationTokenPath = "/run/secrets/qcrm_ghl_migration_token";
const ghlApiOrigin = "https://services.leadconnectorhq.com";
const ghlApiVersion = "v3";
const qcrmEnvironmentSchema = z.enum(["local", "test", "preview", "staging", "production"]);
const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);
const tenantIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);

export const ghlMigrationProbeEnvironmentKeys = Object.freeze([
  "QCRM_ENV",
  "QCRM_GHL_LOCATION_ID",
  "QCRM_GHL_DESTINATION_TENANT_ID",
  "QCRM_GHL_MIGRATION_TOKEN_FILE",
  "QCRM_GHL_DISCOVERY_MAX_RECORDS",
  "QCRM_GHL_DISCOVERY_REQUEST_TIMEOUT_MS",
] as const);

export interface GhlMigrationProbeConfig {
  readonly schemaVersion: "ghl-migration-probe-config/v1";
  readonly environment: QcrmEnvironment;
  readonly apiOrigin: typeof ghlApiOrigin;
  readonly apiVersion: typeof ghlApiVersion;
  readonly locationId: string;
  readonly destinationTenantId: string;
  readonly token: SecretValue;
  readonly maxRecords: number;
  readonly requestTimeoutMs: number;
}

function readEnvironment(): Readonly<Record<string, string | undefined>> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key === "QCRM_ENV" || key.startsWith("QCRM_GHL_"),
    ),
  );
}

export function loadGhlMigrationProbeConfig(): GhlMigrationProbeConfig {
  return parseGhlMigrationProbeConfig(readEnvironment());
}

export function parseGhlMigrationProbeConfig(
  environment: Readonly<Record<string, string | undefined>>,
  fileSystem?: SecretFileSystem,
): GhlMigrationProbeConfig {
  const unknownKeys = Object.keys(environment)
    .filter(
      (key) =>
        key.startsWith("QCRM_") &&
        !ghlMigrationProbeEnvironmentKeys.includes(
          key as (typeof ghlMigrationProbeEnvironmentKeys)[number],
        ),
    )
    .sort();
  if (unknownKeys.length > 0) throw new ConfigurationError("ghl-migration-probe", unknownKeys);

  const parsed = z
    .object({
      QCRM_ENV: qcrmEnvironmentSchema,
      QCRM_GHL_LOCATION_ID: identifierSchema,
      QCRM_GHL_DESTINATION_TENANT_ID: tenantIdSchema,
      QCRM_GHL_MIGRATION_TOKEN_FILE: z.string().trim().min(1),
      QCRM_GHL_DISCOVERY_MAX_RECORDS: z.coerce.number().int().min(20).max(10_000).default(1_000),
      QCRM_GHL_DISCOVERY_REQUEST_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .min(1_000)
        .max(60_000)
        .default(20_000),
    })
    .safeParse(environment);
  if (!parsed.success) {
    const invalidKeys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))]
      .filter((key) => key !== "undefined")
      .sort();
    throw new ConfigurationError("ghl-migration-probe", invalidKeys);
  }

  try {
    const token = loadSecretFile("GHL migration token", parsed.data.QCRM_GHL_MIGRATION_TOKEN_FILE, {
      environment: parsed.data.QCRM_ENV,
      expectedProtectedPath: ghlMigrationTokenPath,
      ...(fileSystem ? { fileSystem } : {}),
    });
    if (token.expose().length < 16 || token.expose().length > 2_048) {
      throw new Error("invalid GHL migration token");
    }
    return Object.freeze({
      schemaVersion: "ghl-migration-probe-config/v1",
      environment: parsed.data.QCRM_ENV,
      apiOrigin: ghlApiOrigin,
      apiVersion: ghlApiVersion,
      locationId: parsed.data.QCRM_GHL_LOCATION_ID,
      destinationTenantId: parsed.data.QCRM_GHL_DESTINATION_TENANT_ID,
      token,
      maxRecords: parsed.data.QCRM_GHL_DISCOVERY_MAX_RECORDS,
      requestTimeoutMs: parsed.data.QCRM_GHL_DISCOVERY_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof SecretFileError || error instanceof Error) {
      throw new ConfigurationError("ghl-migration-probe", ["QCRM_GHL_MIGRATION_TOKEN_FILE"]);
    }
    throw error;
  }
}

export { ghlApiOrigin, ghlApiVersion, ghlMigrationTokenPath };
