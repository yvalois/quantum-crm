import type { InboundMediaDispatcher } from "@quantum-crm/domain";
import type { PoolClient } from "pg";

import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

interface MediaRow {
  readonly message_id: string;
  readonly conversation_id: string;
  readonly provider_media_id: string;
  readonly sealed_source: string | null;
  readonly expected_sha256: string;
  readonly declared_mime: string;
  readonly kind: "image" | "audio";
  readonly caption: string;
  readonly file_id: string | null;
  readonly lease_generation: string;
}

/** Durable, fenced provider-media intake owned by conversations. */
export function createConversationInboundMediaPostgresRepository(
  pool: PostgresPool,
): InboundMediaDispatcher {
  return {
    claimNext: async (workerId) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const result = await client.query<MediaRow>(
          `SELECT media.message_id::text, media.conversation_id::text,
                  media.provider_media_id, media.sealed_source, media.expected_sha256, media.declared_mime,
                  media.file_id::text, media.lease_generation::text, message.kind,
                  message.body AS caption
             FROM conversations.inbound_media AS media
             JOIN conversations.messages AS message ON message.id = media.message_id
            WHERE ((media.status IN ('pending', 'waiting_scan') AND media.next_attempt_at <= CURRENT_TIMESTAMP)
                   OR (media.status = 'leased' AND media.lease_expires_at < CURRENT_TIMESTAMP))
              AND media.attempts < 5
            ORDER BY media.next_attempt_at, media.created_at, media.message_id LIMIT 1
            FOR UPDATE OF media SKIP LOCKED`,
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        const generation = BigInt(row.lease_generation) + 1n;
        await client.query(
          `UPDATE conversations.inbound_media
              SET status = 'leased', lease_owner = $2,
                  lease_expires_at = CURRENT_TIMESTAMP + interval '90 seconds',
                  lease_generation = $3::bigint, updated_at = CURRENT_TIMESTAMP
            WHERE message_id = $1::uuid`,
          [row.message_id, workerId, generation.toString()],
        );
        await client.query("COMMIT");
        return Object.freeze({
          messageId: row.message_id,
          conversationId: row.conversation_id,
          providerMediaId: row.provider_media_id,
          sealedSource: row.sealed_source,
          expectedSha256: row.expected_sha256,
          declaredMime: row.declared_mime,
          kind: row.kind.toUpperCase() as "IMAGE" | "AUDIO",
          caption: row.caption,
          fileId: row.file_id,
          generation,
        });
      } catch {
        await client?.query("ROLLBACK").catch(() => undefined);
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    bindFile: async (lease, workerId, fileId) => {
      try {
        const result = (await pool.query(
          `UPDATE conversations.inbound_media SET file_id = $4::uuid, sealed_source = NULL,
                  updated_at = CURRENT_TIMESTAMP
            WHERE message_id = $1::uuid AND lease_owner = $2 AND lease_generation = $3::bigint
              AND status = 'leased' AND (file_id IS NULL OR file_id = $4::uuid)`,
          [lease.messageId, workerId, lease.generation.toString(), fileId],
        )) as { readonly rowCount: number };
        return result.rowCount === 1;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    waitForScan: async (lease, workerId) => {
      try {
        const result = (await pool.query(
          `UPDATE conversations.inbound_media SET status = 'waiting_scan', lease_owner = NULL,
                  lease_expires_at = NULL, next_attempt_at = CURRENT_TIMESTAMP + interval '3 seconds',
                  updated_at = CURRENT_TIMESTAMP
            WHERE message_id = $1::uuid AND lease_owner = $2 AND lease_generation = $3::bigint
              AND status = 'leased' AND file_id IS NOT NULL`,
          [lease.messageId, workerId, lease.generation.toString()],
        )) as { readonly rowCount: number };
        return result.rowCount === 1;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    complete: async (lease, workerId, fileId, analysis) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const completed = await client.query(
          `UPDATE conversations.inbound_media SET status = 'completed', analysis = $5,
                  lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE message_id = $1::uuid AND lease_owner = $2 AND lease_generation = $3::bigint
              AND file_id = $4::uuid AND status = 'leased'
          RETURNING message_id`,
          [lease.messageId, workerId, lease.generation.toString(), fileId, analysis.slice(0, 8000)],
        );
        if (!completed.rowCount) {
          await client.query("ROLLBACK");
          return false;
        }
        await client.query(
          `UPDATE conversations.messages SET file_id = $2::uuid, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1::uuid AND file_id IS NULL`,
          [lease.messageId, fileId],
        );
        await client.query(
          `INSERT INTO conversations.agent_requests (inbound_message_id, conversation_id)
           SELECT $1::uuid, conversation.id FROM conversations.conversations AS conversation
            WHERE conversation.id = $2::uuid AND conversation.attention_mode = 'agent'
              AND conversation.status <> 'closed' AND conversation.channel = 'whatsapp'
              AND (SELECT enabled FROM conversations.agent_control WHERE id = 1)
           ON CONFLICT (inbound_message_id) DO NOTHING`,
          [lease.messageId, lease.conversationId],
        );
        await client.query("COMMIT");
        return true;
      } catch {
        await client?.query("ROLLBACK").catch(() => undefined);
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    fail: async (lease, workerId, code, retry) => {
      try {
        const result = (await pool.query(
          `UPDATE conversations.inbound_media
              SET attempts = attempts + 1,
                  status = CASE WHEN $4::boolean AND attempts < 4 THEN 'pending' ELSE 'failed' END,
                  next_attempt_at = CURRENT_TIMESTAMP + make_interval(secs => LEAST(120, power(2, attempts + 1)::integer * 2)),
                  failure_code = $5, lease_owner = NULL, lease_expires_at = NULL,
                  updated_at = CURRENT_TIMESTAMP
            WHERE message_id = $1::uuid AND lease_owner = $2 AND lease_generation = $3::bigint
              AND status = 'leased'`,
          [lease.messageId, workerId, lease.generation.toString(), retry, code],
        )) as { readonly rowCount: number };
        return result.rowCount === 1;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
  };
}
