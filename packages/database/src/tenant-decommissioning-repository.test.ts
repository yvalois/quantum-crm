import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { createTenantDecommissioningRepository } from "./tenant-decommissioning-repository.js";
import type { PostgresPool } from "./postgres-database.js";

describe("tenant decommissioning repository", () => {
  it("releases the HTTPS hostname before tombstoning a decommissioned tenant", async () => {
    const completedOperation = {
      id: "019b0000-0000-7000-8000-000000000101",
      tenant_profile_id: "019b0000-0000-7000-8000-000000000102",
      requested_by_operator_id: "019b0000-0000-7000-8000-000000000103",
      idempotency_key: "decommission-019b0000",
      correlation_id: "decommission:019b0000",
      confirmation_slug: "interamerican",
      status: "succeeded",
      current_step: "tombstone",
      attempt: 9,
      version: "10",
      failure_code: null,
      lease_owner: null,
      lease_expires_at: null,
      created_at: new Date("2026-10-07T19:00:00.000Z"),
      updated_at: new Date("2026-10-07T19:01:00.000Z"),
    };
    const clientQuery = vi.fn(async (statement: string) => {
      if (statement.includes("UPDATE operations.tenant_decommissioning_operations")) {
        return { rows: [completedOperation] };
      }
      return { rows: [] };
    });
    const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    } as unknown as PostgresPool;

    await expect(
      createTenantDecommissioningRepository(pool).complete({
        id: completedOperation.id,
        workerId: "deploy-executor:test",
        expectedVersion: 9n,
        attempt: completedOperation.attempt,
      }),
    ).resolves.toMatchObject({ status: "SUCCEEDED" });

    const statements = clientQuery.mock.calls.map(([statement]) => statement);
    const releaseRouteIndex = statements.findIndex((statement) =>
      statement.includes("DELETE FROM tenants.tenant_https_routes"),
    );
    const tombstoneIndex = statements.findIndex((statement) =>
      statement.includes("UPDATE tenants.tenant_profiles SET status = 'deleted'"),
    );

    expect(releaseRouteIndex).toBeGreaterThan(0);
    expect(releaseRouteIndex).toBeLessThan(tombstoneIndex);
    expect(statements[releaseRouteIndex]).toContain("profile.status = 'decommissioning'");
    expect(statements.at(-1)).toBe("COMMIT");
  });
});
