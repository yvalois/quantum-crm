import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import { parseDatabaseConfig, type DatabaseConfig } from "./database-config.js";
import { loadSecretFile, type SecretFileSystem, type SecretValue } from "./secret-value.js";
import { ghlMigrationTokenPath } from "./ghl-migration-probe-config.js";

const artifactPath = "/run/ghl-import/records.qcrm";
const keyPath = "/run/secrets/qcrm_ghl_export_key";
const schema = z.object({
  QCRM_ENV: z.enum(["test", "staging", "production"]),
  QCRM_TENANT_ID: z.string().uuid(),
  QCRM_DATABASE_URL_FILE: z.string().min(1),
  QCRM_GHL_LOCATION_ID: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  QCRM_GHL_IMPORT_OPERATION_ID: z.string().uuid(),
  QCRM_GHL_IMPORT_EXPORT_ID: z.string().uuid(),
  QCRM_GHL_IMPORT_ARTIFACT_FILE: z.literal(artifactPath),
  QCRM_GHL_IMPORT_ARTIFACT_SHA256: z.string().regex(/^[a-f0-9]{64}$/u),
  QCRM_GHL_EXPORT_KEY_FILE: z.literal(keyPath),
  QCRM_GHL_IMPORT_CURRENCY: z.string().regex(/^[A-Z]{3}$/u),
  QCRM_GHL_IMPORT_DEVELOPMENT_EXCEPTION: z.literal("true"),
  QCRM_GHL_IMPORT_MODE: z.enum(["VERIFY", "APPLY", "PARTICIPANTS"]).default("VERIFY"),
  QCRM_GHL_MIGRATION_TOKEN_FILE: z.literal(ghlMigrationTokenPath).optional(),
});

export interface GhlMigrationImportConfig {
  readonly database: DatabaseConfig;
  readonly tenantId: string;
  readonly locationId: string;
  readonly operationId: string;
  readonly exportId: string;
  readonly artifact: string;
  readonly artifactSha256: string;
  readonly encryptionKey: SecretValue;
  readonly currency: string;
  readonly mode: "VERIFY" | "APPLY" | "PARTICIPANTS";
  readonly participantToken?: SecretValue;
}

export function loadGhlMigrationImportConfig(): GhlMigrationImportConfig {
  return parseGhlMigrationImportConfig(
    Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("QCRM_"))),
  );
}

export function parseGhlMigrationImportConfig(
  environment: Readonly<Record<string, string | undefined>>,
  fileSystem?: SecretFileSystem,
): GhlMigrationImportConfig {
  const unknown = Object.keys(environment).filter(
    (key) => key.startsWith("QCRM_") && !(key in schema.shape),
  );
  if (unknown.length) throw new ConfigurationError("ghl-migration-import", unknown.sort());
  const parsed = schema.safeParse(environment);
  if (!parsed.success)
    throw new ConfigurationError("ghl-migration-import", [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
    ]);
  const v = parsed.data;
  if (
    (v.QCRM_GHL_IMPORT_MODE === "PARTICIPANTS") !==
    (v.QCRM_GHL_MIGRATION_TOKEN_FILE !== undefined)
  )
    throw new ConfigurationError("ghl-migration-import", ["QCRM_GHL_MIGRATION_TOKEN_FILE"]);
  // This explicitly authorized development exception is never a production bypass.
  if (v.QCRM_ENV === "production")
    throw new ConfigurationError("ghl-migration-import", ["QCRM_ENV"]);
  const database = parseDatabaseConfig(
    "ghl-migration-import",
    { target: "crm", requiresTenant: true },
    v.QCRM_ENV,
    v,
    fileSystem,
  );
  const url = new URL(database.connectionUrl.expose());
  const suffix = v.QCRM_TENANT_ID.replaceAll("-", "");
  if (
    url.pathname !== `/qcrm_t_${suffix}` ||
    decodeURIComponent(url.username) !== `qcrm_r_${suffix}`
  ) {
    throw new ConfigurationError("ghl-migration-import", [
      "QCRM_DATABASE_URL_FILE",
      "QCRM_TENANT_ID",
    ]);
  }
  let encryptionKey: SecretValue;
  try {
    encryptionKey = loadSecretFile("GHL import encryption key", v.QCRM_GHL_EXPORT_KEY_FILE, {
      environment: v.QCRM_ENV,
      expectedProtectedPath: keyPath,
      ...(fileSystem ? { fileSystem } : {}),
    });
    if (!/^[a-f0-9]{64}$/u.test(encryptionKey.expose())) throw new Error("Invalid key");
  } catch {
    throw new ConfigurationError("ghl-migration-import", ["QCRM_GHL_EXPORT_KEY_FILE"]);
  }
  let participantToken: SecretValue | undefined;
  if (v.QCRM_GHL_MIGRATION_TOKEN_FILE) {
    try {
      participantToken = loadSecretFile(
        "GHL participant directory token",
        v.QCRM_GHL_MIGRATION_TOKEN_FILE,
        {
          environment: v.QCRM_ENV,
          expectedProtectedPath: ghlMigrationTokenPath,
          ...(fileSystem ? { fileSystem } : {}),
        },
      );
      if (participantToken.expose().length < 16 || participantToken.expose().length > 2048)
        throw new Error("Invalid token");
    } catch {
      throw new ConfigurationError("ghl-migration-import", ["QCRM_GHL_MIGRATION_TOKEN_FILE"]);
    }
  }
  return Object.freeze({
    database,
    tenantId: v.QCRM_TENANT_ID,
    locationId: v.QCRM_GHL_LOCATION_ID,
    operationId: v.QCRM_GHL_IMPORT_OPERATION_ID,
    exportId: v.QCRM_GHL_IMPORT_EXPORT_ID,
    artifact: v.QCRM_GHL_IMPORT_ARTIFACT_FILE,
    artifactSha256: v.QCRM_GHL_IMPORT_ARTIFACT_SHA256,
    encryptionKey,
    currency: v.QCRM_GHL_IMPORT_CURRENCY,
    mode: v.QCRM_GHL_IMPORT_MODE,
    ...(participantToken ? { participantToken } : {}),
  });
}
