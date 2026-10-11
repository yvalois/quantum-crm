import { Buffer } from "node:buffer";
import type { CommercialActor, ImportHistoricalMessageInput } from "@quantum-crm/domain";
import { HistoricalAttachmentConflictError } from "@quantum-crm/domain";
import { describe, expect, it, vi } from "vitest";
import { createHistoricalConversationPostgresRepository } from "./historical-conversation-postgres-repository.js";
import type { PostgresPool } from "./postgres-database.js";

const actor: CommercialActor = {
  memberId: "019b0000-0000-7000-8000-000000000001",
  scope: "PROFILE",
};
const threadId = "019b0000-0000-7000-8000-000000000002";
const messageId = "019b0000-0000-7000-8000-000000000003";
const input: ImportHistoricalMessageInput = {
  actor,
  permissions: ["crm:conversations:configure"],
  source: {
    system: "GHL",
    locationId: "fixture-location",
    externalId: "fixture-message",
    payloadHash: "a".repeat(64),
    raw: {},
  },
  threadSourceExternalId: "missing-current-thread",
  message: {
    sourceContactId: null,
    rawChannel: "TYPE_CALL",
    rawType: "1",
    rawDirection: "outbound",
    rawStatus: "pending",
    body: "",
    attachmentCount: 1,
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
  },
};
function poolWith(
  query: (statement: string, values?: unknown[]) => Promise<unknown>,
): PostgresPool {
  return {
    query,
    connect: vi.fn(async () => ({ query, release: vi.fn() })),
    end: vi.fn(async () => undefined),
    on: vi.fn(),
  } as unknown as PostgresPool;
}

