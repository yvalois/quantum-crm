import type { CommercialActor } from "@quantum-crm/domain";
import { describe, expect, it, vi } from "vitest";

import { createConversationPostgresRepository } from "./conversation-postgres-repository.js";
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
});
