import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import {
  ConversationWindowClosedError,
  type CommercialActor,
  type ConversationHistoryRecord,
  type ConversationMessageRecord,
  type ConversationRecord,
  type ConversationRepository,
  type ExternalConversationReceiver,
  type ExternalConversationMessage,
  type ConversationOutboundDispatcher,
  type QuickReplyRecord,
} from "@quantum-crm/domain";
import type { PoolClient } from "pg";

import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

interface OutboundRow {
  readonly outbox_id: string;
  readonly message_id: string;
  readonly conversation_id: string;
  readonly external_thread_id: string | null;
  readonly body: string;
  readonly kind: string;
  readonly file_id: string | null;
  readonly attempts: number;
  readonly window_open: boolean;
}

/** An expired, uncertain lease is never sent again without reconciliation. */
export function createConversationOutboundDispatcher(
  pool: PostgresPool,
): ConversationOutboundDispatcher {
  return Object.freeze({
    claimNext: async ({
      workerId,
      leaseSeconds,
    }: Parameters<ConversationOutboundDispatcher["claimNext"]>[0]) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await client.query(
          `WITH stale AS (
             UPDATE conversations.outbox SET status = 'failed', next_attempt_at = 'infinity',
                    last_error_code = 'DELIVERY_UNCERTAIN', updated_at = CURRENT_TIMESTAMP
              WHERE channel = 'whatsapp' AND status = 'leased'
                AND lease_expires_at < CURRENT_TIMESTAMP
              RETURNING message_id
           )
           UPDATE conversations.messages SET delivery_status = 'unknown',
                  failure_code = 'DELIVERY_UNCERTAIN', updated_at = CURRENT_TIMESTAMP
            WHERE id IN (SELECT message_id FROM stale)`,
        );
        const result = await client.query<OutboundRow>(
          `SELECT outbox.id::text AS outbox_id, message.id::text AS message_id,
                  message.conversation_id::text,
                  conversation.external_thread_id, message.body, message.kind,
                  message.file_id::text, outbox.attempts,
                  EXISTS (SELECT 1 FROM conversations.messages inbound
                    WHERE inbound.conversation_id = conversation.id AND inbound.direction = 'inbound'
                      AND inbound.created_at > CURRENT_TIMESTAMP - interval '24 hours'
                      AND inbound.created_at <= CURRENT_TIMESTAMP) AS window_open
             FROM conversations.outbox AS outbox
             JOIN conversations.messages AS message ON message.id = outbox.message_id
             JOIN conversations.conversations AS conversation ON conversation.id = message.conversation_id
            WHERE outbox.channel = 'whatsapp' AND outbox.status IN ('pending', 'failed')
              AND outbox.next_attempt_at <= CURRENT_TIMESTAMP
            ORDER BY outbox.next_attempt_at, outbox.id LIMIT 1
            FOR UPDATE OF outbox SKIP LOCKED`,
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        if (!row.window_open) {
          await client.query(
            `UPDATE conversations.outbox SET status = 'failed', next_attempt_at = 'infinity',
                    last_error_code = 'WHATSAPP_WINDOW_CLOSED', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1::uuid`,
            [row.outbox_id],
          );
          await client.query(
            `UPDATE conversations.messages SET delivery_status = 'failed',
                    failure_code = 'WHATSAPP_WINDOW_CLOSED', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1::uuid`,
            [row.message_id],
          );
          await client.query("COMMIT");
          return null;
        }
        const attempt = row.attempts + 1;
        await client.query(
          `UPDATE conversations.outbox SET status = 'leased', attempts = $2,
                  lease_owner = $3, lease_expires_at = CURRENT_TIMESTAMP + make_interval(secs => $4),
                  updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
          [row.outbox_id, attempt, workerId, leaseSeconds],
        );
        await client.query("COMMIT");
        return Object.freeze({
          outboxId: row.outbox_id,
          messageId: row.message_id,
          conversationId: row.conversation_id,
          externalThreadId: row.external_thread_id ?? "",
          body: row.body,
          kind: row.kind.toUpperCase() as "TEXT" | "IMAGE" | "AUDIO" | "DOCUMENT" | "SYSTEM",
          fileId: row.file_id,
          attempt,
        });
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    complete: async ({
      lease,
      workerId,
      outcome,
      externalMessageId,
      errorCode,
    }: Parameters<ConversationOutboundDispatcher["complete"]>[0]) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const status = outcome === "SENT" ? "sent" : outcome === "RETRY" ? "pending" : "failed";
        const delivery =
          outcome === "SENT"
            ? "queued"
            : outcome === "UNKNOWN"
              ? "unknown"
              : outcome === "FAILED"
                ? "failed"
                : "queued";
        const result = await client.query<{ message_id: string }>(
          `UPDATE conversations.outbox SET status = $4, lease_owner = NULL, lease_expires_at = NULL,
                  next_attempt_at = CASE WHEN $4 = 'pending' THEN CURRENT_TIMESTAMP + interval '60 seconds'
                    WHEN $4 = 'failed' THEN 'infinity'::timestamptz ELSE next_attempt_at END,
                  last_error_code = $5, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1::uuid AND message_id = $2::uuid AND status = 'leased'
              AND lease_owner = $3 AND attempts = $6
            RETURNING message_id::text`,
          [lease.outboxId, lease.messageId, workerId, status, errorCode ?? null, lease.attempt],
        );
        if (!result.rows[0]) {
          const reconciled = await client.query<{ status: string }>(
            `SELECT status FROM conversations.outbox WHERE id = $1::uuid AND message_id = $2::uuid`,
            [lease.outboxId, lease.messageId],
          );
          await client.query("COMMIT");
          return ["sent", "failed"].includes(reconciled.rows[0]?.status ?? "");
        }
        await client.query(
          `UPDATE conversations.messages SET delivery_status = CASE
                    WHEN delivery_status IN ('sent', 'delivered', 'read', 'failed')
                      THEN delivery_status ELSE $2 END,
                  external_message_id = COALESCE($3, external_message_id),
                  failure_code = CASE WHEN delivery_status IN ('sent', 'delivered', 'read', 'failed')
                    THEN failure_code ELSE $4 END,
                  updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
          [lease.messageId, delivery, externalMessageId ?? null, errorCode ?? null],
        );
        await client.query(
          `UPDATE conversations.outbox AS outbox SET status = 'sent', next_attempt_at = 'infinity',
                  last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
            FROM conversations.messages AS message
           WHERE outbox.message_id = message.id AND message.id = $1::uuid
             AND message.delivery_status IN ('sent', 'delivered', 'read')`,
          [lease.messageId],
        );
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
  });
}

export function createExternalConversationReceiver(
  pool: PostgresPool,
): ExternalConversationReceiver {
  return Object.freeze({
    reserveAdvisor: async (
      input: Parameters<ExternalConversationReceiver["reserveAdvisor"]>[0],
    ) => {
      if (
        input.eligibleMemberIds.length !== 2 ||
        input.eligibleMemberIds[0] === input.eligibleMemberIds[1]
      )
        throw new DatabaseUnavailableError();
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `advisor-route:${input.contactId}`,
        ]);
        const saved = await client.query<{ advisor_member_id: string }>(
          `SELECT advisor_member_id::text FROM conversations.advisor_route_assignments
            WHERE contact_id = $1::uuid FOR UPDATE`,
          [input.contactId],
        );
        if (saved.rows[0]) {
          let advisorId = saved.rows[0].advisor_member_id;
          if (!input.eligibleMemberIds.includes(advisorId)) throw new DatabaseUnavailableError();
          if (input.previousMemberId && input.eligibleMemberIds.includes(input.previousMemberId)) {
            advisorId = input.previousMemberId;
            if (advisorId !== saved.rows[0].advisor_member_id)
              await client.query(
                `UPDATE conversations.advisor_route_assignments
                    SET advisor_member_id = $2::uuid, source = 'previous_advisor'
                  WHERE contact_id = $1::uuid`,
                [input.contactId, advisorId],
              );
          }
          await client.query("COMMIT");
          return advisorId;
        }
        let advisorId: string;
        let source: "previous_advisor" | "round_robin";
        if (input.previousMemberId && input.eligibleMemberIds.includes(input.previousMemberId)) {
          advisorId = input.previousMemberId;
          source = "previous_advisor";
        } else {
          const turn = await client.query<{ turn: string }>(
            `UPDATE conversations.advisor_route_turn SET turn = turn + 1
              WHERE singleton = true RETURNING turn::text`,
          );
          const number = turn.rows[0]?.turn;
          if (!number) throw new DatabaseUnavailableError();
          advisorId = input.eligibleMemberIds[Number((BigInt(number) - 1n) % 2n)]!;
          source = "round_robin";
        }
        await client.query(
          `INSERT INTO conversations.advisor_route_assignments
            (contact_id, advisor_member_id, source) VALUES ($1::uuid, $2::uuid, $3)`,
          [input.contactId, advisorId, source],
        );
        await client.query("COMMIT");
        return advisorId;
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    reconcileOutbound: async (
      input: Parameters<ExternalConversationReceiver["reconcileOutbound"]>[0],
    ) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const result = await client.query<{ delivery_status: string }>(
          `UPDATE conversations.messages AS message SET
             delivery_status = CASE
               WHEN message.delivery_status = 'read' THEN 'read'
               WHEN message.delivery_status = 'delivered' AND $4 IN ('sent', 'failed') THEN 'delivered'
               WHEN message.delivery_status = 'failed' AND $4 = 'sent' THEN 'failed'
               ELSE $4 END,
             external_message_id = COALESCE(message.external_message_id, $3),
             failure_code = CASE
               WHEN message.delivery_status IN ('read', 'delivered') THEN NULL
               WHEN message.delivery_status = 'failed' AND $4 = 'sent' THEN message.failure_code
               WHEN $4 = 'failed' THEN $5 ELSE NULL END,
             updated_at = CURRENT_TIMESTAMP
            FROM conversations.conversations AS conversation
           WHERE message.id = $1::uuid AND message.conversation_id = conversation.id
             AND conversation.channel = 'whatsapp' AND conversation.external_thread_id = $2
             AND message.direction = 'outbound'
             AND (message.external_message_id IS NULL OR message.external_message_id = $3)
           RETURNING message.delivery_status`,
          [
            input.messageId,
            input.externalThreadId,
            input.externalMessageId,
            input.status.toLowerCase(),
            input.failureCode ?? null,
          ],
        );
        if (result.rowCount !== 1) {
          await client.query("COMMIT");
          return false;
        }
        const effectiveStatus = result.rows[0]!.delivery_status;
        await client.query(
          `UPDATE conversations.outbox SET status = $2, lease_owner = NULL,
                  lease_expires_at = NULL, next_attempt_at = 'infinity',
                  last_error_code = $3, updated_at = CURRENT_TIMESTAMP
            WHERE message_id = $1::uuid`,
          [
            input.messageId,
            effectiveStatus === "failed" ? "failed" : "sent",
            effectiveStatus === "failed" ? (input.failureCode ?? null) : null,
          ],
        );
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    receive: async (message: ExternalConversationMessage) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        // Serialize an inbound trigger with a profile-wide pause before taking a chat lock.
        await client.query(
          "SELECT enabled FROM conversations.agent_control WHERE id = 1 FOR SHARE",
        );
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `external-thread:${message.externalThreadId}`,
        ]);
        const existing = await client.query<{ id: string }>(
          `SELECT id::text FROM conversations.conversations
           WHERE channel = 'whatsapp' AND external_thread_id = $1 FOR UPDATE`,
          [message.externalThreadId],
        );
        let conversationId = existing.rows[0]?.id;
        if (!conversationId) {
          conversationId = randomUUID();
          await client.query(
            `INSERT INTO conversations.conversations
             (id, contact_id, channel, external_thread_id, assignee_member_id, status,
              attention_mode, subject, last_message_preview, last_message_at, unread_count,
              version, created_at, updated_at)
             VALUES ($1::uuid, $2::uuid, 'whatsapp', $3, NULL, 'open',
                     CASE WHEN $6 = 'inbound' AND NOT $7::boolean THEN 'agent' ELSE 'human' END, $5,
                     NULL, NULL, 0, 1, $4, $4)`,
            [
              conversationId,
              message.contactId,
              message.externalThreadId,
              message.occurredAt,
              message.contactDisplayName.slice(0, 240),
              message.direction.toLowerCase(),
              message.historical,
            ],
          );
        }
        const duplicate = await client.query<{ id: string }>(
          `SELECT id::text FROM conversations.messages
           WHERE conversation_id = $1::uuid AND external_message_id = $2`,
          [conversationId, message.externalMessageId],
        );
        if (duplicate.rows[0]) {
          await client.query("COMMIT");
          return "DUPLICATE" as const;
        }
        const sequence = await client.query<{ sequence: string }>(
          `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
           FROM conversations.messages WHERE conversation_id = $1::uuid`,
          [conversationId],
        );
        const inboundMessageId = randomUUID();
        await client.query(
          `INSERT INTO conversations.messages
           (id, conversation_id, sequence, direction, kind, author_member_id, body,
            external_message_id, delivery_status, failure_code, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::bigint, $4, $5, NULL, $6, $7, $8, NULL, $9, $9)`,
          [
            inboundMessageId,
            conversationId,
            sequence.rows[0]!.sequence,
            message.direction.toLowerCase(),
            message.kind.toLowerCase(),
            message.body,
            message.externalMessageId,
            message.direction === "INBOUND" ? "received" : "sent",
            message.occurredAt,
          ],
        );
        if (
          message.direction === "INBOUND" &&
          !message.historical &&
          message.inboundMedia &&
          (message.kind === "IMAGE" || message.kind === "AUDIO")
        ) {
          await client.query(
            `INSERT INTO conversations.inbound_media
             (message_id, conversation_id, provider_media_id, expected_sha256, declared_mime, sealed_source)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)`,
            [
              inboundMessageId,
              conversationId,
              message.inboundMedia.providerMediaId,
              message.inboundMedia.expectedSha256,
              message.inboundMedia.declaredMime,
              message.inboundMedia.sealedSource,
            ],
          );
        }
        await client.query(
          `UPDATE conversations.conversations SET
             last_message_preview = CASE WHEN last_message_at IS NULL OR $2 >= last_message_at
               THEN left($3, 280) ELSE last_message_preview END,
             last_message_at = GREATEST(COALESCE(last_message_at, $2), $2),
             unread_count = unread_count + CASE WHEN $4 = 'inbound' AND NOT $5 THEN 1 ELSE 0 END,
             version = version + 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1::uuid`,
          [
            conversationId,
            message.occurredAt,
            message.body,
            message.direction.toLowerCase(),
            message.historical,
          ],
        );
        if (message.direction === "INBOUND" && message.kind === "TEXT" && !message.historical) {
          await client.query(
            `INSERT INTO conversations.agent_requests (inbound_message_id, conversation_id)
             SELECT $1::uuid, conversation.id FROM conversations.conversations AS conversation
              WHERE conversation.id = $2::uuid AND conversation.attention_mode = 'agent'
                AND conversation.status <> 'closed' AND conversation.channel = 'whatsapp'
                AND (SELECT enabled FROM conversations.agent_control WHERE id = 1)`,
            [inboundMessageId, conversationId],
          );
        }
        await client.query("COMMIT");
        return "CREATED" as const;
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
  });
}