describe("historical conversation repository", () => {
  const attachmentRow = {
    id: "019b0000-0000-7000-8000-000000000004",
    message_id: messageId,
    attachment_index: 0,
    source_hash: "a".repeat(64),
    file_id: null,
    status: "PENDING",
    error_code: null,
    display_name: null,
    mime_type: null,
    byte_size: null,
  };
  it("reserves a stable source position with audit, without source URLs or message effects", async () => {
    const query = vi.fn(async (statement: string, _values?: unknown[]) => {
      if (statement.includes("SELECT id::text, attachment_count"))
        return { rows: [{ id: messageId, attachment_count: 1 }] };
      if (statement.includes("INSERT INTO conversations.historical_attachments"))
        return { rows: [attachmentRow] };
      return { rows: [] };
    });
    const result = await createHistoricalConversationPostgresRepository(
      poolWith(query),
    ).reserveAttachment(input, {
      locationId: "fixture-location",
      externalMessageId: "fixture-message",
      attachmentIndex: 0,
      sourceHash: attachmentRow.source_hash,
    });
    expect(result).toMatchObject({ id: attachmentRow.id, messageId, status: "PENDING" });
    const statements = query.mock.calls.map(([statement]) => statement).join("\n");
    expect(statements).toContain("ON CONFLICT (message_id, attachment_index) DO NOTHING");
    expect(statements).toContain("INSERT INTO conversations.historical_attachment_events");
    expect(statements).not.toContain("outbox");
    expect(statements).not.toContain("source_payload");
    expect(
      query.mock.calls.find(([statement]) =>
        statement.includes("SELECT id::text, attachment_count"),
      )?.[1],
    ).toEqual(["fixture-location", "fixture-message"]);
  });

  it("fails on changed attachment source identity without overwriting the association", async () => {
    const query = vi.fn(async (statement: string, _values?: unknown[]) => {
      if (statement.includes("SELECT id::text, attachment_count"))
        return { rows: [{ id: messageId, attachment_count: 1 }] };
      if (statement.includes("FROM conversations.historical_attachments attachment"))
        return { rows: [attachmentRow] };
      return { rows: [] };
    });
    await expect(
      createHistoricalConversationPostgresRepository(poolWith(query)).reserveAttachment(input, {
        locationId: "fixture-location",
        externalMessageId: "fixture-message",
        attachmentIndex: 0,
        sourceHash: "b".repeat(64),
      }),
    ).rejects.toBeInstanceOf(HistoricalAttachmentConflictError);
    expect(query.mock.calls.some(([statement]) => statement.includes("UPDATE"))).toBe(false);
    expect(query.mock.calls.some(([statement]) => statement === "ROLLBACK")).toBe(true);
  });

  it("authorizes attachment reads through the same assigned thread scope", async () => {
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [] }));
    expect(
      await createHistoricalConversationPostgresRepository(poolWith(query)).findAttachment(
        { ...actor, scope: "TEAM" },
        attachmentRow.id,
      ),
    ).toBeNull();
    expect(query.mock.calls[0]?.[0]).toContain("iam.team_members");
    expect(query.mock.calls[0]?.[0]).toContain("thread.contact_id IS NOT NULL");
    expect(query.mock.calls[0]?.[1]).toEqual([attachmentRow.id, actor.memberId]);
  });

  it("preserves AVAILABLE on a stale failure and prevents replacing a bound file", async () => {
    const row = {
      ...attachmentRow,
      file_id: threadId,
      status: "AVAILABLE",
      display_name: "fixture.png",
      mime_type: "image/png",
      byte_size: "123",
    };
    const query = vi.fn(async (statement: string, _values?: unknown[]) =>
      statement.includes("FOR UPDATE") ? { rows: [row] } : { rows: [] },
    );
    const repository = createHistoricalConversationPostgresRepository(poolWith(query));
    const update = {
      attachmentId: row.id,
      fileId: threadId,
      status: "FAILED" as const,
      errorCode: "TRANSFER_FAILED" as const,
      name: row.display_name,
      mimeType: row.mime_type,
      size: 123,
    };
    expect((await repository.setAttachmentResult(input, update)).status).toBe("AVAILABLE");
    await expect(
      repository.setAttachmentResult(input, { ...update, fileId: messageId }),
    ).rejects.toBeInstanceOf(HistoricalAttachmentConflictError);
    expect(query.mock.calls.some(([statement]) => statement.startsWith("UPDATE"))).toBe(false);
    expect(
      query.mock.calls.some(([statement]) =>
        statement.includes("INSERT INTO conversations.historical_attachment_events"),
      ),
    ).toBe(false);
  });
  it("inserts the message and source map atomically without any outbox and binds the source location", async () => {
    const query = vi.fn(async (statement: string, _values?: unknown[]) => {
      if (statement.includes("SELECT id::text FROM conversations.historical_threads"))
        return { rows: [{ id: threadId }] };
      if (statement.includes("INSERT INTO conversations.historical_messages"))
        return { rows: [{ id: messageId }] };
      return { rows: [] };
    });
    const result = await createHistoricalConversationPostgresRepository(
      poolWith(query),
    ).importMessage(input);
    expect(result.status).toBe("CREATED");
    const statements = query.mock.calls.map(([statement]) => statement).join("\n");
    expect(statements).toContain("BEGIN");
    expect(statements).toContain("INSERT INTO conversations.historical_imports");
    expect(statements).toContain("COMMIT");
    expect(statements).not.toContain("conversations.outbox");
    expect(statements).not.toContain("INSERT INTO conversations.messages");
    const parent = query.mock.calls.find(([statement]) =>
      statement.includes("SELECT id::text FROM conversations.historical_threads"),
    );
    expect(parent?.[1]).toEqual(["GHL", "fixture-location", "missing-current-thread"]);
    const insert = query.mock.calls.find(([statement]) =>
      statement.includes("INSERT INTO conversations.historical_messages"),
    );
    expect(insert?.[1]?.slice(8)).toEqual(["pending", "", 1, null, null]);
  });

  it("replays unchanged imports and preserves existing rows if source content changes", async () => {
    for (const hash of ["a".repeat(64), "b".repeat(64)]) {
      const query = vi.fn(async (statement: string, _values?: unknown[]) =>
        statement.includes("SELECT entity_id::text")
          ? { rows: [{ entity_id: messageId, payload_hash: hash, result_metadata: {} }] }
          : { rows: [] },
      );
      const result = await createHistoricalConversationPostgresRepository(
        poolWith(query),
      ).importMessage(input);
      expect(result.status).toBe(hash === input.source.payloadHash ? "REPLAYED" : "SOURCE_CHANGED");
      expect(query.mock.calls.some(([statement]) => /INSERT|UPDATE/u.test(statement))).toBe(false);
    }
  });

  it("fails and rolls back an unresolved parent instead of silently dropping or fabricating a thread", async () => {
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [] }));
    await expect(
      createHistoricalConversationPostgresRepository(poolWith(query)).importMessage(input),
    ).rejects.toThrow("Invalid historical import record");
    expect(query.mock.calls.map(([statement]) => statement)).toContain("ROLLBACK");
    expect(query.mock.calls.some(([statement]) => statement.includes("INSERT INTO"))).toBe(false);
  });

  it("restricts unresolved historical records to profile scope and parameterizes contact filters", async () => {
    const references = {
      locationId: "fixture-location",
      ownerExternalId: "original-advisor",
      followerExternalIds: ["original-follower"],
    };
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({
      rows: [{
        id: threadId,
        source_system: "GHL",
        source_external_id: "fixture-thread",
        source_thread_present: true,
        contact_id: threadId,
        assignee_member_id: actor.memberId,
        source_participant_references: { ...references, privateAttribute: "private-source-marker" },
        source_payload: { privateAttribute: "private-source-marker" },
        source_contact_id: "private-source-marker",
        raw_channel: null,
        raw_status: null,
        subject: null,
        source_created_at: null,
        source_updated_at: null,
        message_count: 0,
        last_message_at: null,
        imported_at: "2026-10-11T12:00:00.000Z",
      }],
    }));
    const result = await createHistoricalConversationPostgresRepository(poolWith(query)).list(
      { ...actor, scope: "OWN" },
      { limit: 50, contactId: threadId },
    );
    const [statement, params] = query.mock.calls[0] ?? [];
    expect(statement).toContain("thread.contact_id IS NOT NULL");
    expect(statement).toContain("thread.source_thread_present = TRUE");
    expect(statement).toContain("thread.assignee_member_id = $1::uuid");
    const sourceFields = /source_map\.source_payload\s*->>?\s*'([^']+)'/gu;
    expect(Array.from((statement ?? "").matchAll(sourceFields), (match) => match[1])).toEqual([
      "assignedTo",
      "followers",
    ]);
    expect(statement?.replace(sourceFields, "allowed_projection")).not.toContain("source_payload");
    expect(statement).not.toContain("source_contact_id");
    expect(params).toEqual([actor.memberId, threadId, 51]);
    expect(result.items[0]?.sourceParticipantReferences).toEqual(references);
    expect(result.items[0]).not.toHaveProperty("source_payload");
    expect(result.items[0]).not.toHaveProperty("source_contact_id");
    expect(JSON.stringify(result)).not.toContain("private-source-marker");
  });

  it("separates linked and unresolved history without dropping scope restrictions", async () => {
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [] }));
    const repository = createHistoricalConversationPostgresRepository(poolWith(query));
    await repository.list(actor, { limit: 50, contactState: "LINKED" });
    expect(query.mock.calls.at(-1)?.[0]).toContain("thread.contact_id IS NOT NULL");
    await repository.list({ ...actor, scope: "OWN" }, { limit: 50, contactState: "UNLINKED" });
    expect(query.mock.calls.at(-1)?.[0]).toContain("thread.contact_id IS NULL");
    expect(query.mock.calls.at(-1)?.[0]).toContain("thread.assignee_member_id = $1::uuid");
  });

  it("resolves a missing thread channel from its latest attributed message without changing source data", async () => {
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [] }));
    await createHistoricalConversationPostgresRepository(poolWith(query)).list(actor, {
      limit: 50,
    });
    const statement = query.mock.calls[0]?.[0];
    expect(statement).toContain("COALESCE(NULLIF(thread.raw_channel, '')");
    expect(statement).toContain("channel_message.thread_id = thread.id");
    expect(statement).toContain("channel_message.source_created_at DESC NULLS LAST");
    expect(statement).not.toMatch(/UPDATE|INSERT/u);
  });

  it("does not load messages before the thread passes its scope check", async () => {
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [] }));
    expect(
      await createHistoricalConversationPostgresRepository(poolWith(query)).messages(
        { ...actor, scope: "TEAM" },
        threadId,
        { limit: 50 },
      ),
    ).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("iam.team_members");
  });

  it("pages chronologically across equal dates and missing source timestamps", async () => {
    const row = {
      id: messageId,
      thread_id: threadId,
      source_external_id: "fixture-message",
      raw_channel: null,
      raw_type: null,
      raw_direction: null,
      raw_status: null,
      body: "",
      attachment_count: 0,
      source_created_at: null,
      source_updated_at: null,
      imported_at: "2026-10-11T00:00:00Z",
    };
    const query = vi.fn(async (statement: string, _values?: unknown[]) =>
      statement.includes("SELECT thread.id")
        ? { rows: [{ id: threadId }] }
        : { rows: [row, { ...row, id: "019b0000-0000-7000-8000-000000000004" }] },
    );
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
