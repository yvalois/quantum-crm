import { randomUUID } from "node:crypto";

import { agentRoutingPrincipalId, type ConversationAgentDispatcher } from "@quantum-crm/domain";
import type { PoolClient } from "pg";

import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

interface RequestRow {
  readonly inbound_message_id: string;
  readonly conversation_id: string;
  readonly question: string;
  readonly lease_generation: string;
  readonly first_turn: boolean;
}

/** Owns the WhatsApp agent trigger and its single, fenced outbound effect. */
export function createConversationAgentPostgresRepository(
  pool: PostgresPool,
): ConversationAgentDispatcher {
  const repository: ConversationAgentDispatcher = {
    isLeasedExecution: async (inboundMessageId) => {
      try {
        const result = (await pool.query(
          `SELECT 1 FROM conversations.agent_requests AS request
             JOIN conversations.conversations AS conversation ON conversation.id = request.conversation_id
            WHERE request.inbound_message_id = $1::uuid AND request.status = 'leased'
              AND request.lease_expires_at > CURRENT_TIMESTAMP
              AND conversation.attention_mode = 'agent' AND conversation.status <> 'closed'
              AND (SELECT enabled FROM conversations.agent_control WHERE id = 1)`,
          [inboundMessageId],
        )) as { readonly rowCount: number };
        return result.rowCount === 1;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    contextForExecution: async (inboundMessageId) => {
      try {
        const result = (await pool.query(
          `WITH execution AS (
             SELECT conversation.id, conversation.agent_reset_sequence, inbound.sequence
               FROM conversations.agent_requests AS request
               JOIN conversations.conversations AS conversation ON conversation.id = request.conversation_id
               JOIN conversations.messages AS inbound ON inbound.id = request.inbound_message_id
              WHERE request.inbound_message_id = $1::uuid AND request.status = 'leased'
                AND request.lease_expires_at > CURRENT_TIMESTAMP
                AND conversation.attention_mode = 'agent' AND conversation.status <> 'closed'
                AND conversation.channel = 'whatsapp'
                AND (SELECT enabled FROM conversations.agent_control WHERE id = 1)
           )
           SELECT execution.id::text AS thread_id, prior.direction,
                  prior.author_member_id IS NOT NULL AS from_advisor, prior.body
             FROM execution
             LEFT JOIN LATERAL (
               SELECT message.direction, message.author_member_id,
                      left(message.body, 1200) AS body, message.sequence
                 FROM conversations.messages AS message
                WHERE message.conversation_id = execution.id
                  AND message.sequence > execution.agent_reset_sequence
                  AND message.sequence < execution.sequence
                  AND message.direction IN ('inbound', 'outbound')
                  AND message.kind = 'text' AND length(trim(message.body)) > 0
                  AND (message.direction = 'inbound' OR message.delivery_status <> 'failed')
                ORDER BY message.sequence DESC LIMIT 100
             ) AS prior ON true
            ORDER BY prior.sequence ASC`,
          [inboundMessageId],
        )) as {
          readonly rows: readonly {
            readonly thread_id: string;
            readonly direction: "inbound" | "outbound" | null;
            readonly from_advisor: boolean | null;
            readonly body: string | null;
          }[];
        };
        const threadId = result.rows[0]?.thread_id;
        if (!threadId) return null;
        const recent = result.rows.filter((row) => row.direction && row.body).reverse();
        const messages: Array<{ role: "customer" | "advisor" | "agent"; text: string }> = [];
        let used = 0;
        for (const row of recent) {
          const text = row.body!;
          if (used + text.length > 16_000) break;
          used += text.length;
          messages.push({
            role: row.direction === "inbound" ? "customer" : row.from_advisor ? "advisor" : "agent",
            text,
          });
        }
        messages.reverse();
        return Object.freeze({ threadId, messages: Object.freeze(messages) });
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    claimNext: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await client.query(
          `UPDATE conversations.agent_requests SET status = 'failed', lease_owner = NULL,
                  lease_expires_at = NULL, failure_code = 'ATTEMPTS_EXHAUSTED',
                  updated_at = CURRENT_TIMESTAMP
            WHERE status = 'leased' AND lease_expires_at < CURRENT_TIMESTAMP AND attempts >= 5`,
        );
        await client.query(
          `UPDATE conversations.agent_requests AS request SET status = 'cancelled',
                  lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
             FROM conversations.conversations AS conversation
            WHERE request.conversation_id = conversation.id
              AND request.status IN ('pending', 'leased')
              AND (conversation.attention_mode <> 'agent' OR conversation.status = 'closed')`,
        );
        await client.query(
          `UPDATE conversations.agent_requests SET status = 'cancelled', lease_owner = NULL,
                  lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE status IN ('pending', 'leased')
              AND NOT (SELECT enabled FROM conversations.agent_control WHERE id = 1)`,
        );
        const result = await client.query<RequestRow>(
          `SELECT request.inbound_message_id::text, request.conversation_id::text,
                  message.body AS question, request.lease_generation::text,
                  NOT EXISTS (
                    SELECT 1 FROM conversations.agent_requests AS completed
                     WHERE completed.conversation_id = request.conversation_id
                       AND completed.status = 'completed'
                       AND completed.updated_at >= COALESCE(conversation.agent_reset_at, '-infinity'::timestamptz)
                  ) AS first_turn
             FROM conversations.agent_requests AS request
             JOIN conversations.messages AS message ON message.id = request.inbound_message_id
             JOIN conversations.conversations AS conversation ON conversation.id = request.conversation_id
            WHERE (request.status = 'pending' OR
                   (request.status = 'leased' AND request.lease_expires_at < CURRENT_TIMESTAMP))
              AND request.next_attempt_at <= CURRENT_TIMESTAMP
              AND request.attempts < 5
              AND conversation.attention_mode = 'agent'
              AND conversation.status <> 'closed'
              AND (SELECT enabled FROM conversations.agent_control WHERE id = 1)
              AND NOT EXISTS (
                SELECT 1 FROM conversations.agent_requests AS other
                 WHERE other.conversation_id = request.conversation_id
                   AND other.inbound_message_id <> request.inbound_message_id
                   AND (
                     (other.status = 'leased' AND other.lease_expires_at >= CURRENT_TIMESTAMP)
                     OR (other.status = 'pending' AND
                         (other.created_at, other.inbound_message_id) <
                         (request.created_at, request.inbound_message_id))
                   )
              )
            ORDER BY request.created_at, request.inbound_message_id LIMIT 1
            FOR UPDATE OF request SKIP LOCKED`,
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        const generation = BigInt(row.lease_generation) + 1n;
        await client.query(
          `UPDATE conversations.agent_requests SET status = 'leased', attempts = attempts + 1,
                  lease_owner = $2, lease_expires_at = CURRENT_TIMESTAMP + make_interval(secs => $3),
                  lease_generation = $4::bigint, updated_at = CURRENT_TIMESTAMP
            WHERE inbound_message_id = $1::uuid`,
          [row.inbound_message_id, input.workerId, input.leaseSeconds, generation.toString()],
        );
        await client.query("COMMIT");
        return Object.freeze({
          inboundMessageId: row.inbound_message_id,
          conversationId: row.conversation_id,
          question: row.question,
          generation,
          firstTurn: row.first_turn,
        });
      } catch {
        await client?.query("ROLLBACK").catch(() => undefined);
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    complete: async (input) => {
      if (
        input.answer.trim().length < 1 ||
        input.answer.length > 4000 ||
        input.sourceIds.length > 8 ||
        input.sourceIds.some((id) => id.length > 128)
      ) {
        throw new DatabaseUnavailableError();
      }
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const control = await client.query<{ enabled: boolean }>(
          "SELECT enabled FROM conversations.agent_control WHERE id = 1 FOR UPDATE",
        );
        const conversation = await client.query<{
          contact_id: string;
          assignee_member_id: string | null;
          attention_mode: string;
          status: string;
          channel: string;
        }>(
          `SELECT contact_id::text, assignee_member_id::text, attention_mode, status, channel FROM conversations.conversations
            WHERE id = $1::uuid FOR UPDATE`,
          [input.lease.conversationId],
        );
        const request = await client.query<{
          status: string;
          lease_owner: string | null;
          lease_generation: string;
          lease_valid: boolean;
        }>(
          `SELECT status, lease_owner, lease_generation::text,
                  lease_expires_at > CURRENT_TIMESTAMP AS lease_valid
             FROM conversations.agent_requests
            WHERE inbound_message_id = $1::uuid AND conversation_id = $2::uuid FOR UPDATE`,
          [input.lease.inboundMessageId, input.lease.conversationId],
        );
        const row = request.rows[0];
        if (
          !row ||
          row.status !== "leased" ||
          row.lease_owner !== input.workerId ||
          BigInt(row.lease_generation) !== input.lease.generation ||
          !row.lease_valid
        ) {
          await client.query("COMMIT");
          return "STALE";
        }
        const current = conversation.rows[0];
        if (
          !control.rows[0]?.enabled ||
          !current ||
          current.attention_mode !== "agent" ||
          current.status === "closed" ||
          current.channel !== "whatsapp"
        ) {
          await client.query(
            `UPDATE conversations.agent_requests SET status = 'cancelled', lease_owner = NULL,
                    lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
              WHERE inbound_message_id = $1::uuid`,
            [input.lease.inboundMessageId],
          );
          await client.query("COMMIT");
          return "CANCELLED";
        }
        const handoff =
          input.handoffRequested === true && current.assignee_member_id !== null
            ? await client.query(
                `SELECT 1 FROM conversations.advisor_route_assignments
                  WHERE contact_id = $1::uuid AND advisor_member_id = $2::uuid LIMIT 1`,
                [current.contact_id, current.assignee_member_id],
              )
            : null;
        const handoffConfirmed = handoff?.rowCount === 1;
        const sequence = await client.query<{ sequence: string }>(
          `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM conversations.messages
            WHERE conversation_id = $1::uuid`,
          [input.lease.conversationId],
        );
        const messageId = randomUUID();
        await client.query(
          `INSERT INTO conversations.messages
           (id, conversation_id, sequence, direction, kind, author_member_id, body,
            external_message_id, delivery_status, failure_code, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::bigint, 'outbound', 'text', NULL, $4,
                   NULL, 'queued', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [messageId, input.lease.conversationId, sequence.rows[0]!.sequence, input.answer],
        );
        await client.query(
          `INSERT INTO conversations.outbox (message_id, channel) VALUES ($1::uuid, 'whatsapp')`,
          [messageId],
        );
        await client.query(
          `UPDATE conversations.conversations SET last_message_preview = left($2, 280),
                  last_message_at = CURRENT_TIMESTAMP, version = version + 1,
                  attention_mode = CASE WHEN $3::boolean THEN 'human' ELSE attention_mode END,
                  status = CASE WHEN $3::boolean THEN 'escalated' ELSE status END,
                  updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
          [input.lease.conversationId, input.answer, handoffConfirmed],
        );
        if (handoffConfirmed) {
          await client.query(
            `INSERT INTO conversations.history
               (conversation_id, event_type, actor_member_id, previous_value, next_value, created_at)
             VALUES ($1::uuid, 'attention_changed', $2::uuid, 'agent', 'human', CURRENT_TIMESTAMP),
                    ($1::uuid, 'status_changed', $2::uuid, $3, 'escalated', CURRENT_TIMESTAMP)`,
            [input.lease.conversationId, agentRoutingPrincipalId, current.status],
          );
          await client.query(
            `UPDATE conversations.agent_requests SET status = 'cancelled', lease_owner = NULL,
                    lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
              WHERE conversation_id = $1::uuid AND inbound_message_id <> $2::uuid
                AND status IN ('pending', 'leased')`,
            [input.lease.conversationId, input.lease.inboundMessageId],
          );
        }
        await client.query(
          `UPDATE conversations.agent_requests SET status = 'completed', response_message_id = $2::uuid,
                  source_ids = $3::jsonb,
                  lease_owner = NULL, lease_expires_at = NULL, failure_code = NULL,
                  updated_at = CURRENT_TIMESTAMP WHERE inbound_message_id = $1::uuid`,
          [input.lease.inboundMessageId, messageId, JSON.stringify(input.sourceIds)],
        );
        await client.query("COMMIT");
        return "COMPLETED";
      } catch {
        await client?.query("ROLLBACK").catch(() => undefined);
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    fail: async (input) => {
      try {
        const result = (await pool.query(
          `UPDATE conversations.agent_requests
              SET status = CASE WHEN $5::boolean AND attempts < 5 THEN 'pending' ELSE 'failed' END,
                  next_attempt_at = CURRENT_TIMESTAMP + interval '60 seconds',
                  lease_owner = NULL, lease_expires_at = NULL, failure_code = $6,
                  updated_at = CURRENT_TIMESTAMP
            WHERE inbound_message_id = $1::uuid AND conversation_id = $2::uuid
              AND status = 'leased' AND lease_owner = $3 AND lease_generation = $4::bigint
            RETURNING inbound_message_id`,
          [
            input.lease.inboundMessageId,
            input.lease.conversationId,
            input.workerId,
            input.lease.generation.toString(),
            input.retry,
            input.code,
          ],
        )) as { readonly rowCount: number };
        return result.rowCount === 1;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
  };
  return Object.freeze(repository);
}
