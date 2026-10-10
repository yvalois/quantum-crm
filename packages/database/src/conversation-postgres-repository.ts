import { Buffer } from "node:buffer";

import type {
  CommercialActor,
  ConversationHistoryRecord,
  ConversationMessageRecord,
  ConversationRecord,
  ConversationRepository,
  QuickReplyRecord,
} from "@quantum-crm/domain";
import type { PoolClient } from "pg";

import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

export class ConversationIdempotencyConflictError extends Error {
  public constructor() {
    super("Idempotency key was already used with a different request");
    this.name = "ConversationIdempotencyConflictError";
  }
}

interface ConversationRow {
  readonly id: string;
  readonly contact_id: string;
  readonly channel: string;
  readonly external_thread_id: string | null;
  readonly assignee_member_id: string | null;
  readonly status: string;
  readonly attention_mode: string;
  readonly subject: string | null;
  readonly last_message_preview: string | null;
  readonly last_message_at: Date | string | null;
  readonly unread_count: number;
  readonly version: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}
interface MessageRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly sequence: string;
  readonly direction: string;
  readonly kind: string;
  readonly author_member_id: string | null;
  readonly body: string;
  readonly external_message_id: string | null;
  readonly delivery_status: string;
  readonly failure_code: string | null;
  readonly document_id: string | null;
  readonly document_snapshot: ConversationMessageRecord["documentSnapshot"];
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}
interface HistoryRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly event_type: string;
  readonly actor_member_id: string;
  readonly previous_value: string | null;
  readonly next_value: string | null;
  readonly created_at: Date | string;
}
interface QuickReplyRow {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly created_by_member_id: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const conversationSelection = `conversation.id::text, conversation.contact_id::text,
  conversation.channel, conversation.external_thread_id, conversation.assignee_member_id::text,
  conversation.status, conversation.attention_mode, conversation.subject,
  conversation.last_message_preview, conversation.last_message_at, conversation.unread_count,
  conversation.version::text, conversation.created_at, conversation.updated_at`;
const messageSelection = `message.id::text, message.conversation_id::text, message.sequence::text,
  message.direction, message.kind, message.author_member_id::text, message.body,
  message.external_message_id, message.delivery_status, message.failure_code,
  message.document_id::text, message.document_snapshot,
  message.created_at, message.updated_at`;

function conversationFromRow(row: ConversationRow): ConversationRecord {
  return Object.freeze({
    id: row.id,
    contactId: row.contact_id,
    channel: row.channel.toUpperCase() as ConversationRecord["channel"],
    externalThreadId: row.external_thread_id,
    assigneeMemberId: row.assignee_member_id,
    status: row.status.toUpperCase() as ConversationRecord["status"],
    attentionMode: row.attention_mode.toUpperCase() as ConversationRecord["attentionMode"],
    subject: row.subject,
    lastMessagePreview: row.last_message_preview,
    lastMessageAt: row.last_message_at === null ? null : new Date(row.last_message_at),
    unreadCount: row.unread_count,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}
function messageFromRow(row: MessageRow): ConversationMessageRecord {
  return Object.freeze({
    id: row.id,
    conversationId: row.conversation_id,
    sequence: BigInt(row.sequence),
    direction: row.direction.toUpperCase() as ConversationMessageRecord["direction"],
    kind: row.kind.toUpperCase() as ConversationMessageRecord["kind"],
    authorMemberId: row.author_member_id,
    body: row.body,
    externalMessageId: row.external_message_id,
    deliveryStatus:
      row.delivery_status.toUpperCase() as ConversationMessageRecord["deliveryStatus"],
    failureCode: row.failure_code,
    documentId: row.document_id,
    documentSnapshot: row.document_snapshot,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}
function historyFromRow(row: HistoryRow): ConversationHistoryRecord {
  return Object.freeze({
    id: row.id,
    conversationId: row.conversation_id,
    eventType: row.event_type.toUpperCase() as ConversationHistoryRecord["eventType"],
    actorMemberId: row.actor_member_id,
    previousValue: row.previous_value,
    nextValue: row.next_value,
    createdAt: new Date(row.created_at),
  });
}
function replyFromRow(row: QuickReplyRow): QuickReplyRecord {
  return Object.freeze({
    id: row.id,
    title: row.title,
    body: row.body,
    createdByMemberId: row.created_by_member_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}
function access(actor: CommercialActor, placeholder: number): { sql: string; params: string[] } {
  if (actor.scope === "PROFILE") return { sql: "TRUE", params: [] };
  if (actor.scope === "TEAM")
    return {
      sql: `EXISTS (
        SELECT 1 FROM iam.team_members viewer_team
        JOIN iam.team_members record_team ON record_team.team_id = viewer_team.team_id
        WHERE viewer_team.member_id = $${placeholder}::uuid
          AND record_team.member_id = conversation.assignee_member_id
      )`,
      params: [actor.memberId],
    };
  return {
    sql: `conversation.assignee_member_id = $${placeholder}::uuid`,
    params: [actor.memberId],
  };
}
function cursor(value: string): { at: Date; id: string } {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      at?: unknown;
      id?: unknown;
    };
    if (typeof decoded.at !== "string" || typeof decoded.id !== "string") throw new Error();
    const at = new Date(decoded.at);
    if (Number.isNaN(at.getTime())) throw new Error();
    return { at, id: decoded.id };
  } catch {
    throw new DatabaseUnavailableError();
  }
}
function nextCursor(row: ConversationRow | undefined): string | null {
  if (!row) return null;
  return Buffer.from(
    JSON.stringify({
      at: new Date(row.last_message_at ?? row.created_at).toISOString(),
      id: row.id,
    }),
  ).toString("base64url");
}
function fail(error: unknown): never {
  if (error instanceof ConversationIdempotencyConflictError) throw error;
  throw new DatabaseUnavailableError();
}
async function lock(
  client: PoolClient,
  actorMemberId: string,
  command: string,
  idempotencyKey: string,
): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${actorMemberId}:${command}:${idempotencyKey}`,
  ]);
}
async function replay<T>(
  client: PoolClient,
  actorMemberId: string,
  command: string,
  idempotencyKey: string,
  payloadHash: string,
): Promise<T | null> {
  const result = await client.query<{ payload_hash: string; response: T }>(
    `SELECT payload_hash, response FROM conversations.command_idempotency
     WHERE actor_member_id = $1::uuid AND command = $2 AND idempotency_key = $3 FOR UPDATE`,
    [actorMemberId, command, idempotencyKey],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.payload_hash !== payloadHash) throw new ConversationIdempotencyConflictError();
  return row.response;
}
async function remember(
  client: PoolClient,
  actorMemberId: string,
  command: string,
  idempotencyKey: string,
  payloadHash: string,
  response: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO conversations.command_idempotency
       (actor_member_id, command, idempotency_key, payload_hash, response)
     VALUES ($1::uuid, $2, $3, $4, $5::jsonb)`,
    [actorMemberId, command, idempotencyKey, payloadHash, JSON.stringify(response)],
  );
}

export function createConversationPostgresRepository(pool: PostgresPool): ConversationRepository {
  return Object.freeze<ConversationRepository>({
    list: async (actor, filters) => {
      try {
        const visible = access(actor, 1);
        const params: unknown[] = [...visible.params];
        const conditions = [visible.sql];
        const parameter = (value: unknown): string => {
          params.push(value);
          return `$${params.length}`;
        };
        if (filters.contactId)
          conditions.push(`conversation.contact_id = ${parameter(filters.contactId)}::uuid`);
        if (filters.query) {
          const query = parameter(`%${filters.query}%`);
          conditions.push(
            `(conversation.subject ILIKE ${query} OR conversation.last_message_preview ILIKE ${query})`,
          );
        }
        if (filters.channel)
          conditions.push(`conversation.channel = ${parameter(filters.channel.toLowerCase())}`);
        if (filters.status)
          conditions.push(`conversation.status = ${parameter(filters.status.toLowerCase())}`);
        if (filters.attentionMode)
          conditions.push(
            `conversation.attention_mode = ${parameter(filters.attentionMode.toLowerCase())}`,
          );
        if (filters.assigneeMemberId)
          conditions.push(
            `conversation.assignee_member_id = ${parameter(filters.assigneeMemberId)}::uuid`,
          );
        if (filters.unassigned === true) conditions.push("conversation.assignee_member_id IS NULL");
        if (filters.cursor) {
          const position = cursor(filters.cursor);
          const at = parameter(position.at);
          const id = parameter(position.id);
          conditions.push(`(COALESCE(conversation.last_message_at, conversation.created_at), conversation.id)
            < (${at}::timestamptz, ${id}::uuid)`);
        }
        const requested = filters.limit;
        const result = (await pool.query(
          `SELECT ${conversationSelection}
           FROM conversations.conversations conversation
           WHERE ${conditions.join(" AND ")}
           ORDER BY COALESCE(conversation.last_message_at, conversation.created_at) DESC, conversation.id DESC
           LIMIT ${parameter(requested + 1)}`,
          params,
        )) as { rows: ConversationRow[] };
        const hasMore = result.rows.length > requested;
        const rows = result.rows.slice(0, requested);
        return Object.freeze({
          items: Object.freeze(rows.map(conversationFromRow)),
          nextCursor: hasMore ? nextCursor(rows.at(-1)) : null,
        });
      } catch (error) {
        return fail(error);
      }
    },
    find: async (actor, id) => {
      try {
        const visible = access(actor, 2);
        const result = (await pool.query(
          `SELECT ${conversationSelection} FROM conversations.conversations conversation
           WHERE conversation.id = $1::uuid AND ${visible.sql}`,
          [id, ...visible.params],
        )) as { rows: ConversationRow[] };
        return result.rows[0] ? conversationFromRow(result.rows[0]) : null;
      } catch (error) {
        return fail(error);
      }
    },
    thread: async (actor, id) => {
      try {
        const visible = access(actor, 2);
        const conversationResult = (await pool.query(
          `SELECT ${conversationSelection} FROM conversations.conversations conversation
           WHERE conversation.id = $1::uuid AND ${visible.sql}`,
          [id, ...visible.params],
        )) as { rows: ConversationRow[] };
        const row = conversationResult.rows[0];
        if (!row) return null;
        const [messages, history] = await Promise.all([
          pool.query(
            `SELECT ${messageSelection} FROM conversations.messages message
             WHERE message.conversation_id = $1::uuid ORDER BY message.sequence ASC`,
            [id],
          ) as Promise<{ rows: MessageRow[] }>,
          pool.query(
            `SELECT id::text, conversation_id::text, event_type, actor_member_id::text,
                    previous_value, next_value, created_at
             FROM conversations.history WHERE conversation_id = $1::uuid
             ORDER BY created_at ASC, id ASC`,
            [id],
          ) as Promise<{ rows: HistoryRow[] }>,
        ]);
        return Object.freeze({
          conversation: conversationFromRow(row),
          messages: Object.freeze(messages.rows.map(messageFromRow)),
          history: Object.freeze(history.rows.map(historyFromRow)),
        });
      } catch (error) {
        return fail(error);
      }
    },
    create: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await lock(client, input.actor.memberId, "conversations.create", input.idempotencyKey);
        const previous = await replay<ConversationRow>(
          client,
          input.actor.memberId,
          "conversations.create",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (previous) {
          await client.query("COMMIT");
          return conversationFromRow(previous);
        }
        const result = await client.query<ConversationRow>(
          `INSERT INTO conversations.conversations
           (id, contact_id, channel, external_thread_id, assignee_member_id, status,
            attention_mode, subject, last_message_preview, last_message_at, unread_count,
            version, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11, $12::bigint, $13, $14)
           RETURNING id::text, contact_id::text, channel, external_thread_id,
             assignee_member_id::text, status, attention_mode, subject, last_message_preview,
             last_message_at, unread_count, version::text, created_at, updated_at`,
          [
            input.conversation.id,
            input.conversation.contactId,
            input.conversation.channel.toLowerCase(),
            input.conversation.externalThreadId,
            input.conversation.assigneeMemberId,
            input.conversation.status.toLowerCase(),
            input.conversation.attentionMode.toLowerCase(),
            input.conversation.subject,
            input.conversation.lastMessagePreview,
            input.conversation.lastMessageAt,
            input.conversation.unreadCount,
            input.conversation.version.toString(),
            input.conversation.createdAt,
            input.conversation.updatedAt,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await client.query(
          `INSERT INTO conversations.messages
           (id, conversation_id, sequence, direction, kind, author_member_id, body,
            external_message_id, delivery_status, failure_code, document_id, document_snapshot,
            created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::bigint, $4, $5, $6::uuid, $7, $8, $9, $10, $11::uuid, $12::jsonb, $13, $14)`,
          [
            input.message.id,
            input.message.conversationId,
            input.message.sequence.toString(),
            input.message.direction.toLowerCase(),
            input.message.kind.toLowerCase(),
            input.message.authorMemberId,
            input.message.body,
            input.message.externalMessageId,
            input.message.deliveryStatus.toLowerCase(),
            input.message.failureCode,
            input.message.documentId,
            input.message.documentSnapshot === null
              ? null
              : JSON.stringify(input.message.documentSnapshot),
            input.message.createdAt,
            input.message.updatedAt,
          ],
        );
        await client.query(
          `INSERT INTO conversations.history (conversation_id, event_type, actor_member_id, next_value, created_at)
           VALUES ($1::uuid, 'created', $2::uuid, $3, $4),
                  ($1::uuid, 'message_added', $2::uuid, $5, $4)`,
          [row.id, input.actor.memberId, row.status, row.created_at, input.message.id],
        );
        await client.query(
          `INSERT INTO conversations.outbox (message_id, channel, created_at, updated_at)
           VALUES ($1::uuid, $2, $3, $3)`,
          [input.message.id, input.conversation.channel.toLowerCase(), input.message.createdAt],
        );
        await remember(
          client,
          input.actor.memberId,
          "conversations.create",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return conversationFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    update: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await lock(client, input.actor.memberId, "conversations.update", input.idempotencyKey);
        const previous = await replay<ConversationRow>(
          client,
          input.actor.memberId,
          "conversations.update",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (previous) {
          await client.query("COMMIT");
          return conversationFromRow(previous);
        }
        const visible = access(input.actor, 3);
        const before = await client.query<ConversationRow>(
          `SELECT ${conversationSelection} FROM conversations.conversations conversation
           WHERE conversation.id = $1::uuid AND conversation.version = $2::bigint AND ${visible.sql} FOR UPDATE`,
          [input.id, input.expectedVersion.toString(), ...visible.params],
        );
        const current = before.rows[0];
        if (!current) {
          await client.query("ROLLBACK");
          return null;
        }
        const result = await client.query<ConversationRow>(
          `UPDATE conversations.conversations conversation SET
             status = COALESCE($2, conversation.status),
             attention_mode = COALESCE($3, conversation.attention_mode),
             assignee_member_id = CASE WHEN $4::boolean THEN $5::uuid ELSE conversation.assignee_member_id END,
             version = conversation.version + 1, updated_at = $6
           WHERE conversation.id = $1::uuid
           RETURNING id::text, contact_id::text, channel, external_thread_id,
             assignee_member_id::text, status, attention_mode, subject, last_message_preview,
             last_message_at, unread_count, version::text, created_at, updated_at`,
          [
            input.id,
            input.status?.toLowerCase() ?? null,
            input.attentionMode?.toLowerCase() ?? null,
            input.assigneeMemberId !== undefined,
            input.assigneeMemberId ?? null,
            input.now,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        const events: Array<[string, string | null, string | null]> = [];
        if (input.status !== undefined && current.status !== row.status)
          events.push(["status_changed", current.status, row.status]);
        if (input.attentionMode !== undefined && current.attention_mode !== row.attention_mode)
          events.push(["attention_changed", current.attention_mode, row.attention_mode]);
        if (
          input.assigneeMemberId !== undefined &&
          current.assignee_member_id !== row.assignee_member_id
        )
          events.push([
            current.assignee_member_id ? "transferred" : "assigned",
            current.assignee_member_id,
            row.assignee_member_id,
          ]);
        for (const event of events)
          await client.query(
            `INSERT INTO conversations.history (conversation_id, event_type, actor_member_id, previous_value, next_value, created_at)
             VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6)`,
            [row.id, event[0], input.actor.memberId, event[1], event[2], input.now],
          );
        await remember(
          client,
          input.actor.memberId,
          "conversations.update",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return conversationFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    append: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const command =
          input.message.direction === "INTERNAL" ? "conversations.note" : "conversations.message";
        await lock(client, input.actor.memberId, command, input.idempotencyKey);
        const previous = await replay<MessageRow>(
          client,
          input.actor.memberId,
          command,
          input.idempotencyKey,
          input.payloadHash,
        );
        if (previous) {
          await client.query("COMMIT");
          return messageFromRow(previous);
        }
        const visible = access(input.actor, 3);
        const conversationResult = await client.query<ConversationRow>(
          `SELECT ${conversationSelection} FROM conversations.conversations conversation
           WHERE conversation.id = $1::uuid AND conversation.version = $2::bigint AND ${visible.sql} FOR UPDATE`,
          [input.conversationId, input.expectedVersion.toString(), ...visible.params],
        );
        const conversation = conversationResult.rows[0];
        if (!conversation) {
          await client.query("ROLLBACK");
          return null;
        }
        const sequenceResult = await client.query<{ sequence: string }>(
          `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM conversations.messages WHERE conversation_id = $1::uuid`,
          [input.conversationId],
        );
        const sequence = sequenceResult.rows[0]?.sequence;
        if (!sequence) throw new DatabaseUnavailableError();
        const result = await client.query<MessageRow>(
          `INSERT INTO conversations.messages
           (id, conversation_id, sequence, direction, kind, author_member_id, body,
            external_message_id, delivery_status, failure_code, document_id, document_snapshot,
            created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::bigint, $4, $5, $6::uuid, $7, $8, $9, $10, $11::uuid, $12::jsonb, $13, $14)
           RETURNING id::text, conversation_id::text, sequence::text, direction, kind,
             author_member_id::text, body, external_message_id, delivery_status, failure_code,
             document_id::text, document_snapshot,
             created_at, updated_at`,
          [
            input.message.id,
            input.conversationId,
            sequence,
            input.message.direction.toLowerCase(),
            input.message.kind.toLowerCase(),
            input.message.authorMemberId,
            input.message.body,
            input.message.externalMessageId,
            input.message.deliveryStatus.toLowerCase(),
            input.message.failureCode,
            input.message.documentId,
            input.message.documentSnapshot === null
              ? null
              : JSON.stringify(input.message.documentSnapshot),
            input.message.createdAt,
            input.message.updatedAt,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await client.query(
          `UPDATE conversations.conversations SET
             last_message_preview = CASE WHEN $2 = 'internal' THEN last_message_preview ELSE left($3, 280) END,
             last_message_at = CASE WHEN $2 = 'internal' THEN last_message_at ELSE $4 END,
             version = version + 1, updated_at = $4
           WHERE id = $1::uuid`,
          [
            input.conversationId,
            input.message.direction.toLowerCase(),
            input.message.body,
            input.message.createdAt,
          ],
        );
        await client.query(
          `INSERT INTO conversations.history (conversation_id, event_type, actor_member_id, next_value, created_at)
           VALUES ($1::uuid, $2, $3::uuid, $4, $5)`,
          [
            input.conversationId,
            input.message.direction === "INTERNAL" ? "note_added" : "message_added",
            input.actor.memberId,
            row.id,
            input.message.createdAt,
          ],
        );
        if (input.message.direction === "OUTBOUND")
          await client.query(
            `INSERT INTO conversations.outbox (message_id, channel, created_at, updated_at)
             VALUES ($1::uuid, $2, $3, $3)`,
            [row.id, conversation.channel, input.message.createdAt],
          );
        await remember(
          client,
          input.actor.memberId,
          command,
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return messageFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    listQuickReplies: async () => {
      try {
        const result = (await pool.query(
          `SELECT id::text, title, body, created_by_member_id::text, created_at, updated_at
           FROM conversations.quick_replies ORDER BY title ASC, id ASC`,
        )) as { rows: QuickReplyRow[] };
        return Object.freeze(result.rows.map(replyFromRow));
      } catch (error) {
        return fail(error);
      }
    },
    createQuickReply: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await lock(
          client,
          input.actor.memberId,
          "conversations.quick-reply.create",
          input.idempotencyKey,
        );
        const previous = await replay<QuickReplyRow>(
          client,
          input.actor.memberId,
          "conversations.quick-reply.create",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (previous) {
          await client.query("COMMIT");
          return replyFromRow(previous);
        }
        const result = await client.query<QuickReplyRow>(
          `INSERT INTO conversations.quick_replies (id, title, body, created_by_member_id, created_at, updated_at)
           VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6)
           RETURNING id::text, title, body, created_by_member_id::text, created_at, updated_at`,
          [
            input.reply.id,
            input.reply.title,
            input.reply.body,
            input.reply.createdByMemberId,
            input.reply.createdAt,
            input.reply.updatedAt,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await remember(
          client,
          input.actor.memberId,
          "conversations.quick-reply.create",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return replyFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
  });
}
