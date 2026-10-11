import { Buffer } from "node:buffer";
import {
  HistoricalImportValidationError,
  HistoricalAttachmentConflictError,
  HistoricalConversationNotFoundError,
  sourceParticipantReferencesFromRow,
  type HistoricalAttachmentRecord,
  type HistoricalAttachmentVerification,
  type CommercialActor,
  type HistoricalConversationRepository,
  type HistoricalConversationImportVerification,
  type HistoricalMessageRecord,
  type HistoricalThreadRecord,
} from "@quantum-crm/domain";
import type { PoolClient } from "pg";
import { withHistoricalImport } from "./historical-import-transaction.js";
import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

export interface ThreadRow {
  readonly id: string;
  readonly source_participant_references?: unknown;
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
  readonly attachments?: HistoricalAttachmentRecord[];
}
interface AttachmentRow {
  readonly id: string;
  readonly message_id: string;
  readonly attachment_index: number;
  readonly source_hash: string;
  readonly file_id: string | null;
  readonly status: HistoricalAttachmentRecord["status"];
  readonly error_code: HistoricalAttachmentRecord["errorCode"];
  readonly display_name: string | null;
  readonly mime_type: string | null;
  readonly byte_size: number | string | null;
}
const attachmentSelection = `attachment.id::text, attachment.message_id::text,
  attachment.attachment_index, attachment.source_hash, attachment.file_id::text,
  attachment.status, attachment.error_code, attachment.display_name,
  attachment.mime_type, attachment.byte_size`;
function attachment(row: AttachmentRow): HistoricalAttachmentRecord {
  return Object.freeze({
    id: row.id,
    messageId: row.message_id,
    attachmentIndex: row.attachment_index,
    sourceHash: row.source_hash,
    fileId: row.file_id,
    status: row.status,
    errorCode: row.error_code,
    name: row.display_name,
    mimeType: row.mime_type,
    size: row.byte_size === null ? null : Number(row.byte_size),
  });
}
export const historicalThreadChannelSelection = `COALESCE(NULLIF(thread.raw_channel, ''), (
    SELECT COALESCE(NULLIF(channel_message.raw_channel, ''), NULLIF(channel_message.raw_type, ''))
    FROM conversations.historical_messages channel_message
    WHERE channel_message.thread_id = thread.id
      AND COALESCE(NULLIF(channel_message.raw_channel, ''), NULLIF(channel_message.raw_type, '')) IS NOT NULL
    ORDER BY channel_message.source_created_at DESC NULLS LAST, channel_message.id DESC LIMIT 1
  ))`;
export const threadSelection = `thread.id::text, thread.source_system, thread.source_external_id,
  thread.source_thread_present, thread.contact_id::text, thread.assignee_member_id::text,
  ${historicalThreadChannelSelection} AS raw_channel, thread.raw_status, thread.subject, thread.source_created_at,
  thread.source_updated_at, thread.message_count, thread.last_message_at, thread.imported_at,
  (SELECT jsonb_build_object('locationId', source_map.source_location_id,
    'ownerExternalId', NULLIF(source_map.source_payload->>'assignedTo', ''),
      'followerExternalIds', COALESCE(NULLIF(source_map.source_payload->'followers', 'null'::jsonb), '[]'::jsonb))
    FROM conversations.historical_imports source_map WHERE source_map.entity_type = 'thread'
      AND source_map.source_system = thread.source_system
      AND source_map.source_location_id = thread.source_location_id
      AND source_map.external_id = thread.source_external_id) AS source_participant_references`;
const messageSelection = `message.id::text, message.thread_id::text, message.source_external_id,
  message.raw_channel, message.raw_type, message.raw_direction, message.raw_status,
  message.body, message.attachment_count, message.source_created_at,
  message.source_updated_at, message.imported_at,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', attachment.id, 'messageId', attachment.message_id, 'attachmentIndex', attachment.attachment_index,
    'sourceHash', attachment.source_hash, 'fileId', attachment.file_id, 'status', attachment.status,
    'errorCode', attachment.error_code, 'name', attachment.display_name,
    'mimeType', attachment.mime_type, 'size', attachment.byte_size) ORDER BY attachment.attachment_index)
    FROM conversations.historical_attachments attachment WHERE attachment.message_id = message.id), '[]'::jsonb) AS attachments`;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function date(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}
