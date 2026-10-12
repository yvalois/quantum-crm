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
