import { Buffer } from "node:buffer";
import { ConversationValidationError, type CommercialActor } from "@quantum-crm/domain";
import { describe, expect, it, vi } from "vitest";
import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";
import { createUnifiedInboxPostgresRepository } from "./unified-inbox-postgres-repository.js";

const actor: CommercialActor = {
  memberId: "019b0000-0000-7000-8000-000000000001",
  scope: "PROFILE",
};
const timestamp = "2026-10-11T00:00:00.123456Z";
const historical = {
  id: "019b0000-0000-7000-8000-000000000002",
  source_rank: 0,
  activity_at: timestamp,
  quantum: null,
  ghl: {
    id: "019b0000-0000-7000-8000-000000000002",
    source_system: "GHL",
    source_external_id: "fixture",
    source_thread_present: true,
    contact_id: null,
    assignee_member_id: null,
    raw_channel: "TYPE_EMAIL",
    raw_status: "unread",
    subject: null,
    source_created_at: null,
    source_updated_at: null,
    message_count: 0,
    last_message_at: timestamp,
    imported_at: timestamp,
  },
};
const native = {
  id: "019b0000-0000-7000-8000-000000000003",
  source_rank: 1,
  activity_at: timestamp,
  ghl: null,
  quantum: {
    id: "019b0000-0000-7000-8000-000000000003",
    contact_id: actor.memberId,
    channel: "email",
    external_thread_id: null,
    assignee_member_id: actor.memberId,
    status: "open",
    attention_mode: "human",
    subject: "Fixture",
    last_message_preview: "Fixture",
    last_message_at: timestamp,
    unread_count: 0,
    version: "9007199254740993",
    created_at: timestamp,
    updated_at: timestamp,
  },
};
function poolWith(
  query: (statement: string, values?: unknown[]) => Promise<unknown>,
): PostgresPool {
  return {
    query,
    connect: vi.fn(),
    end: vi.fn(async () => undefined),
    on: vi.fn(),
  };
}
describe("unified inbox postgres repository", () => {
  it("hydrates one bounded statement, preserves source fields and encodes full timestamp precision", async () => {
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({
      rows: [native, historical],
    }));
    const repository = createUnifiedInboxPostgresRepository(poolWith(query));
    const page = await repository.list(actor, { limit: 1, contactState: "ALL" });
    expect(query).toHaveBeenCalledTimes(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      source: "QUANTUM",
      conversation: { version: 9007199254740993n, status: "OPEN" },
    });
    const cursor = JSON.parse(
      Buffer.from(page.nextCursor!, "base64url").toString("utf8"),
    ) as unknown;
    expect(cursor).toEqual({ v: 1, at: timestamp, source: 1, id: native.id });
    expect(query.mock.calls[0]?.[1]).toEqual([2]);
    await repository.list(actor, { limit: 1, contactState: "ALL", cursor: page.nextCursor! });
    expect(query.mock.calls[1]?.[1]).toEqual([timestamp, 1, native.id, 2]);
    expect(query.mock.calls[1]?.[0]).toContain(
      ", 1, conversation.id) < ($1::timestamptz, $2::integer, $3::uuid)",
    );
    expect(query.mock.calls[1]?.[0]).toContain(
      ", 0, thread.id) < ($1::timestamptz, $2::integer, $3::uuid)",
    );
  });
  it.each(["OWN", "TEAM"] as const)(
    "applies separate %s scope predicates before global pagination",
    async (scope) => {
      const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [] }));
      await createUnifiedInboxPostgresRepository(poolWith(query)).list(
        { ...actor, scope },
        { limit: 30, contactState: "ALL" },
      );
      const statement = query.mock.calls[0]?.[0] ?? "";
      expect(query.mock.calls[0]?.[1]).toEqual([actor.memberId, actor.memberId, 31]);
      expect(statement).toContain(
        "thread.contact_id IS NOT NULL AND thread.source_thread_present = TRUE",
      );
      expect(statement).toContain("UNION ALL");
      expect(statement).toContain("ORDER BY activity_at DESC, source_rank DESC, id DESC LIMIT $3");
      expect(statement).not.toContain("contacts.");
      if (scope === "TEAM") {
        expect(statement).toContain("record_team.member_id = conversation.assignee_member_id");
        expect(statement).toContain("record_team.member_id = thread.assignee_member_id");
      } else {
        expect(statement).toContain("conversation.assignee_member_id = $1::uuid");
        expect(statement).toContain("thread.assignee_member_id = $2::uuid");
      }
    },
  );
  it("searches both message stores with escaped values and does not reinterpret unknown statuses", async () => {
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({
      rows: [historical],
    }));
    const page = await createUnifiedInboxPostgresRepository(poolWith(query)).list(actor, {
      limit: 30,
      contactState: "LINKED",
      query: "100%_",
      channel: "SMS",
      status: "OPEN",
      unassigned: false,
    });
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toMatchObject({ source: "GHL", conversation: { rawStatus: "unread" } });
    const statement = query.mock.calls[0]?.[0] ?? "";
    expect(statement).toContain("FROM conversations.messages searched");
    expect(statement).toContain("FROM conversations.historical_messages searched");
    expect(statement).toContain("upper(btrim(thread.raw_status))");
    expect(statement).not.toContain("100%_");
    expect(statement).not.toContain("assignee_member_id IS NULL");
    expect(query.mock.calls[0]?.[1]).toEqual([
      "%100\\%\\_%",
      "sms",
      ["SMS", "MMS"],
      "open",
      "OPEN",
      31,
    ]);
  });
  it("excludes native conversations for historical-only channels while retaining access predicates", async () => {
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [] }));
    await createUnifiedInboxPostgresRepository(poolWith(query)).list(
      { ...actor, scope: "OWN" },
      { limit: 30, contactState: "ALL", channel: "FACEBOOK" },
    );
    const statement = query.mock.calls[0]?.[0] ?? "";
    expect(statement).toContain("conversation.assignee_member_id = $1::uuid AND FALSE");
    expect(statement).toContain("thread.assignee_member_id = $2::uuid");
    expect(statement).toContain("regexp_replace(upper(btrim(COALESCE(NULLIF(thread.raw_channel");
    expect(query.mock.calls[0]?.[1]).toEqual([
      actor.memberId,
      actor.memberId,
      ["FB", "FACEBOOK", "MESSENGER", "FACEBOOK_MESSENGER"],
      31,
    ]);
  });
  it("filters native and imported chats by the same advisor without bypassing the actor scope", async () => {
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [] }));
    await createUnifiedInboxPostgresRepository(poolWith(query)).list(
      { ...actor, scope: "OWN" },
      { limit: 30, contactState: "ALL", assigneeMemberId: native.quantum.assignee_member_id },
    );
    const statement = query.mock.calls[0]?.[0] ?? "";
    expect(statement).toContain("conversation.assignee_member_id = $1::uuid");
    expect(statement).toContain("thread.assignee_member_id = $2::uuid");
    expect(statement).toContain("conversation.assignee_member_id = $3::uuid");
    expect(statement).toContain("thread.assignee_member_id = $3::uuid");
    expect(query.mock.calls[0]?.[1]).toEqual([
      actor.memberId,
      actor.memberId,
      native.quantum.assignee_member_id,
      31,
    ]);
  });
  it("includes missing and unrecognized historical channels in UNKNOWN without interpolating aliases", async () => {
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [] }));
    await createUnifiedInboxPostgresRepository(poolWith(query)).list(actor, {
      limit: 30,
      contactState: "ALL",
      channel: "UNKNOWN",
    });
    const statement = query.mock.calls[0]?.[0] ?? "";
    expect(statement).toContain("AND FALSE");
    expect(statement).toContain("NOT COALESCE(regexp_replace");
    expect(statement).toContain("= ANY($1::text[]), FALSE)");
    expect(statement).not.toContain("INSTAGRAM");
    expect(query.mock.calls[0]?.[1]?.[0]).toEqual(
      expect.arrayContaining(["INSTAGRAM", "TIKTOK", "GMB", "PHONE_CALL", "FORM_SUBMISSION"]),
    );
  });
  it("rejects malformed cursors before SQL and returns safe failures", async () => {
    const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [] }));
    const repository = createUnifiedInboxPostgresRepository(poolWith(query));
    for (const invalid of [
      "bad",
      Buffer.from(JSON.stringify({ v: 1, at: timestamp, source: 2, id: native.id })).toString(
        "base64url",
      ),
    ])
      await expect(
        repository.list(actor, { limit: 30, contactState: "ALL", cursor: invalid }),
      ).rejects.toBeInstanceOf(ConversationValidationError);
    expect(query).not.toHaveBeenCalled();
    const failing = createUnifiedInboxPostgresRepository(
      poolWith(async () => {
        throw new Error("private database detail");
      }),
    );
    await expect(failing.list(actor, { limit: 30, contactState: "ALL" })).rejects.toBeInstanceOf(
      DatabaseUnavailableError,
    );
  });
});
