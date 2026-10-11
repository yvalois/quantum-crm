import { Buffer } from "node:buffer";
import {
  HistoricalImportValidationError,
  type CommercialActor,
  type HistoricalConversationRepository,
  type HistoricalConversationImportVerification,
  type HistoricalMessageRecord,
  type HistoricalThreadRecord,
} from "@quantum-crm/domain";
import { withHistoricalImport } from "./historical-import-transaction.js";
import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

interface ThreadRow {
  readonly id: string;
  readonly source_system: "GHL";
  readonly source_external_id: string;
  readonly source_thread_present: boolean;
  readonly contact_id: string | null;
  readonly assignee_member_id: string | null;
  readonly raw_channel: string | null;
  readonly raw_status: string | null;
  readonly subject: string | null;
  readonly source_created_at: Date | string | null;
  readonly source_updated_at: Date | string | null;
  readonly message_count: number;
  readonly last_message_at: Date | string | null;
  readonly imported_at: Date | string;
}
interface MessageRow {
  readonly id: string;
  readonly thread_id: string;
  readonly source_external_id: string;
  readonly raw_channel: string | null;
  readonly raw_type: string | null;
  readonly raw_direction: string | null;
  readonly raw_status: string | null;
  readonly body: string;
  readonly attachment_count: number;
  readonly source_created_at: Date | string | null;
  readonly source_updated_at: Date | string | null;
  readonly imported_at: Date | string;
}
const threadSelection = `thread.id::text, thread.source_system, thread.source_external_id,
  thread.source_thread_present, thread.contact_id::text, thread.assignee_member_id::text,
  thread.raw_channel, thread.raw_status, thread.subject, thread.source_created_at,
  thread.source_updated_at, thread.message_count, thread.last_message_at, thread.imported_at`;
const messageSelection = `message.id::text, message.thread_id::text, message.source_external_id,
  message.raw_channel, message.raw_type, message.raw_direction, message.raw_status,
  message.body, message.attachment_count, message.source_created_at,
  message.source_updated_at, message.imported_at`;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function date(value: Date | string | null): Date | null { return value === null ? null : new Date(value); }