export class ConversationIdempotencyConflictError extends Error {
  public constructor() {
    super("Idempotency key was already used with a different request");
    this.name = "ConversationIdempotencyConflictError";
  }
}

export interface ConversationRow {
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
  readonly file_id: string | null;
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

export const conversationSelection = `conversation.id::text, conversation.contact_id::text,
  conversation.channel, conversation.external_thread_id, conversation.assignee_member_id::text,
  conversation.status, conversation.attention_mode, conversation.subject,
  conversation.last_message_preview, conversation.last_message_at, conversation.unread_count,
  conversation.version::text, conversation.created_at, conversation.updated_at`;
const messageSelection = `message.id::text, message.conversation_id::text, message.sequence::text,
  message.direction, message.kind, message.author_member_id::text, message.body,
  message.external_message_id, message.delivery_status, message.failure_code,
  message.file_id::text, message.document_id::text, message.document_snapshot,
  message.created_at, message.updated_at`;

export function conversationFromRow(row: ConversationRow): ConversationRecord {
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
    fileId: row.file_id,
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
export function conversationAccess(
  actor: CommercialActor,
  placeholder: number,
): { sql: string; params: string[] } {
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
const access = conversationAccess;
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
  if (error instanceof ConversationWindowClosedError) throw error;
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
    markRead: async (actor, id, throughSequence) => {
      try {
        const visible = access(actor, 2);
        const through = 2 + visible.params.length;
        const result = (await pool.query(
          `UPDATE conversations.conversations conversation SET unread_count =
             (SELECT count(*)::int FROM conversations.messages message
              WHERE message.conversation_id = conversation.id AND message.direction = 'inbound'
                AND message.sequence > $${through}::bigint)
           WHERE conversation.id = $1::uuid AND ${visible.sql}
           RETURNING ${conversationSelection}`,
          [id, ...visible.params, throughSequence.toString()],
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
            external_message_id, delivery_status, failure_code, file_id, document_id, document_snapshot,
            created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::bigint, $4, $5, $6::uuid, $7, $8, $9, $10, $11::uuid, $12::uuid, $13::jsonb, $14, $15)`,
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
            input.message.fileId,
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
             agent_reset_at = CASE WHEN $7::boolean THEN $6 ELSE conversation.agent_reset_at END,
             agent_reset_sequence = CASE WHEN $7::boolean THEN
               COALESCE((SELECT MAX(message.sequence) FROM conversations.messages AS message
                         WHERE message.conversation_id = conversation.id), 0)
               ELSE conversation.agent_reset_sequence END,
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
            input.resetAgent === true,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        if (input.resetAgent || input.attentionMode === "HUMAN") {
          await client.query(
            `UPDATE conversations.agent_requests SET status = 'cancelled', lease_owner = NULL,
                    lease_expires_at = NULL, updated_at = $2
               WHERE conversation_id = $1::uuid AND status IN ('pending', 'leased')`,
            [input.id, input.now],
          );
          await client.query(
            `WITH cancelled AS (
               UPDATE conversations.outbox AS outbox SET status = 'cancelled',
                      next_attempt_at = 'infinity', updated_at = $2
                 FROM conversations.agent_requests AS request
                WHERE request.conversation_id = $1::uuid
                  AND request.response_message_id = outbox.message_id
                  AND outbox.status = 'pending'
               RETURNING outbox.message_id
             ) UPDATE conversations.messages SET delivery_status = 'failed',
                     failure_code = 'AGENT_PAUSED', updated_at = $2
               WHERE id IN (SELECT message_id FROM cancelled)`,
            [input.id, input.now],
          );
        }
        const events: Array<[string, string | null, string | null]> = [];
        if (input.resetAgent) events.push(["agent_reset", null, null]);
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
        if (conversation.channel === "whatsapp" && input.message.direction === "OUTBOUND") {
          const window = await client.query<{ open: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM conversations.messages inbound
               WHERE inbound.conversation_id = $1::uuid AND inbound.direction = 'inbound'
                 AND inbound.created_at > CURRENT_TIMESTAMP - interval '24 hours'
                 AND inbound.created_at <= CURRENT_TIMESTAMP
             ) AS open`,
            [input.conversationId],
          );
          if (!window.rows[0]?.open) throw new ConversationWindowClosedError();
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
            external_message_id, delivery_status, failure_code, file_id, document_id, document_snapshot,
            created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::bigint, $4, $5, $6::uuid, $7, $8, $9, $10, $11::uuid, $12::uuid, $13::jsonb, $14, $15)
           RETURNING id::text, conversation_id::text, sequence::text, direction, kind,
             author_member_id::text, body, external_message_id, delivery_status, failure_code,
             file_id::text, document_id::text, document_snapshot,
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
            input.message.fileId,
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
