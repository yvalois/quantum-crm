import { randomUUID } from "node:crypto";

import type { AgentControlRepository, AgentControlState } from "@quantum-crm/domain";
import type { PoolClient } from "pg";

import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

interface ControlRow {
  readonly enabled: boolean;
  readonly version: string;
  readonly updated_at: Date;
}

function state(row: ControlRow): AgentControlState {
  return Object.freeze({
    enabled: row.enabled,
    version: BigInt(row.version),
    updatedAt: row.updated_at,
  });
}

/** The pool itself is bound to one profile; callers cannot choose a tenant. */
export function createAgentControlPostgresRepository(pool: PostgresPool): AgentControlRepository {
  return Object.freeze<AgentControlRepository>({
    get: async () => {
      try {
        const result = (await pool.query(
          "SELECT enabled, version::text, updated_at FROM conversations.agent_control WHERE id = 1",
        )) as { readonly rows: readonly ControlRow[] };
        if (!result.rows[0]) throw new DatabaseUnavailableError();
        return state(result.rows[0]);
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    set: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const found = await client.query<ControlRow>(
          "SELECT enabled, version::text, updated_at FROM conversations.agent_control WHERE id = 1 FOR UPDATE",
        );
        const current = found.rows[0];
        if (!current) throw new DatabaseUnavailableError();
        // Repeating the desired state is safe even when the original response was lost.
        if (current.enabled === input.enabled) {
          await client.query("COMMIT");
          return state(current);
        }
        if (BigInt(current.version) !== input.expectedVersion) {
          await client.query("COMMIT");
          return null;
        }
        const changed = await client.query<ControlRow>(
          `UPDATE conversations.agent_control SET enabled = $1, version = version + 1,
                  updated_by_member_id = $2::uuid, updated_at = CURRENT_TIMESTAMP
            WHERE id = 1 RETURNING enabled, version::text, updated_at`,
          [input.enabled, input.actorMemberId],
        );
        await client.query(
          `INSERT INTO conversations.agent_control_events (id, enabled, actor_member_id)
           VALUES ($1::uuid, $2, $3::uuid)`,
          [randomUUID(), input.enabled, input.actorMemberId],
        );
        if (!input.enabled) {
          await client.query(
            `UPDATE conversations.agent_requests SET status = 'cancelled', lease_owner = NULL,
                    lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
              WHERE status IN ('pending', 'leased')`,
          );
          await client.query(
            `WITH cancelled AS (
               UPDATE conversations.outbox AS outbox SET status = 'cancelled',
                      next_attempt_at = 'infinity', updated_at = CURRENT_TIMESTAMP
                 FROM conversations.agent_requests AS request
                WHERE request.response_message_id = outbox.message_id
                  AND outbox.status = 'pending'
               RETURNING outbox.message_id
             ) UPDATE conversations.messages SET delivery_status = 'failed',
                     failure_code = 'AGENT_PAUSED', updated_at = CURRENT_TIMESTAMP
               WHERE id IN (SELECT message_id FROM cancelled)`,
          );
        }
        await client.query("COMMIT");
        return state(changed.rows[0]!);
      } catch {
        await client?.query("ROLLBACK").catch(() => undefined);
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
  });
}
