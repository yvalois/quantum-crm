import { Buffer } from "node:buffer";
import type { CommercialActor, ImportHistoricalMessageInput } from "@quantum-crm/domain";
import { describe, expect, it, vi } from "vitest";
import { createHistoricalConversationPostgresRepository } from "./historical-conversation-postgres-repository.js";
import type { PostgresPool } from "./postgres-database.js";

const actor: CommercialActor = { memberId: "019b0000-0000-7000-8000-000000000001", scope: "PROFILE" };
const threadId = "019b0000-0000-7000-8000-000000000002";
const messageId = "019b0000-0000-7000-8000-000000000003";
const input: ImportHistoricalMessageInput = {
  actor, permissions: ["crm:conversations:configure"],
  source: { system: "GHL", locationId: "fixture-location", externalId: "fixture-message", payloadHash: "a".repeat(64), raw: {} },
  threadSourceExternalId: "missing-current-thread",
  message: { sourceContactId: null, rawChannel: "TYPE_CALL", rawType: "1", rawDirection: "outbound", rawStatus: "pending", body: "", attachmentCount: 1, sourceCreatedAt: null, sourceUpdatedAt: null },
};
function poolWith(query: (statement: string, values?: unknown[]) => Promise<unknown>): PostgresPool {
  return { query, connect: vi.fn(async () => ({ query, release: vi.fn() })), end: vi.fn(async () => undefined), on: vi.fn() } as unknown as PostgresPool;
}

describe("historical conversation repository", () => {
  it("inserts the message and source map atomically without any outbox and binds the source location", async () => {
    const query = vi.fn(async (statement: string, _values?: unknown[]) => {
      if (statement.includes("SELECT id::text FROM conversations.historical_threads")) return { rows: [{ id: threadId }] };
      if (statement.includes("INSERT INTO conversations.historical_messages")) return { rows: [{ id: messageId }] };
      return { rows: [] };
    });
    const result = await createHistoricalConversationPostgresRepository(poolWith(query)).importMessage(input);
    expect(result.status).toBe("CREATED");
    const statements = query.mock.calls.map(([statement]) => statement).join("\n");
    expect(statements).toContain("BEGIN");
    expect(statements).toContain("INSERT INTO conversations.historical_imports");
    expect(statements).toContain("COMMIT");
    expect(statements).not.toContain("conversations.outbox");
    expect(statements).not.toContain("INSERT INTO conversations.messages");
    const parent = query.mock.calls.find(([statement]) => statement.includes("SELECT id::text FROM conversations.historical_threads"));
    expect(parent?.[1]).toEqual(["GHL", "fixture-location", "missing-current-thread"]);
    const insert = query.mock.calls.find(([statement]) => statement.includes("INSERT INTO conversations.historical_messages"));
    expect(insert?.[1]?.slice(8)).toEqual(["pending", "", 1, null, null]);
  });

  it("replays unchanged imports and preserves existing rows if source content changes", async () => {
    for (const hash of ["a".repeat(64), "b".repeat(64)]) {
      const query = vi.fn(async (statement: string, _values?: unknown[]) => statement.includes("SELECT entity_id::text") ? { rows: [{ entity_id: messageId, payload_hash: hash, result_metadata: {} }] } : { rows: [] });
      const result = await createHistoricalConversationPostgresRepository(poolWith(query)).importMessage(input);
      expect(result.status).toBe(hash === input.source.payloadHash ? "REPLAYED" : "SOURCE_CHANGED");
      expect(query.mock.calls.some(([statement]) => /INSERT|UPDATE/u.test(statement))).toBe(false);
    }
  });

  it("fails and rolls back an unresolved parent instead of silently dropping or fabricating a thread", async () => {
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [] }));
    await expect(createHistoricalConversationPostgresRepository(poolWith(query)).importMessage(input)).rejects.toThrow("Invalid historical import record");
    expect(query.mock.calls.map(([statement]) => statement)).toContain("ROLLBACK");
    expect(query.mock.calls.some(([statement]) => statement.includes("INSERT INTO"))).toBe(false);
  });

  it("restricts unresolved historical records to profile scope and parameterizes contact filters", async () => {
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [] }));
    await createHistoricalConversationPostgresRepository(poolWith(query)).list({ ...actor, scope: "OWN" }, { limit: 50, contactId: threadId });
    const [statement, params] = query.mock.calls[0] ?? [];
    expect(statement).toContain("thread.contact_id IS NOT NULL");
    expect(statement).toContain("thread.source_thread_present = TRUE");
    expect(statement).toContain("thread.assignee_member_id = $1::uuid");
    expect(statement).not.toContain("source_payload");
    expect(statement).not.toContain("source_contact_id");
    expect(params).toEqual([actor.memberId, threadId, 51]);
  });

  it("does not load messages before the thread passes its scope check", async () => {
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [] }));
    expect(await createHistoricalConversationPostgresRepository(poolWith(query)).messages({ ...actor, scope: "TEAM" }, threadId, { limit: 50 })).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("iam.team_members");
  });

  it("pages chronologically across equal dates and missing source timestamps", async () => {
    const row = { id: messageId, thread_id: threadId, source_external_id: "fixture-message", raw_channel: null, raw_type: null, raw_direction: null, raw_status: null, body: "", attachment_count: 0, source_created_at: null, source_updated_at: null, imported_at: "2026-10-11T00:00:00Z" };
    const query = vi.fn(async (statement: string, _values?: unknown[]) => statement.includes("SELECT thread.id") ? { rows: [{ id: threadId }] } : { rows: [row, { ...row, id: "019b0000-0000-7000-8000-000000000004" }] });
    const repository = createHistoricalConversationPostgresRepository(poolWith(query));
    const page = await repository.messages(actor, threadId, { limit: 1 });
    expect(page?.items[0]?.sourceCreatedAt).toBeNull();
    expect(page?.nextCursor).not.toBeNull();
    const cursor = Buffer.from(JSON.stringify({ id: messageId, at: null })).toString("base64url");
    await repository.messages(actor, threadId, { limit: 1, cursor });
    expect(query.mock.calls.at(-1)?.[1]).toEqual([threadId, null, messageId, 2]);
    expect(query.mock.calls.at(-1)?.[0]).toContain("'infinity'::timestamptz");
  });
});
