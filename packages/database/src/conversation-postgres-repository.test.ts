import type { CommercialActor } from "@quantum-crm/domain";
import { describe, expect, it, vi } from "vitest";

import {
  createConversationPostgresRepository,
  createExternalConversationReceiver,
} from "./conversation-postgres-repository.js";
import type { PostgresPool } from "./postgres-database.js";

const actor: CommercialActor = Object.freeze({
  memberId: "019b0000-0000-7000-8000-000000000001",
  scope: "OWN",
});
const contactId = "019b0000-0000-7000-8000-000000000002";
const row = Object.freeze({
  id: "019b0000-0000-7000-8000-000000000003",
  contact_id: contactId,
  channel: "whatsapp",
  external_thread_id: null,
  assignee_member_id: actor.memberId,
  status: "open",
  attention_mode: "human",
  subject: "Consulta",
  last_message_preview: "Necesito ayuda",
  last_message_at: new Date("2026-10-09T14:00:00.000Z"),
  unread_count: 1,
  version: "1",
  created_at: new Date("2026-10-09T13:00:00.000Z"),
  updated_at: new Date("2026-10-09T14:00:00.000Z"),
});

describe("conversation PostgreSQL repository", () => {
  it("records an agent reset and cancels pending work atomically without deleting messages", async () => {
    const active = { ...row, attention_mode: "agent" };
    const query = vi.fn(async (statement: string, _values?: unknown[]) => {
      if (statement.includes("SELECT payload_hash, response")) return { rows: [] };
      if (statement.includes("FOR UPDATE") && statement.includes("conversation.version"))
        return { rows: [active] };
      if (statement.includes("UPDATE conversations.conversations conversation SET"))
        return { rows: [{ ...active, version: "2" }] };
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn(async () => client) } as unknown as PostgresPool;
    await createConversationPostgresRepository(pool).update({
      actor: { ...actor, scope: "PROFILE" },
      id: row.id,
      expectedVersion: 1n,
      resetAgent: true,
      now: new Date("2026-10-12T04:00:00.000Z"),
      idempotencyKey: "reset-12345678",
      payloadHash: "a".repeat(64),
    });
    const statements = query.mock.calls.map(([statement]) => statement);
    expect(statements.some((statement) => statement.includes("agent_reset_at = CASE"))).toBe(true);
    expect(statements.some((statement) => statement.includes("agent_reset_sequence = CASE"))).toBe(
      true,
    );
    expect(
      statements.some((statement) =>
        statement.includes("UPDATE conversations.agent_requests SET status = 'cancelled'"),
      ),
    ).toBe(true);
    expect(
      query.mock.calls.some(
        ([statement, values]) =>
          statement.includes("INSERT INTO conversations.history") && values?.[1] === "agent_reset",
      ),
    ).toBe(true);
    expect(
      statements.some((statement) => statement.includes("DELETE FROM conversations.messages")),
    ).toBe(false);
    expect(statements.at(-1)).toBe("COMMIT");
  });

  it.each([
    { historical: false, expectedMode: "agent", expectedRequest: true },
    { historical: true, expectedMode: "human", expectedRequest: false },
  ])(
    "sets new inbound WhatsApp threads to $expectedMode when historical=$historical",
    async ({ historical, expectedRequest }) => {
      const query = vi.fn(async (statement: string) => {
        if (statement.includes("SELECT id::text FROM conversations.conversations"))
          return { rows: [] };
        if (statement.includes("SELECT id::text FROM conversations.messages")) return { rows: [] };
        if (statement.includes("COALESCE(MAX(sequence)")) return { rows: [{ sequence: "1" }] };
        return { rows: [], rowCount: 1 };
      });
      const client = { query, release: vi.fn() };
      const pool = { connect: vi.fn(async () => client) } as unknown as PostgresPool;
      const result = await createExternalConversationReceiver(pool).receive({
        externalThreadId: "ycloud:1234567890123456:50255556666",
        externalMessageId: historical ? "historic-1" : "live-1",
        contactId,
        contactDisplayName: "Cliente",
        direction: "INBOUND",
        kind: "TEXT",
        body: "Catalogo corporativo",
        occurredAt: new Date("2026-10-12T01:00:00.000Z"),
        historical,
      });
      expect(result).toBe("CREATED");
      const insert = query.mock.calls.find(([sql]) =>
        sql.includes("INSERT INTO conversations.conversations"),
      );
      expect(insert?.[0]).toContain("CASE WHEN $6 = 'inbound' AND NOT $7::boolean THEN 'agent'");
      expect(insert?.[1]?.slice(-2)).toEqual(["inbound", historical]);
      expect(
        query.mock.calls.some(([sql]) => sql.includes("INSERT INTO conversations.agent_requests")),
      ).toBe(expectedRequest);
    },
  );

  it("keeps the contact filter inside the authorized conversation query", async () => {
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [row] }));
    const pool = {
      query,
      connect: vi.fn(),
      end: vi.fn(async () => undefined),
      on: vi.fn(),
    } as unknown as PostgresPool;

    const result = await createConversationPostgresRepository(pool).list(actor, {
      limit: 25,
      contactId,
    });

    expect(result.items).toEqual([expect.objectContaining({ contactId, id: row.id })]);
    const [statement, values] = query.mock.calls[0] ?? [];
    expect(statement).toContain("conversation.contact_id = $2::uuid");
    expect(statement).toContain("conversation.assignee_member_id = $1::uuid");
    expect(values).toEqual([actor.memberId, contactId, 26]);
  });

  it("reconciles a bound outbound receipt and stops its delivery lease", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ delivery_status: "delivered" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn(async () => client) } as unknown as PostgresPool;
    const input = {
      messageId: "01995f7e-7b52-7000-8000-000000000402",
      externalThreadId: "ycloud:1234567890123456:50255556666",
      externalMessageId: "ycloud:1234567890123456:provider-1",
      status: "DELIVERED" as const,
    };

    expect(await createExternalConversationReceiver(pool).reconcileOutbound(input)).toBe(true);
    expect(query.mock.calls[1]?.[0]).toContain("conversation.external_thread_id = $2");
    expect(query.mock.calls[1]?.[1]).toEqual([
      input.messageId,
      input.externalThreadId,
      input.externalMessageId,
      "delivered",
      null,
    ]);
    expect(query.mock.calls[2]?.[1]).toEqual([input.messageId, "sent", null]);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
