import { isAbsolute } from "node:path";

import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import {
  ghlApiOrigin,
  ghlApiVersion,
  ghlMigrationTokenPath,
} from "./ghl-migration-probe-config.js";
import { loadSecretFile, type SecretFileSystem, type SecretValue } from "./secret-value.js";

export const ghlExportKeyPath = "/opt/quantum/secrets/ghl-export/export-key";
export const ghlExportRoot = "/opt/quantum/exports/ghl";

const schema = z.object({
  QCRM_ENV: z.enum(["local", "test", "preview", "staging", "production"]),
  QCRM_GHL_LOCATION_ID: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  QCRM_GHL_MIGRATION_TOKEN_FILE: z.string().min(1),
  QCRM_GHL_EXPORT_KEY_FILE: z.string().min(1),
  QCRM_GHL_EXPORT_ROOT: z.string().default(ghlExportRoot),
  QCRM_GHL_EXPORT_MAX_REQUESTS: z.coerce.number().int().min(8).max(10_000).default(5_000),
  QCRM_GHL_EXPORT_DEADLINE_SECONDS: z.coerce.number().int().min(60).max(7_200).default(1_800),
});

export interface GhlMigrationExportConfig {
  readonly apiOrigin: typeof ghlApiOrigin;
  readonly apiVersion: typeof ghlApiVersion;
  readonly locationId: string;
  readonly token: SecretValue;
  readonly encryptionKey: SecretValue;
  readonly outputRoot: string;
  readonly maxRequests: number;
  readonly deadlineSeconds: number;
}

export function loadGhlMigrationExportConfig(): GhlMigrationExportConfig {
  return parseGhlMigrationExportConfig(
    Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key === "QCRM_ENV" || key.startsWith("QCRM_GHL_"),
      ),
    ),
  );
}

export function parseGhlMigrationExportConfig(
  environment: Readonly<Record<string, string | undefined>>,
  fileSystem?: SecretFileSystem,
): GhlMigrationExportConfig {
  const unknown = Object.keys(environment).filter(
    (key) => key.startsWith("QCRM_") && !(key in schema.shape),
  );
  if (unknown.length) throw new ConfigurationError("ghl-migration-export", unknown.sort());
  const parsed = schema.safeParse(environment);
  if (!parsed.success) {
    throw new ConfigurationError("ghl-migration-export", [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
    ]);
  }
  const values = parsed.data;
  if (
    !isAbsolute(values.QCRM_GHL_EXPORT_ROOT) ||
    (!["local", "test"].includes(values.QCRM_ENV) && values.QCRM_GHL_EXPORT_ROOT !== ghlExportRoot)
  ) {
    throw new ConfigurationError("ghl-migration-export", ["QCRM_GHL_EXPORT_ROOT"]);
  }
  let token: SecretValue;
  let encryptionKey: SecretValue;
  try {
    token = loadSecretFile("GHL migration token", values.QCRM_GHL_MIGRATION_TOKEN_FILE, {
      environment: values.QCRM_ENV,
      expectedProtectedPath: ghlMigrationTokenPath,
      ...(fileSystem ? { fileSystem } : {}),
    });
    if (token.expose().length < 16 || token.expose().length > 2_048)
      throw new Error("invalid token");
  } catch {
    throw new ConfigurationError("ghl-migration-export", ["QCRM_GHL_MIGRATION_TOKEN_FILE"]);
  }
  try {
    encryptionKey = loadSecretFile("GHL export encryption key", values.QCRM_GHL_EXPORT_KEY_FILE, {
      environment: values.QCRM_ENV,
      expectedProtectedPath: ghlExportKeyPath,
      ...(fileSystem ? { fileSystem } : {}),
    });
    if (!/^[a-f0-9]{64}$/u.test(encryptionKey.expose())) throw new Error("invalid export key");
  } catch {
    throw new ConfigurationError("ghl-migration-export", ["QCRM_GHL_EXPORT_KEY_FILE"]);
  }
  return Object.freeze({
    apiOrigin: ghlApiOrigin,
    apiVersion: ghlApiVersion,
    locationId: values.QCRM_GHL_LOCATION_ID,
    token,
    encryptionKey,
    outputRoot: values.QCRM_GHL_EXPORT_ROOT,
    maxRequests: values.QCRM_GHL_EXPORT_MAX_REQUESTS,
    deadlineSeconds: values.QCRM_GHL_EXPORT_DEADLINE_SECONDS,
  });
}
