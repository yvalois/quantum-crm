import type { AgentKnowledgeRepository, AgentKnowledgeSource } from "@quantum-crm/domain";
import type { PoolClient } from "pg";

import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

interface SourceRow {
  readonly id: string;
  readonly catalog: "individual" | "corporativo";
  readonly file_id: string | null;
  readonly status: "pending" | "indexing" | "ready" | "failed";
  readonly active: boolean;
  readonly revision: string | null;
  readonly created_by_member_id: string;
}

const sourceColumns =
  "id::text, catalog, file_id::text, status, active, revision, created_by_member_id::text";

function fromRow(row: SourceRow): AgentKnowledgeSource {
  return Object.freeze({
    id: row.id,
    catalog: row.catalog,
    fileId: row.file_id,
    status: row.status.toUpperCase() as AgentKnowledgeSource["status"],
    active: row.active,
    revision: row.revision,
    createdByMemberId: row.created_by_member_id,
  });
}

/** Profile-local repository. Only the CRM API/worker may instantiate it. */
export function createAgentKnowledgePostgresRepository(
  pool: PostgresPool,
): AgentKnowledgeRepository {
  const repository: AgentKnowledgeRepository = {
    bothCatalogsReady: async () => {
      try {
        const result = (await pool.query(
          `SELECT COUNT(DISTINCT source.catalog) = 2 AS ready
             FROM agents.knowledge_sources AS source
             JOIN files.files AS file ON file.id = source.file_id
            WHERE source.active AND source.status = 'ready' AND file.status = 'available'
              AND source.catalog IN ('individual', 'corporativo')`,
        )) as { readonly rows: readonly { readonly ready: boolean }[] };
        return result.rows[0]?.ready === true;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    createSource: async (input) => {
      try {
        const result = (await pool.query(
          `INSERT INTO agents.knowledge_sources (id, catalog, created_by_member_id)
           VALUES ($1::uuid, $2, $3::uuid)
           ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
           RETURNING ${sourceColumns}`,
          [input.id, input.catalog, input.createdByMemberId],
        )) as { readonly rows: readonly SourceRow[] };
        const row = result.rows[0];
        if (
          !row ||
          row.catalog !== input.catalog ||
          row.created_by_member_id !== input.createdByMemberId
        )
          throw new DatabaseUnavailableError();
        return fromRow(row);
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    findSource: async (id) => {
      try {
        const result = (await pool.query(
          `SELECT ${sourceColumns} FROM agents.knowledge_sources WHERE id = $1::uuid`,
          [id],
        )) as { readonly rows: readonly SourceRow[] };
        return result.rows[0] ? fromRow(result.rows[0]) : null;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    bindFile: async (id, fileId) => {
      try {
        const result = (await pool.query(
          `UPDATE agents.knowledge_sources SET file_id = $2::uuid, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1::uuid AND status IN ('pending', 'failed')
             AND (file_id IS NULL OR file_id = $2::uuid)
             AND EXISTS (SELECT 1 FROM files.files WHERE id = $2::uuid
               AND owner_module = 'agents' AND owner_type = 'knowledge_source' AND owner_id = $1::uuid)
           RETURNING ${sourceColumns}`,
          [id, fileId],
        )) as { readonly rows: readonly SourceRow[] };
        if (!result.rows[0]) throw new DatabaseUnavailableError();
        return fromRow(result.rows[0]);
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    activate: async (input) => {
      if (
        input.chunks.length === 0 ||
        input.chunks.length > 1000 ||
        input.chunks.some(
          (chunk) =>
            !Number.isInteger(chunk.page) ||
            chunk.page < 1 ||
            chunk.page > 1000 ||
            !Number.isInteger(chunk.ordinal) ||
            chunk.ordinal < 1 ||
            chunk.ordinal > 1000 ||
            chunk.text.trim().length < 1 ||
            chunk.text.length > 4000,
        )
      )
        throw new DatabaseUnavailableError();
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const current = await client.query<SourceRow>(
          `SELECT ${sourceColumns} FROM agents.knowledge_sources WHERE id = $1::uuid FOR UPDATE`,
          [input.id],
        );
        const source = current.rows[0];
        if (!source || source.file_id !== input.fileId) throw new DatabaseUnavailableError();
        if (source.active && source.status === "ready" && source.revision === input.revision) {
          await client.query("COMMIT");
          return fromRow(source);
        }
        if (!(["pending", "failed"] as string[]).includes(source.status))
          throw new DatabaseUnavailableError();
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `agent-catalog:${source.catalog}`,
        ]);
        const file = await client.query<{ verified_sha256: string }>(
          `SELECT verified_sha256 FROM files.files WHERE id = $1::uuid
           AND owner_module = 'agents' AND owner_type = 'knowledge_source'
           AND owner_id = $2::uuid AND status = 'available'`,
          [input.fileId, input.id],
        );
        if (!file.rows[0] || file.rows[0].verified_sha256 !== input.revision)
          throw new DatabaseUnavailableError();
        for (const chunk of input.chunks) {
          await client.query(
            `INSERT INTO agents.knowledge_chunks (source_id, page, ordinal, content)
             VALUES ($1::uuid, $2, $3, $4)
             ON CONFLICT (source_id, page, ordinal) DO UPDATE SET content = EXCLUDED.content`,
            [input.id, chunk.page, chunk.ordinal, chunk.text],
          );
        }
        await client.query(
          "UPDATE agents.knowledge_sources SET active = false, updated_at = CURRENT_TIMESTAMP WHERE catalog = $1 AND active",
          [source.catalog],
        );
        const activated = await client.query<SourceRow>(
          `UPDATE agents.knowledge_sources
           SET status = 'ready', active = true, revision = $2, activated_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid RETURNING ${sourceColumns}`,
          [input.id, input.revision],
        );
        if (!activated.rows[0]) throw new DatabaseUnavailableError();
        await client.query("COMMIT");
        return fromRow(activated.rows[0]);
      } catch {
        await client?.query("ROLLBACK").catch(() => undefined);
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    search: async (input) => {
      if (input.question.trim().length < 3 || input.limit < 1 || input.limit > 8)
        throw new DatabaseUnavailableError();
      try {
        const result = (await pool.query(
          `SELECT chunk.id::text, source.catalog, chunk.page, chunk.content, source.revision
           FROM agents.knowledge_chunks AS chunk
           JOIN agents.knowledge_sources AS source ON source.id = chunk.source_id
           WHERE source.catalog = $1 AND source.active AND source.status = 'ready'
             AND chunk.search_text @@ websearch_to_tsquery('spanish', $2)
           ORDER BY ts_rank_cd(chunk.search_text, websearch_to_tsquery('spanish', $2)) DESC,
                    chunk.page ASC, chunk.ordinal ASC LIMIT $3`,
          [input.catalog, input.question, input.limit],
        )) as {
          readonly rows: readonly {
            readonly id: string;
            readonly catalog: "individual" | "corporativo";
            readonly page: number;
            readonly content: string;
            readonly revision: string;
          }[];
        };
        return Object.freeze(
          result.rows.map((row) =>
            Object.freeze({
              id: row.id,
              catalog: row.catalog,
              page: row.page,
              text: row.content,
              revision: row.revision,
            }),
          ),
        );
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
  };
  return Object.freeze(repository);
}
