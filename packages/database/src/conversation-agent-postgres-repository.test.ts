import { describe, expect, it, vi } from "vitest";

import { createConversationAgentPostgresRepository } from "./conversation-agent-postgres-repository.js";
import type { PostgresPool } from "./postgres-database.js";

describe("conversation agent PostgreSQL repository", () => {
  it("derives first turn from completed requests since the last reset", async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes("NOT EXISTS ("))
        return {
          rows: [
            {
              inbound_message_id: "019b0000-0000-7000-8000-000000000001",
              conversation_id: "019b0000-0000-7000-8000-000000000002",
              question: "Hola",
              lease_generation: "0",
              first_turn: true,
            },
          ],
        };
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn(async () => client) } as unknown as PostgresPool;
    const lease = await createConversationAgentPostgresRepository(pool).claimNext({
      workerId: "test-worker",
      leaseSeconds: 90,
    });
    expect(lease?.firstTurn).toBe(true);
    expect(
      query.mock.calls.find(([statement]) => statement.includes("NOT EXISTS ("))?.[0],
    ).toContain("conversation.agent_reset_at");
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });
});
