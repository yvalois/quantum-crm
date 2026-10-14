import { describe, expect, it, vi } from "vitest";
import { createReportingPostgresRepository } from "./reporting-postgres-repository.js";
import type { PostgresPool } from "./postgres-database.js";

describe("reporting repository", () => {
  it("never reads a domain without its permission", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ value: "3" }] });
    const repository = createReportingPostgresRepository({ query } as unknown as PostgresPool);
    const result = await repository.snapshot({
      actor: { memberId: "018f96c4-3210-7000-8000-000000000001", scope: "ASSIGNED" },
      from: null,
      now: new Date("2026-10-14T12:00:00Z"),
      period: "all",
      access: { contacts: false, conversations: false, sales: false, tasks: true },
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("task.assignee_member_id = $2::uuid");
    expect(query.mock.calls[0]?.[1]).toHaveLength(3);
    expect(result.metrics.contacts).toBeNull();
    expect(result.metrics.conversations).toBeNull();
    expect(result.metrics.openOpportunities).toBeNull();
    expect(result.metrics.overdueTasks).toBe(3);
  });

  it("keeps pipeline values in separate currencies", async () => {
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("GROUP BY opportunity.currency"))
        return Promise.resolve({
          rows: [
            { currency: "GTQ", amount_minor: "10000" },
            { currency: "USD", amount_minor: "20000" },
          ],
        });
      return Promise.resolve({ rows: [] });
    });
    const repository = createReportingPostgresRepository({ query } as unknown as PostgresPool);
    const result = await repository.snapshot({
      actor: { memberId: "018f96c4-3210-7000-8000-000000000001", scope: "PROFILE" },
      from: null,
      now: new Date("2026-10-14T12:00:00Z"),
      period: "all",
      access: { contacts: false, conversations: false, sales: true, tasks: false },
    });
    expect(result.metrics.pipelineValue).toEqual([
      { currency: "GTQ", amountMinor: "10000" },
      { currency: "USD", amountMinor: "20000" },
    ]);
    expect(query.mock.calls.every((call) => call[1].length === 1)).toBe(true);
  });
});
