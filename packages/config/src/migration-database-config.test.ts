import { describe, expect, it } from "vitest";

import { ConfigurationError } from "./configuration-error.js";
import {
  expectedMigrationDatabaseSecretPath,
  parseMigrationDatabaseConfig,
} from "./migration-database-config.js";
import type { SecretFileSystem } from "./secret-value.js";

const url = "postgresql://migrator:test-only-migration@postgres:5432/platform";

function fileSystem(content: string, symbolicLink = false): SecretFileSystem {
  return {
    lstat: () => ({
      size: new TextEncoder().encode(content).byteLength,
      isFile: () => true,
      isSymbolicLink: () => symbolicLink,
    }),
    readFile: () => new TextEncoder().encode(content),
    realpath: (path) => path,
  };
}

describe("migration database configuration", () => {
  it("loads an immutable platform migration binding", () => {
    const config = parseMigrationDatabaseConfig(
      "platform",
      {
        QCRM_ENV: "production",
        QCRM_MIGRATION_DATABASE_URL_FILE: expectedMigrationDatabaseSecretPath,
      },
      fileSystem(url),
    );

    expect(config.history).toBe("platform");
    expect(config.connectionUrl.expose()).toBe(url);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([
    [{}, ["QCRM_ENV", "QCRM_MIGRATION_DATABASE_URL_FILE"]],
    [
      { QCRM_ENV: "production", QCRM_MIGRATION_DATABASE_URL_FILE: "/tmp/migration-url" },
      ["QCRM_MIGRATION_DATABASE_URL_FILE"],
    ],
  ])("rejects invalid protected configuration", (environment, keys) => {
    expect(() => parseMigrationDatabaseConfig("platform", environment, fileSystem(url))).toThrow(
      new ConfigurationError("prisma-platform", keys),
    );
  });

  it("rejects a symlink and redacts the URL", () => {
    try {
      parseMigrationDatabaseConfig(
        "platform",
        {
          QCRM_ENV: "production",
          QCRM_MIGRATION_DATABASE_URL_FILE: expectedMigrationDatabaseSecretPath,
        },
        fileSystem(url, true),
      );
      throw new Error("Expected migration secret to fail");
    } catch (error) {
      expect(error).toEqual(
        new ConfigurationError("prisma-platform", ["QCRM_MIGRATION_DATABASE_URL_FILE"]),
      );
      expect(String(error)).not.toContain("test-only-migration");
    }
  });
});
