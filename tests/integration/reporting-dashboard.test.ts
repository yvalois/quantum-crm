import { randomUUID } from "node:crypto";
import { parseDatabaseConfig } from "@quantum-crm/config";
import { createCrmPostgresDatabase } from "@quantum-crm/database";
import { DashboardService } from "@quantum-crm/domain";
import { afterAll, describe, expect, it } from "vitest";

const profiles = ["a", "b"].map((suffix) => {
  const tenantId = `00000000-0000-4000-8000-00000000000${suffix}`;
  const config = parseDatabaseConfig(
    "reporting-integration",
    { target: "crm", requiresTenant: true },
    "test",
    {
      QCRM_TENANT_ID: tenantId,
      QCRM_DATABASE_URL_FILE: `/run/secrets/ghl_import_test_${suffix}_database_url`,
    },
  );
  return { database: createCrmPostgresDatabase(config, `reporting-test-${suffix}`) };
});

afterAll(async () => {
  await Promise.all(profiles.map(({ database }) => database.close()));
});

describe("REP-01 aggregates against isolated PostgreSQL profiles", () => {
  it("runs all five scoped aggregate families and excludes unassigned data", async () => {
    const permissions = [
      "crm:contacts:read",
      "crm:conversations:read",
      "crm:sales:read",
      "crm:tasks:read",
    ] as const;
    for (const { database } of profiles) {
      const service = new DashboardService(database.reporting);
      const actor = { memberId: randomUUID(), scope: "ASSIGNED" } as const;
      const result = await service.snapshot(
        actor,
        permissions,
        "all",
        new Date("2026-10-14T12:00:00Z"),
      );
      expect(result.metrics.contacts).toBe(0);
      expect(result.metrics.conversations).toBe(0);
      expect(result.metrics.openOpportunities).toBe(0);
      expect(result.metrics.overdueTasks).toBe(0);
      expect(result.metrics.pipelineValue).toEqual([]);
    }
  });
});
