import { describe, expect, it, vi } from "vitest";

import { createConversationInboundMediaPostgresRepository } from "./conversation-inbound-media-postgres-repository.js";
import type { PostgresPool } from "./postgres-database.js";

const messageId = "019b0000-0000-7000-8000-000000000001";
const conversationId = "019b0000-0000-7000-8000-000000000002";

describe("inbound media PostgreSQL job", () => {
  it("claims one lease with a new fencing generation", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("SELECT media.message_id")
        ? {
            rows: [
              {
                message_id: messageId,
                conversation_id: conversationId,
                provider_media_id: "123456",
                expected_sha256: "A".repeat(43) + "=",
                declared_mime: "audio/ogg",
                kind: "audio",
                caption: "Audio",
                file_id: null,
                lease_generation: "2",
              },
            ],
          }
        : { rows: [], rowCount: 1 },
    );
    const pool = { connect: async () => ({ query, release: vi.fn() }) } as unknown as PostgresPool;
    const lease = await createConversationInboundMediaPostgresRepository(pool).claimNext("worker");
    expect(lease).toMatchObject({ messageId, conversationId, kind: "AUDIO", generation: 3n });
    expect(
      query.mock.calls.some(
        ([sql, values]) => sql.includes("lease_generation = $3") && values?.[2] === "3",
      ),
    ).toBe(true);
  });

  it("only attaches the scanned file and queues the agent under the same fenced transaction", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("UPDATE conversations.inbound_media SET status = 'completed'")
        ? { rowCount: 1 }
        : { rowCount: 1 },
    );
    const pool = { connect: async () => ({ query, release: vi.fn() }) } as unknown as PostgresPool;
    const repository = createConversationInboundMediaPostgresRepository(pool);
    const lease = {
      messageId,
      conversationId,
      providerMediaId: "123456",
      expectedSha256: "A".repeat(43) + "=",
      declaredMime: "image/jpeg",
      kind: "IMAGE" as const,
      caption: "Imagen",
      fileId: "019b0000-0000-7000-8000-000000000003",
      generation: 1n,
    };
    expect(await repository.complete(lease, "worker", lease.fileId, "A red SUV")).toBe(true);
    const statements = query.mock.calls.map(([sql]) => sql);
    expect(
      statements.findIndex((sql) => sql.includes("UPDATE conversations.messages SET file_id")),
    ).toBeGreaterThan(statements.findIndex((sql) => sql.includes("status = 'completed'")));
    expect(
      statements.findIndex((sql) => sql.includes("INSERT INTO conversations.agent_requests")),
    ).toBeGreaterThan(
      statements.findIndex((sql) => sql.includes("UPDATE conversations.messages SET file_id")),
    );
    expect(statements.at(-1)).toBe("COMMIT");
  });
});
