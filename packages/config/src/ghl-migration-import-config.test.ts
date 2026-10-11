import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseGhlMigrationImportConfig } from "./ghl-migration-import-config.js";
import type { SecretFileSystem } from "./secret-value.js";

const tenantId = "019b0000-0000-7000-8000-000000000001";
const suffix = tenantId.replaceAll("-", "");
const environment = {
  QCRM_ENV: "staging",
  QCRM_TENANT_ID: tenantId,
  QCRM_DATABASE_URL_FILE: "/run/secrets/qcrm_database_url",
  QCRM_GHL_LOCATION_ID: "synthetic_location",
  QCRM_GHL_IMPORT_OPERATION_ID: "019b0000-0000-7000-8000-000000000002",
  QCRM_GHL_IMPORT_EXPORT_ID: "019b0000-0000-7000-8000-000000000003",
  QCRM_GHL_IMPORT_ARTIFACT_FILE: "/run/ghl-import/records.qcrm",
  QCRM_GHL_IMPORT_ARTIFACT_SHA256: "a".repeat(64),
  QCRM_GHL_EXPORT_KEY_FILE: "/run/secrets/qcrm_ghl_export_key",
  QCRM_GHL_IMPORT_CURRENCY: "GTQ",
  QCRM_GHL_IMPORT_DEVELOPMENT_EXCEPTION: "true",
};

function files(
  database = `postgresql://qcrm_r_${suffix}:synthetic@database/qcrm_t_${suffix}`,
): SecretFileSystem {
  return {
    lstat: () => ({ size: 64, isFile: () => true, isSymbolicLink: () => false }),
    realpath: (path) => path,
    readFile: (path) =>
      Buffer.from(
        path === resolve(environment.QCRM_DATABASE_URL_FILE) ? database : "ab".repeat(32),
      ),
  };
}

describe("GHL import destination configuration", () => {
  it("defaults to verify and binds both the CRM database and runtime role to the selected tenant", () => {
    expect(parseGhlMigrationImportConfig(environment, files())).toMatchObject({
      mode: "VERIFY",
      currency: "GTQ",
      tenantId,
    });
    expect(() =>
      parseGhlMigrationImportConfig(
        environment,
        files(`postgresql://qcrm_r_${suffix}:synthetic@database/qcrm_t_other`),
      ),
    ).toThrow();
    expect(() =>
      parseGhlMigrationImportConfig(
        environment,
        files(`postgresql://postgres:synthetic@database/qcrm_t_${suffix}`),
      ),
    ).toThrow();
  });

  it("does not apply a development exception to production or accept arbitrary artifact and secret paths", () => {
    for (const patch of [
      { QCRM_ENV: "production" },
      { QCRM_GHL_IMPORT_ARTIFACT_FILE: "/tmp/records.qcrm" },
      { QCRM_GHL_EXPORT_KEY_FILE: "/tmp/key" },
      { QCRM_GHL_IMPORT_DEVELOPMENT_EXCEPTION: "false" },
      { QCRM_GHL_TOKEN: "synthetic-token" },
    ])
      expect(() => parseGhlMigrationImportConfig({ ...environment, ...patch }, files())).toThrow();
  });
});
