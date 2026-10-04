import { describe, expect, it, vi } from "vitest";

import { createTenantReleasePromotionRepository } from "./tenant-release-promotion-repository.js";
import type { PostgresPool } from "./postgres-database.js";

describe("tenant release promotion repository", () => {
  it("qualifies the candidate id when claiming the next promotion", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const pool = { connect: vi.fn(), query, end: vi.fn(), on: vi.fn() } as unknown as PostgresPool;

    await expect(
      createTenantReleasePromotionRepository(pool).claimNext({
        workerId: "deploy-executor:test",
        leaseDurationSeconds: 120,
      }),
    ).resolves.toBeNull();

    const statement = query.mock.calls[0]?.[0] as string;
    expect(statement).toContain("SELECT id AS candidate_id");
    expect(statement).toContain("promotion.id=candidate.candidate_id");
    expect(statement).toContain("lease_expires_at IS NULL");
  });

  it("releases the lease when advancing to the next promotion step", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const pool = { connect: vi.fn(), query, end: vi.fn(), on: vi.fn() } as unknown as PostgresPool;

    await expect(
      createTenantReleasePromotionRepository(pool).advance({
        id: "01995f7e-7b52-7000-8000-000000000101",
        workerId: "deploy-executor:test",
        expectedVersion: 1n,
        attempt: 1,
        currentStep: "RECONCILE",
        nextStep: "VERIFY",
      }),
    ).resolves.toBeNull();

    const statement = query.mock.calls[0]?.[0] as string;
    expect(statement).toContain("lease_owner = NULL");
    expect(statement).toContain("lease_expires_at = NULL");
  });

  it("keeps every completion parameter fenced in the final update", async () => {
    const row = {
      id: "01995f7e-7b52-7000-8000-000000000101",
      tenant_profile_id: "01995f7e-7b52-7000-8000-000000000201",
      previous_release_id: "01995f7e-7b52-7000-8000-000000000301",
      target_release_id: "01995f7e-7b52-7000-8000-000000000302",
      requested_by_operator_id: "01995f7e-7b52-7000-8000-000000000401",
      idempotency_key: "promotion:test",
      correlation_id: "correlation:test",
      status: "running",
      current_step: "activate",
      attempt: 1,
      version: "1",
      failure_code: null,
      lease_owner: "deploy-executor:test",
      lease_expires_at: new Date("2030-01-01T00:00:00Z"),
      created_at: new Date("2029-01-01T00:00:00Z"),
      updated_at: new Date("2029-01-01T00:00:00Z"),
    };
    const client = {
      query: vi.fn(async (statement: string) => {
        if (statement === "BEGIN" || statement === "COMMIT") return undefined;
        if (statement.includes("SELECT") && statement.includes("FOR UPDATE")) {
          return { rows: [row] };
        }
        if (statement.includes("UPDATE tenants.tenant_profiles")) return { rowCount: 1 };
        if (statement.includes("UPDATE tenants.tenant_configurations")) return { rowCount: 1 };
        if (statement.includes("UPDATE tenants.tenant_containers")) return { rowCount: 5 };
        return {
          rows: [
            {
              ...row,
              status: "succeeded",
              version: "2",
              lease_owner: null,
              lease_expires_at: null,
            },
          ],
        };
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    } as unknown as PostgresPool;

    await expect(
      createTenantReleasePromotionRepository(pool).complete({
        id: "01995f7e-7b52-7000-8000-000000000101",
        workerId: "deploy-executor:test",
        expectedVersion: 1n,
        attempt: 1,
      }),
    ).resolves.toMatchObject({ status: "SUCCEEDED" });

    const statement = client.query.mock.calls
      .map(([sql]) => sql as string)
      .find((sql) => sql.includes("SET status=$6")) as string;
    expect(statement).toContain("lease_owner=$2");
    expect(statement).toContain("version=$3");
    expect(statement).toContain("attempt=$4");
  });
});