export function historicalThreadFromRow(row: ThreadRow): HistoricalThreadRecord {
  return Object.freeze({
    id: row.id,
    source: row.source_system,
    sourceExternalId: row.source_external_id,
    sourceThreadPresent: row.source_thread_present,
    contactId: row.contact_id,
    assigneeMemberId: row.assignee_member_id,
    ...sourceParticipantReferencesFromRow(row.source_participant_references),
    rawChannel: row.raw_channel,
    rawStatus: row.raw_status,
    subject: row.subject,
    sourceCreatedAt: date(row.source_created_at),
    sourceUpdatedAt: date(row.source_updated_at),
    messageCount: row.message_count,
    lastMessageAt: date(row.last_message_at),
    importedAt: new Date(row.imported_at),
  });
}
const thread = historicalThreadFromRow;
function message(row: MessageRow): HistoricalMessageRecord {
  return Object.freeze({
    id: row.id,
    threadId: row.thread_id,
    sourceExternalId: row.source_external_id,
    rawChannel: row.raw_channel,
    rawType: row.raw_type,
    rawDirection: row.raw_direction,
    rawStatus: row.raw_status,
    body: row.body,
    attachmentCount: row.attachment_count,
    attachments: Object.freeze(row.attachments ?? []),
    sourceCreatedAt: date(row.source_created_at),
    sourceUpdatedAt: date(row.source_updated_at),
    importedAt: new Date(row.imported_at),
  });
}
export function historicalConversationAccess(actor: CommercialActor, placeholder: number): { sql: string; params: string[] } {
  if (actor.scope === "PROFILE") return { sql: "TRUE", params: [] };
  const related = "thread.contact_id IS NOT NULL AND thread.source_thread_present = TRUE";
  if (actor.scope === "TEAM")
    return {
      sql: `${related} AND EXISTS (SELECT 1 FROM iam.team_members viewer_team
      JOIN iam.team_members record_team ON record_team.team_id = viewer_team.team_id
      WHERE viewer_team.member_id = $${placeholder}::uuid AND record_team.member_id = thread.assignee_member_id)`,
      params: [actor.memberId],
    };
  return {
    sql: `${related} AND thread.assignee_member_id = $${placeholder}::uuid`,
    params: [actor.memberId],
  };
}
const access = historicalConversationAccess;
function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function decode(value: string): { id: string; at: Date | null } {
  try {
    const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      id?: unknown;
      at?: unknown;
    };
    if (
      typeof data.id !== "string" ||
      !uuidPattern.test(data.id) ||
      (data.at !== null && typeof data.at !== "string")
    )
      throw new Error();
    const at = data.at === null ? null : new Date(data.at);
    if (at !== null && !Number.isFinite(at.getTime())) throw new Error();
    return { id: data.id, at };
  } catch {
    throw new HistoricalImportValidationError();
  }
}
function fail(error: unknown): never {
  if (
    error instanceof HistoricalImportValidationError ||
    error instanceof HistoricalAttachmentConflictError ||
    error instanceof HistoricalConversationNotFoundError
  )
    throw error;
  throw new DatabaseUnavailableError();
}

async function attachmentTransaction<T>(
  pool: PostgresPool,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return fail(error);
  } finally {
    client.release();
  }
}

