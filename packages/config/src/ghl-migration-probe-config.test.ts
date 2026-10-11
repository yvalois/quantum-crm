import { describe, expect, it } from "vitest";

import { ConfigurationError } from "./configuration-error.js";
import {
  ghlApiVersion,
  ghlMigrationTokenPath,
  parseGhlMigrationProbeConfig,
} from "./ghl-migration-probe-config.js";
import type { SecretFileSystem } from "./secret-value.js";

const token = "synthetic-ghl-migration-token-value";
const fileSystem: SecretFileSystem = {
  lstat: () => ({
    size: token.length,
    isFile: () => true,
    isSymbolicLink: () => false,
  }),
  readFile: () => new TextEncoder().encode(token),
  realpath: (path) => path,
};
const environment = {
  QCRM_ENV: "production",
  QCRM_GHL_LOCATION_ID: "loc_123",
  QCRM_GHL_DESTINATION_TENANT_ID: "019b0000-0000-7000-8000-000000000001",
  QCRM_GHL_MIGRATION_TOKEN_FILE: ghlMigrationTokenPath,
};

describe("GHL migration probe configuration", () => {
  it("loads a bounded read-only source configuration from a protected secret file", () => {
    const config = parseGhlMigrationProbeConfig(environment, fileSystem);

    expect(config).toMatchObject({
      schemaVersion: "ghl-migration-probe-config/v1",
      apiOrigin: "https://services.leadconnectorhq.com",
      apiVersion: ghlApiVersion,
      locationId: "loc_123",
      destinationTenantId: environment.QCRM_GHL_DESTINATION_TENANT_ID,
      maxRecords: 1_000,
      requestTimeoutMs: 20_000,
    });
    expect(config.token.expose()).toBe(token);
    expect(JSON.stringify(config)).not.toContain(token);
  });

  it("rejects an unprotected token path without exposing it", () => {
    const badPath = "/tmp/ghl-token";
    let thrown: unknown;
    try {
      parseGhlMigrationProbeConfig(
        { ...environment, QCRM_GHL_MIGRATION_TOKEN_FILE: badPath },
        fileSystem,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toEqual(
      new ConfigurationError("ghl-migration-probe", ["QCRM_GHL_MIGRATION_TOKEN_FILE"]),
    );
    expect(String(thrown)).not.toContain(badPath);
    expect(String(thrown)).not.toContain(token);
  });

  it("rejects unknown Quantum configuration keys", () => {
    expect(() =>
      parseGhlMigrationProbeConfig(
        { ...environment, QCRM_GHL_UNEXPECTED_VALUE: "unexpected" },
        fileSystem,
      ),
    ).toThrow(new ConfigurationError("ghl-migration-probe", ["QCRM_GHL_UNEXPECTED_VALUE"]));
  });

  it("rejects a company identifier because discovery is scoped only by location", () => {
    expect(() =>
      parseGhlMigrationProbeConfig(
        { ...environment, QCRM_GHL_COMPANY_ID: "company_123" },
        fileSystem,
      ),
    ).toThrow(new ConfigurationError("ghl-migration-probe", ["QCRM_GHL_COMPANY_ID"]));
  });

  it("requires a useful but bounded discovery sample", () => {
    expect(() =>
      parseGhlMigrationProbeConfig(
        { ...environment, QCRM_GHL_DISCOVERY_MAX_RECORDS: "19" },
        fileSystem,
      ),
    ).toThrow(new ConfigurationError("ghl-migration-probe", ["QCRM_GHL_DISCOVERY_MAX_RECORDS"]));
  });

  it("uses the same bounded GHL identifier length as the operation contract", () => {
    expect(() =>
      parseGhlMigrationProbeConfig(
        { ...environment, QCRM_GHL_LOCATION_ID: "a".repeat(129) },
        fileSystem,
      ),
    ).toThrow(new ConfigurationError("ghl-migration-probe", ["QCRM_GHL_LOCATION_ID"]));
  });
});
