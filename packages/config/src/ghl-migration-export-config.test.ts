import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ghlExportKeyPath, parseGhlMigrationExportConfig } from "./ghl-migration-export-config.js";
import { ghlMigrationTokenPath } from "./ghl-migration-probe-config.js";
import type { SecretFileSystem } from "./secret-value.js";

const environment = {
  QCRM_ENV: "production",
  QCRM_GHL_LOCATION_ID: "synthetic_location",
  QCRM_GHL_MIGRATION_TOKEN_FILE: ghlMigrationTokenPath,
  QCRM_GHL_EXPORT_KEY_FILE: ghlExportKeyPath,
};
const fileSystem: SecretFileSystem = {
  lstat: () => ({ size: 64, isFile: () => true, isSymbolicLink: () => false }),
  realpath: (path) => path,
  readFile: (path) =>
    Buffer.from(
      path === resolve(ghlExportKeyPath) ? "ab".repeat(32) : "synthetic-token-not-a-real-secret",
    ),
};

describe("GHL full export config", () => {
  it("needs a location and protected files, not a company or destination database", () => {
    const config = parseGhlMigrationExportConfig(environment, fileSystem);
    expect(config.locationId).toBe("synthetic_location");
    expect(config.maxRequests).toBe(5_000);
    expect(JSON.stringify(config)).not.toContain("synthetic-token");
    expect(JSON.stringify(config)).not.toContain("ab".repeat(32));
  });

  it("rejects plaintext secrets, unprotected paths, and unknown configuration", () => {
    expect(() =>
      parseGhlMigrationExportConfig({ ...environment, QCRM_GHL_TOKEN: "secret" }, fileSystem),
    ).toThrow();
    expect(() =>
      parseGhlMigrationExportConfig(
        { ...environment, QCRM_GHL_EXPORT_ROOT: "/tmp/public" },
        fileSystem,
      ),
    ).toThrow();
    expect(() =>
      parseGhlMigrationExportConfig(
        { ...environment, QCRM_GHL_EXPORT_KEY_FILE: "/tmp/key" },
        fileSystem,
      ),
    ).toThrow();
    expect(() =>
      parseGhlMigrationExportConfig({ ...environment, QCRM_GHL_COMPANY_ID: "unused" }, fileSystem),
    ).toThrow();
  });
});
