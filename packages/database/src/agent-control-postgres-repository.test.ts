import { describe, expect, it, vi } from "vitest";

import { createAgentControlPostgresRepository } from "./agent-control-postgres-repository.js";
import type { PostgresPool } from "./postgres-database.js";

const actorMemberId = "019b0000-0000-7000-8000-000000000001";
const row = { enabled: true, version: "1", updated_at: new Date("2026-10-14T00:00:00Z") };

describe("agent control repository", () => {
  it("pauses persistently, audits the change and cancels pending executions in one transaction", async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes("SELECT enabled")) return { rows: [row] };
      if (statement.includes("UPDATE conversations.agent_control"))
        return { rows: [{ ...row, enabled: false, version: "2" }] };
      return { rows: [], rowCount: 1 };
    });
    const pool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    } as unknown as PostgresPool;
    const result = await createAgentControlPostgresRepository(pool).set({
      enabled: false,
      expectedVersion: 1n,
      actorMemberId,
    });
    expect(result).toMatchObject({ enabled: false, version: 2n });
    expect(query.mock.calls.map(([statement]) => statement)).toEqual([
      "BEGIN",
      expect.stringContaining("FOR UPDATE"),
      expect.stringContaining("UPDATE conversations.agent_control"),
      expect.stringContaining("INSERT INTO conversations.agent_control_events"),
      expect.stringContaining("UPDATE conversations.agent_requests"),
      expect.stringContaining("UPDATE conversations.outbox"),
      "COMMIT",
    ]);
  });

  it("does not emit a second event when the requested state already matches", async () => {
    const query = vi.fn(async (statement: string) =>
      statement.includes("SELECT enabled") ? { rows: [row] } : { rows: [] },
    );
    const pool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    } as unknown as PostgresPool;
    const result = await createAgentControlPostgresRepository(pool).set({
      enabled: true,
      expectedVersion: 1n,
      actorMemberId,
    });
    expect(result?.version).toBe(1n);
    expect(query.mock.calls.map(([statement]) => statement)).toEqual([
      "BEGIN",
      expect.stringContaining("FOR UPDATE"),
      "COMMIT",
    ]);
  });
});
