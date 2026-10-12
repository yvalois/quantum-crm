import { randomUUID } from "node:crypto";

import type { ConversationAgentDispatcher } from "@quantum-crm/domain";
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
              AND conversation.attention_mode = 'agent' AND conversation.status <> 'closed'`,
          [inboundMessageId],
        )) as { readonly rowCount: number };
        return result.rowCount === 1;
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
              AND NOT EXISTS (
                SELECT 1 FROM conversations.agent_requests AS other
                 WHERE other.conversation_id = request.conversation_id
                   AND other.inbound_message_id <> request.inbound_message_id
                   AND other.status = 'leased' AND other.lease_expires_at >= CURRENT_TIMESTAMP
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
        const conversation = await client.query<{
          attention_mode: string;
          status: string;
          channel: string;
        }>(
          `SELECT attention_mode, status, channel FROM conversations.conversations
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
                  updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
          [input.lease.conversationId, input.answer],
        );
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
