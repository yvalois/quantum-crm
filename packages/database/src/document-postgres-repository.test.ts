import type { CommercialActor } from "@quantum-crm/domain";
import { describe, expect, it, vi } from "vitest";

import { createDocumentPostgresRepository } from "./document-postgres-repository.js";
import type { PostgresPool } from "./postgres-database.js";

const actor: CommercialActor = Object.freeze({
  memberId: "019b0000-0000-7000-8000-000000000011",
  scope: "OWN",
});
const contactId = "019b0000-0000-7000-8000-000000000012";
const row = Object.freeze({
  id: "019b0000-0000-7000-8000-000000000013",
  kind: "quote",
  status: "draft",
  title: "Cotización",
  contact_id: contactId,
  opportunity_id: null,
  owner_member_id: actor.memberId,
  source_template_id: null,
  blocks: [],
  design: {},
  revision: 1,
  version: "1",
  created_at: new Date("2026-10-09T13:00:00.000Z"),
  updated_at: new Date("2026-10-09T14:00:00.000Z"),
});

describe("document PostgreSQL repository", () => {
  it("keeps the contact filter inside the authorized document query", async () => {
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [row] }));
    const pool = {
      query,
      connect: vi.fn(),
      end: vi.fn(async () => undefined),
      on: vi.fn(),
    } as unknown as PostgresPool;

    const result = await createDocumentPostgresRepository(pool).list(actor, { contactId });

    expect(result).toEqual([expect.objectContaining({ contactId, id: row.id })]);
    const [statement, values] = query.mock.calls[0] ?? [];
    expect(statement).toContain("document.contact_id = $1::uuid");
    expect(statement).toContain("document.owner_member_id = $2::uuid");
    expect(values).toEqual([contactId, actor.memberId]);
  });
});
