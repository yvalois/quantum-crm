import { parseDatabaseConfig } from "@quantum-crm/config";
import { createPostgresDatabase, DatabaseUnavailableError } from "@quantum-crm/database";
import { describe, expect, it } from "vitest";

const tenantA = "00000000-0000-4000-8000-00000000000a";
const tenantB = "00000000-0000-4000-8000-00000000000b";

function crmConfig(tenantId: string, secretPath: string) {
  return parseDatabaseConfig("integration", { target: "crm", requiresTenant: true }, "test", {
    QCRM_TENANT_ID: tenantId,
    QCRM_DATABASE_URL_FILE: secretPath,
  });
}

function platformConfig(secretPath: string) {
  return parseDatabaseConfig("integration", { target: "platform", requiresTenant: false }, "test", {
    QCRM_DATABASE_URL_FILE: secretPath,
  });
}

describe("PostgreSQL profile isolation", () => {
  it("connects each runtime only to its assigned database", async () => {
    const databases = [
      createPostgresDatabase(
        crmConfig(tenantA, "/run/secrets/tenant_a_database_url"),
        "integration-a",
      ),
      createPostgresDatabase(
        crmConfig(tenantB, "/run/secrets/tenant_b_database_url"),
        "integration-b",
      ),
      createPostgresDatabase(
        platformConfig("/run/secrets/platform_database_url"),
        "integration-platform",
      ),
    ];

    try {
      for (const database of databases) {
        await database.connect();
        await expect(database.isReady()).resolves.toBe(true);
      }
    } finally {
      await Promise.all(databases.map(async (database) => database.close()));
    }
  });

  it("rejects cross-profile and platform-to-CRM connections", async () => {
    const forbiddenConnections = [
      createPostgresDatabase(
        crmConfig(tenantA, "/run/secrets/tenant_a_to_b_database_url"),
        "integration-cross-tenant",
      ),
      createPostgresDatabase(
        platformConfig("/run/secrets/platform_to_a_database_url"),
        "integration-platform-to-crm",
      ),
    ];

    try {
      for (const database of forbiddenConnections) {
        await expect(database.connect()).rejects.toEqual(new DatabaseUnavailableError());
        await expect(database.isReady()).resolves.toBe(false);
      }
    } finally {
      await Promise.all(forbiddenConnections.map(async (database) => database.close()));
    }
  });
});
