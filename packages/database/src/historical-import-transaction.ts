import {
  HistoricalImportValidationError,
  validateHistoricalSource,
  type HistoricalImportContext,
  type HistoricalImportResult,
  type HistoricalImportSource,
} from "@quantum-crm/domain";
import type { PoolClient } from "pg";

import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

export interface HistoricalMappedEntity {
  readonly id: string;
  readonly relatedIds?: Readonly<Record<string, string>>;
}

export interface HistoricalMappedResult extends HistoricalImportResult {
  readonly relatedIds: Readonly<Record<string, string>>;
}

export interface HistoricalMappedInput extends HistoricalImportContext {
  readonly source: HistoricalImportSource;
}

const mapTables = Object.freeze({
  contacts: "contacts.historical_imports",
  sales: "sales.historical_imports",
  settings: "settings.historical_imports",
  conversations: "conversations.historical_imports",
});

/** Infrastructure transaction mechanics only. The callback writes its own module's data. */
export async function withHistoricalImport(
  pool: PostgresPool,
  module: keyof typeof mapTables,
  entityType: string,
  input: HistoricalMappedInput,
  create: (client: PoolClient) => Promise<HistoricalMappedEntity>,
): Promise<HistoricalMappedResult> {
  validateHistoricalSource(input.source);
  if (!/^[a-z_]{1,40}$/u.test(entityType)) throw new HistoricalImportValidationError();
  const table = mapTables[module];
  const { source } = input;
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      JSON.stringify([module, entityType, source.system, source.locationId, source.externalId]),
    ]);
    const found = await client.query<{
      readonly entity_id: string;
      readonly payload_hash: string;
      readonly result_metadata: Record<string, string>;
    }>(
      `SELECT entity_id::text, payload_hash, result_metadata FROM ${table}
       WHERE source_system = $1 AND source_location_id = $2 AND entity_type = $3 AND external_id = $4`,
      [source.system, source.locationId, entityType, source.externalId],
    );
    const existing = found.rows[0];
    if (existing) {
      await client.query("COMMIT");
      return Object.freeze({
        id: existing.entity_id,
        status: existing.payload_hash === source.payloadHash ? "REPLAYED" : "SOURCE_CHANGED",
        relatedIds: Object.freeze(existing.result_metadata),
      });
    }
    const entity = await create(client);
    const relatedIds = entity.relatedIds ?? {};
    await client.query(
      `INSERT INTO ${table}
       (source_system, source_location_id, entity_type, external_id, entity_id, payload_hash,
        source_payload, result_metadata, actor_member_id)
       VALUES ($1, $2, $3, $4, $5::uuid, $6, $7::jsonb, $8::jsonb, $9::uuid)`,
      [source.system, source.locationId, entityType, source.externalId, entity.id,
        source.payloadHash, JSON.stringify(source.raw), JSON.stringify(relatedIds), input.actor.memberId],
    );
    await client.query("COMMIT");
    return Object.freeze({ id: entity.id, status: "CREATED", relatedIds: Object.freeze(relatedIds) });
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => undefined);
    if (error instanceof HistoricalImportValidationError) throw error;
    throw new DatabaseUnavailableError();
  } finally {
    client?.release();
  }
}