function thread(row: ThreadRow): HistoricalThreadRecord {
  return Object.freeze({
    id: row.id, source: row.source_system, sourceExternalId: row.source_external_id,
    sourceThreadPresent: row.source_thread_present, contactId: row.contact_id,
    assigneeMemberId: row.assignee_member_id, rawChannel: row.raw_channel,
    rawStatus: row.raw_status, subject: row.subject,
    sourceCreatedAt: date(row.source_created_at), sourceUpdatedAt: date(row.source_updated_at),
    messageCount: row.message_count, lastMessageAt: date(row.last_message_at),
    importedAt: new Date(row.imported_at),
  });
}
function message(row: MessageRow): HistoricalMessageRecord {
  return Object.freeze({
    id: row.id, threadId: row.thread_id, sourceExternalId: row.source_external_id,
    rawChannel: row.raw_channel, rawType: row.raw_type, rawDirection: row.raw_direction,
    rawStatus: row.raw_status, body: row.body, attachmentCount: row.attachment_count,
    sourceCreatedAt: date(row.source_created_at), sourceUpdatedAt: date(row.source_updated_at),
    importedAt: new Date(row.imported_at),
  });
}
function access(actor: CommercialActor, placeholder: number): { sql: string; params: string[] } {
  if (actor.scope === "PROFILE") return { sql: "TRUE", params: [] };
  const related = "thread.contact_id IS NOT NULL AND thread.source_thread_present = TRUE";
  if (actor.scope === "TEAM") return {
    sql: `${related} AND EXISTS (SELECT 1 FROM iam.team_members viewer_team
      JOIN iam.team_members record_team ON record_team.team_id = viewer_team.team_id
      WHERE viewer_team.member_id = $${placeholder}::uuid AND record_team.member_id = thread.assignee_member_id)`,
    params: [actor.memberId],
  };
  return { sql: `${related} AND thread.assignee_member_id = $${placeholder}::uuid`, params: [actor.memberId] };
}
function encode(value: unknown): string { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function decode(value: string): { id: string; at: Date | null } {
  try {
    const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { id?: unknown; at?: unknown };
    if (typeof data.id !== "string" || !uuidPattern.test(data.id) || (data.at !== null && typeof data.at !== "string"))
      throw new Error();
    const at = data.at === null ? null : new Date(data.at);
    if (at !== null && !Number.isFinite(at.getTime())) throw new Error();
    return { id: data.id, at };
  } catch { throw new HistoricalImportValidationError(); }
}
function fail(error: unknown): never {
  if (error instanceof HistoricalImportValidationError) throw error;
  throw new DatabaseUnavailableError();
}

export function createHistoricalConversationPostgresRepository(pool: PostgresPool): HistoricalConversationRepository {
  return Object.freeze<HistoricalConversationRepository>({
    verifyImports: async (locationId) => {
      try {
        const result = await pool.query(`WITH threads AS (
          SELECT * FROM conversations.historical_threads WHERE source_system = 'GHL' AND source_location_id = $1
        ), messages AS (
          SELECT * FROM conversations.historical_messages WHERE source_system = 'GHL' AND source_location_id = $1
        ) SELECT
          (SELECT count(*)::int FROM threads) AS "threadCount",
          (SELECT count(*)::int FROM messages) AS "messageCount",
          (SELECT count(*)::int FROM threads item JOIN conversations.historical_imports mapping
            ON mapping.entity_type = 'thread' AND mapping.entity_id = item.id AND mapping.external_id = item.source_external_id
            AND mapping.source_system = item.source_system AND mapping.source_location_id = item.source_location_id) AS "mappedThreadCount",
          (SELECT count(*)::int FROM messages item JOIN conversations.historical_imports mapping
            ON mapping.entity_type = 'message' AND mapping.entity_id = item.id AND mapping.external_id = item.source_external_id
            AND mapping.source_system = item.source_system AND mapping.source_location_id = item.source_location_id) AS "mappedMessageCount",
          (SELECT count(*)::int FROM threads WHERE source_thread_present = FALSE) AS "unresolvedThreadCount",
          (SELECT count(*)::int FROM threads WHERE contact_id IS NULL) AS "unresolvedContactThreadCount",
          (SELECT count(*)::int FROM threads item WHERE item.message_count <>
            (SELECT count(*) FROM conversations.historical_messages message WHERE message.thread_id = item.id)) AS "inconsistentMessageCount",
          (SELECT count(*)::int FROM messages item LEFT JOIN conversations.historical_threads parent ON parent.id = item.thread_id
            WHERE parent.id IS NULL OR parent.source_system <> item.source_system OR parent.source_location_id <> item.source_location_id) AS "invalidParentCount"`, [locationId]) as { rows: HistoricalConversationImportVerification[] };
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        return Object.freeze(row);
      } catch (error) { return fail(error); }
    },
    importThread: (input) => withHistoricalImport(pool, "conversations", "thread", input, async (client) => {
      const value = input.thread;
      const result = await client.query<{ id: string }>(
        `INSERT INTO conversations.historical_threads
         (source_system, source_location_id, source_external_id, source_thread_present,
          contact_id, source_contact_id, assignee_member_id, raw_channel, raw_status,
          subject, source_created_at, source_updated_at)
         VALUES ($1, $2, $3, $4, $5::uuid, $6, $7::uuid, $8, $9, $10, $11, $12) RETURNING id::text`,
        [input.source.system, input.source.locationId, input.source.externalId,
          value.sourceThreadPresent, value.contactId, value.sourceContactId,
          value.assigneeMemberId, value.rawChannel, value.rawStatus, value.subject,
          value.sourceCreatedAt, value.sourceUpdatedAt],
      );
      const row = result.rows[0];
      if (!row) throw new DatabaseUnavailableError();
      return row;
    }),
    importMessage: (input) => withHistoricalImport(pool, "conversations", "message", input, async (client) => {
      const parent = await client.query<{ id: string }>(
        `SELECT id::text FROM conversations.historical_threads
         WHERE source_system = $1 AND source_location_id = $2 AND source_external_id = $3`,
        [input.source.system, input.source.locationId, input.threadSourceExternalId],
      );
      const parentId = parent.rows[0]?.id;
      if (!parentId) throw new HistoricalImportValidationError();
      const value = input.message;
      const result = await client.query<{ id: string }>(
        `INSERT INTO conversations.historical_messages
         (thread_id, source_system, source_location_id, source_external_id, source_contact_id,
          raw_channel, raw_type, raw_direction, raw_status, body, attachment_count,
          source_created_at, source_updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id::text`,
        [parentId, input.source.system, input.source.locationId, input.source.externalId,
          value.sourceContactId, value.rawChannel, value.rawType, value.rawDirection,
          value.rawStatus, value.body, value.attachmentCount, value.sourceCreatedAt, value.sourceUpdatedAt],
      );
      const row = result.rows[0];
      if (!row) throw new DatabaseUnavailableError();
      await client.query(`UPDATE conversations.historical_threads SET message_count = message_count + 1,
        last_message_at = GREATEST(last_message_at, $2::timestamptz) WHERE id = $1::uuid`, [parentId, value.sourceCreatedAt]);
      return row;
    }),
    list: async (actor, query) => {
      try {
        const visible = access(actor, 1);
        const params: unknown[] = [...visible.params];
        const conditions = [visible.sql];
        const bind = (value: unknown): string => { params.push(value); return `$${params.length}`; };
        if (query.contactId) conditions.push(`thread.contact_id = ${bind(query.contactId)}::uuid`);
        if (query.query) {
          const search = bind(`%${query.query.replace(/[\\%_]/gu, "\\$&")}%`);
          conditions.push(`(thread.subject ILIKE ${search} OR thread.source_external_id ILIKE ${search}
            OR EXISTS (SELECT 1 FROM conversations.historical_messages searched WHERE searched.thread_id = thread.id AND searched.body ILIKE ${search}))`);
        }
        if (query.cursor) conditions.push(`thread.id < ${bind(decode(query.cursor).id)}::uuid`);
        const result = await pool.query(`SELECT ${threadSelection} FROM conversations.historical_threads thread
          WHERE ${conditions.join(" AND ")} ORDER BY thread.id DESC LIMIT ${bind(query.limit + 1)}`, params) as { rows: ThreadRow[] };
        const rows = result.rows.slice(0, query.limit);
        const last = rows.at(-1);
        return Object.freeze({ items: Object.freeze(rows.map(thread)), nextCursor: result.rows.length > query.limit && last ? encode({ id: last.id, at: null }) : null });
      } catch (error) { return fail(error); }
    },
    find: async (actor, id) => {
      try {
        const visible = access(actor, 2);
        const result = await pool.query(`SELECT ${threadSelection} FROM conversations.historical_threads thread
          WHERE thread.id = $1::uuid AND ${visible.sql}`, [id, ...visible.params]) as { rows: ThreadRow[] };
        return result.rows[0] ? thread(result.rows[0]) : null;
      } catch (error) { return fail(error); }
    },
    messages: async (actor, id, query) => {
      try {
        const visible = access(actor, 2);
        const parent = await pool.query(`SELECT thread.id FROM conversations.historical_threads thread
          WHERE thread.id = $1::uuid AND ${visible.sql}`, [id, ...visible.params]) as { rows: { id: string }[] };
        if (!parent.rows[0]) return null;
        const params: unknown[] = [id];
        let after = "";
        if (query.cursor) {
          const position = decode(query.cursor);
          params.push(position.at, position.id);
          after = "AND (COALESCE(message.source_created_at, 'infinity'::timestamptz), message.id) > (COALESCE($2::timestamptz, 'infinity'::timestamptz), $3::uuid)";
        }
        params.push(query.limit + 1);
        const result = await pool.query(`SELECT ${messageSelection} FROM conversations.historical_messages message
          JOIN conversations.historical_threads thread ON thread.id = message.thread_id
          WHERE message.thread_id = $1::uuid ${after}
          ORDER BY COALESCE(message.source_created_at, 'infinity'::timestamptz), message.id
          LIMIT $${params.length}`, params) as { rows: MessageRow[] };
        const rows = result.rows.slice(0, query.limit);
        const last = rows.at(-1);
        return Object.freeze({ items: Object.freeze(rows.map(message)), nextCursor: result.rows.length > query.limit && last ? encode({ id: last.id, at: date(last.source_created_at)?.toISOString() ?? null }) : null });
      } catch (error) { return fail(error); }
    },
  });
}