async function auditAttachment(
  client: PoolClient,
  row: AttachmentRow,
  actorMemberId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO conversations.historical_attachment_events
    (attachment_id, actor_member_id, status, file_id, error_code)
    VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5)`,
    [row.id, actorMemberId, row.status, row.file_id, row.error_code],
  );
}

export function createHistoricalConversationPostgresRepository(
  pool: PostgresPool,
): HistoricalConversationRepository {
  return Object.freeze<HistoricalConversationRepository>({
    reserveAttachment: (context, input) =>
      attachmentTransaction(pool, async (client) => {
        const parent = await client.query<{ id: string; attachment_count: number }>(
          `SELECT id::text, attachment_count FROM conversations.historical_messages
         WHERE source_system = 'GHL' AND source_location_id = $1 AND source_external_id = $2`,
          [input.locationId, input.externalMessageId],
        );
        const message = parent.rows[0];
        if (!message) throw new HistoricalConversationNotFoundError();
        if (input.attachmentIndex >= message.attachment_count)
          throw new HistoricalImportValidationError();
        const inserted = await client.query<AttachmentRow>(
          `INSERT INTO conversations.historical_attachments AS attachment
         (message_id, attachment_index, source_hash, created_by_member_id)
         VALUES ($1::uuid, $2, $3, $4::uuid)
         ON CONFLICT (message_id, attachment_index) DO NOTHING RETURNING ${attachmentSelection}`,
          [message.id, input.attachmentIndex, input.sourceHash, context.actor.memberId],
        );
        const row =
          inserted.rows[0] ??
          (
            await client.query<AttachmentRow>(
              `SELECT ${attachmentSelection} FROM conversations.historical_attachments attachment
         WHERE attachment.message_id = $1::uuid AND attachment.attachment_index = $2`,
              [message.id, input.attachmentIndex],
            )
          ).rows[0];
        if (!row) throw new DatabaseUnavailableError();
        if (row.source_hash !== input.sourceHash) throw new HistoricalAttachmentConflictError();
        if (inserted.rows[0]) await auditAttachment(client, row, context.actor.memberId);
        return attachment(row);
      }),
    findAttachment: async (actor, id) => {
      try {
        const visible = access(actor, 2);
        const result = (await pool.query(
          `SELECT ${attachmentSelection} FROM conversations.historical_attachments attachment
           JOIN conversations.historical_messages message ON message.id = attachment.message_id
           JOIN conversations.historical_threads thread ON thread.id = message.thread_id
           WHERE attachment.id = $1::uuid AND ${visible.sql}`,
          [id, ...visible.params],
        )) as { rows: AttachmentRow[] };
        return result.rows[0] ? attachment(result.rows[0]) : null;
      } catch (error) {
        return fail(error);
      }
    },
    setAttachmentResult: (context, input) =>
      attachmentTransaction(pool, async (client) => {
        const found = await client.query<AttachmentRow>(
          `SELECT ${attachmentSelection} FROM conversations.historical_attachments attachment
         WHERE attachment.id = $1::uuid FOR UPDATE`,
          [input.attachmentId],
        );
        const current = found.rows[0];
        if (!current) throw new HistoricalConversationNotFoundError();
        if (current.file_id !== null && input.fileId !== current.file_id)
          throw new HistoricalAttachmentConflictError();
        if (
          current.status === "AVAILABLE" ||
          (current.status === input.status &&
            current.file_id === input.fileId &&
            current.error_code === input.errorCode)
        )
          return attachment(current);
        const saved = await client.query<AttachmentRow>(
          `UPDATE conversations.historical_attachments attachment SET file_id = $2::uuid, status = $3,
         error_code = $4, display_name = $5, mime_type = $6, byte_size = $7, updated_at = CURRENT_TIMESTAMP
         WHERE attachment.id = $1::uuid RETURNING ${attachmentSelection}`,
          [
            input.attachmentId,
            input.fileId,
            input.status,
            input.errorCode,
            input.name,
            input.mimeType,
            input.size,
          ],
        );
        const row = saved.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await auditAttachment(client, row, context.actor.memberId);
        return attachment(row);
      }),
    verifyAttachments: async (locationId) => {
      try {
        const result = (await pool.query(
          `WITH messages AS (
          SELECT id, attachment_count FROM conversations.historical_messages
          WHERE source_system = 'GHL' AND source_location_id = $1
        ), attachments AS (
          SELECT attachment.* FROM conversations.historical_attachments attachment
          JOIN messages ON messages.id = attachment.message_id
        ) SELECT
          COALESCE((SELECT sum(attachment_count)::int FROM messages), 0) AS "expectedCount",
          count(*)::int AS "reservedCount",
          count(*) FILTER (WHERE status = 'AVAILABLE')::int AS "availableCount",
          count(*) FILTER (WHERE status = 'PENDING')::int AS "pendingCount",
          count(*) FILTER (WHERE status = 'REJECTED')::int AS "rejectedCount",
          count(*) FILTER (WHERE status = 'FAILED')::int AS "failedCount",
          COALESCE(sum(byte_size), 0)::float8 AS "totalBytes",
          COALESCE((SELECT sum(attachment_count)::int FROM messages), 0) - count(*)::int AS "missingCount"
          FROM attachments`,
          [locationId],
        )) as { rows: HistoricalAttachmentVerification[] };
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        return Object.freeze(row);
      } catch (error) {
        return fail(error);
      }
    },
    verifyImports: async (locationId) => {
      try {
        const result = (await pool.query(
          `WITH threads AS (
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
            WHERE parent.id IS NULL OR parent.source_system <> item.source_system OR parent.source_location_id <> item.source_location_id) AS "invalidParentCount",
          (SELECT count(*)::int FROM conversations.outbox effect JOIN messages item ON item.id = effect.message_id) AS "outboxCount"`,
          [locationId],
        )) as { rows: HistoricalConversationImportVerification[] };
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        return Object.freeze(row);
      } catch (error) {
        return fail(error);
      }
    },
    importThread: (input) =>
      withHistoricalImport(pool, "conversations", "thread", input, async (client) => {
        const value = input.thread;
        const result = await client.query<{ id: string }>(
          `INSERT INTO conversations.historical_threads
         (source_system, source_location_id, source_external_id, source_thread_present,
          contact_id, source_contact_id, assignee_member_id, raw_channel, raw_status,
          subject, source_created_at, source_updated_at)
         VALUES ($1, $2, $3, $4, $5::uuid, $6, $7::uuid, $8, $9, $10, $11, $12) RETURNING id::text`,
          [
            input.source.system,
            input.source.locationId,
            input.source.externalId,
            value.sourceThreadPresent,
            value.contactId,
            value.sourceContactId,
            value.assigneeMemberId,
            value.rawChannel,
            value.rawStatus,
            value.subject,
            value.sourceCreatedAt,
            value.sourceUpdatedAt,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        return row;
      }),
    importMessage: (input) =>
      withHistoricalImport(pool, "conversations", "message", input, async (client) => {
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
          [
            parentId,
            input.source.system,
            input.source.locationId,
            input.source.externalId,
            value.sourceContactId,
            value.rawChannel,
            value.rawType,
            value.rawDirection,
            value.rawStatus,
            value.body,
            value.attachmentCount,
            value.sourceCreatedAt,
            value.sourceUpdatedAt,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await client.query(
          `UPDATE conversations.historical_threads SET message_count = message_count + 1,
        last_message_at = GREATEST(last_message_at, $2::timestamptz) WHERE id = $1::uuid`,
          [parentId, value.sourceCreatedAt],
        );
        return row;
      }),
    list: async (actor, query) => {
      try {
        const visible = access(actor, 1);
        const params: unknown[] = [...visible.params];
        const conditions = [visible.sql];
        const bind = (value: unknown): string => {
          params.push(value);
          return `$${params.length}`;
        };
        if (query.contactId) conditions.push(`thread.contact_id = ${bind(query.contactId)}::uuid`);
        if (query.contactState === "LINKED") conditions.push("thread.contact_id IS NOT NULL");
        if (query.contactState === "UNLINKED") conditions.push("thread.contact_id IS NULL");
        if (query.query) {
          const search = bind(`%${query.query.replace(/[\\%_]/gu, "\\$&")}%`);
          conditions.push(`(thread.subject ILIKE ${search} OR thread.source_external_id ILIKE ${search}
            OR EXISTS (SELECT 1 FROM conversations.historical_messages searched WHERE searched.thread_id = thread.id AND searched.body ILIKE ${search}))`);
        }
        if (query.cursor) conditions.push(`thread.id < ${bind(decode(query.cursor).id)}::uuid`);
        const result = (await pool.query(
          `SELECT ${threadSelection} FROM conversations.historical_threads thread
          WHERE ${conditions.join(" AND ")} ORDER BY thread.id DESC LIMIT ${bind(query.limit + 1)}`,
          params,
        )) as { rows: ThreadRow[] };
        const rows = result.rows.slice(0, query.limit);
        const last = rows.at(-1);
        return Object.freeze({
          items: Object.freeze(rows.map(thread)),
          nextCursor:
            result.rows.length > query.limit && last ? encode({ id: last.id, at: null }) : null,
        });
      } catch (error) {
        return fail(error);
      }
    },
    find: async (actor, id) => {
      try {
        const visible = access(actor, 2);
        const result = (await pool.query(
          `SELECT ${threadSelection} FROM conversations.historical_threads thread
          WHERE thread.id = $1::uuid AND ${visible.sql}`,
          [id, ...visible.params],
        )) as { rows: ThreadRow[] };
        return result.rows[0] ? thread(result.rows[0]) : null;
      } catch (error) {
        return fail(error);
      }
    },
    messages: async (actor, id, query) => {
      try {
        const visible = access(actor, 2);
        const parent = (await pool.query(
          `SELECT thread.id FROM conversations.historical_threads thread
          WHERE thread.id = $1::uuid AND ${visible.sql}`,
          [id, ...visible.params],
        )) as { rows: { id: string }[] };
        if (!parent.rows[0]) return null;
        const params: unknown[] = [id];
        let after = "";
        if (query.cursor) {
          const position = decode(query.cursor);
          params.push(position.at, position.id);
          after =
            "AND (COALESCE(message.source_created_at, 'infinity'::timestamptz), message.id) > (COALESCE($2::timestamptz, 'infinity'::timestamptz), $3::uuid)";
        }
        params.push(query.limit + 1);
        const result = (await pool.query(
          `SELECT ${messageSelection} FROM conversations.historical_messages message
          JOIN conversations.historical_threads thread ON thread.id = message.thread_id
          WHERE message.thread_id = $1::uuid ${after}
          ORDER BY COALESCE(message.source_created_at, 'infinity'::timestamptz), message.id
          LIMIT $${params.length}`,
          params,
        )) as { rows: MessageRow[] };
        const rows = result.rows.slice(0, query.limit);
        const last = rows.at(-1);
        return Object.freeze({
          items: Object.freeze(rows.map(message)),
          nextCursor:
            result.rows.length > query.limit && last
              ? encode({ id: last.id, at: date(last.source_created_at)?.toISOString() ?? null })
              : null,
        });
      } catch (error) {
        return fail(error);
      }
    },
  });
}
