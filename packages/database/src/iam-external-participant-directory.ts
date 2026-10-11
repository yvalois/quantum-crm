import { createHash } from "node:crypto";
import {
  authorizeHistoricalImport,
  ExternalParticipantConflictError,
  HistoricalImportValidationError,
  type ExternalParticipantDirectory,
  type ExternalParticipantName,
} from "@quantum-crm/domain";
import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

const externalIdPattern = /^[A-Za-z0-9_-]{1,200}$/u;

export function createIamExternalParticipantDirectory(pool: PostgresPool): ExternalParticipantDirectory {
  return {
    importDirectory: async (context, input) => {
      authorizeHistoricalImport(context, "iam:members:update");
      if (!externalIdPattern.test(input.locationId) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(input.operationId) ||
        input.participants.length > 5000) throw new HistoricalImportValidationError();
      const ids = new Set<string>();
      const participants = input.participants.map((participant) => {
        if (!externalIdPattern.test(participant.externalId) || ids.has(participant.externalId) ||
          !participant.displayName.trim() || participant.displayName.length > 300 ||
          /[\u0000-\u001f\u007f]/u.test(participant.displayName)) throw new HistoricalImportValidationError();
        ids.add(participant.externalId);
        return { externalId: participant.externalId, displayName: participant.displayName.trim() };
      }).sort((a, b) => a.externalId.localeCompare(b.externalId));
      const payloadHash = createHash("sha256").update(JSON.stringify(participants)).digest("hex");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '30s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `iam-external-participants:GHL:${input.locationId}`,
        ]);
        const actor = await client.query<{ id: string }>(
          "SELECT id::text FROM iam.members WHERE id = $1::uuid AND status = 'active' FOR KEY SHARE", [context.actor.memberId],
        );
        if (!actor.rows[0]) throw new HistoricalImportValidationError();
        const receipt = await client.query<{ payload_hash: string; total: number }>(
          `SELECT payload_hash, total FROM iam.external_participant_imports
           WHERE operation_id = $1::uuid AND source_system = 'GHL' AND source_location_id = $2`,
          [input.operationId, input.locationId],
        );
        const previous = receipt.rows[0];
        if (previous) {
          if (previous.payload_hash !== payloadHash) throw new ExternalParticipantConflictError();
          await client.query("COMMIT");
          return { total: previous.total, created: 0, replayed: previous.total };
        }
        const existing = await client.query<{ external_id: string; display_name: string }>(
          `SELECT external_id, display_name FROM iam.external_participants
           WHERE source_system = 'GHL' AND source_location_id = $1 AND external_id = ANY($2::text[])`,
          [input.locationId, [...ids]],
        );
        const names = new Map(existing.rows.map((row) => [row.external_id, row.display_name]));
        if (participants.some((item) => names.has(item.externalId) && names.get(item.externalId) !== item.displayName))
          throw new ExternalParticipantConflictError();
        const inserted = await client.query<{ external_id: string }>(
          `INSERT INTO iam.external_participants(source_system, source_location_id, external_id, display_name, actor_member_id)
           SELECT 'GHL', $1, item."externalId", item."displayName", $2::uuid
           FROM jsonb_to_recordset($3::jsonb) AS item("externalId" text, "displayName" text)
           ON CONFLICT (source_system, source_location_id, external_id) DO NOTHING RETURNING external_id`,
          [input.locationId, context.actor.memberId, JSON.stringify(participants)],
        );
        await client.query(
          `INSERT INTO iam.external_participant_imports(operation_id, source_system, source_location_id,
           payload_hash, total, created, actor_member_id) VALUES ($1::uuid, 'GHL', $2, $3, $4, $5, $6::uuid)`,
          [input.operationId, input.locationId, payloadHash, participants.length, inserted.rows.length, context.actor.memberId],
        );
        await client.query("COMMIT");
        return { total: participants.length, created: inserted.rows.length, replayed: participants.length - inserted.rows.length };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (error instanceof ExternalParticipantConflictError || error instanceof HistoricalImportValidationError) throw error;
        throw new DatabaseUnavailableError();
      } finally { client.release(); }
    },
    resolve: async (references) => {
      const pairs = new Map<string, { locationId: string; externalId: string }>();
      for (const reference of references) {
        if (!externalIdPattern.test(reference.locationId) || reference.followerExternalIds.length > 500)
          throw new HistoricalImportValidationError();
        for (const externalId of [reference.ownerExternalId, ...reference.followerExternalIds]) {
          if (externalId === null) continue;
          if (!externalIdPattern.test(externalId)) throw new HistoricalImportValidationError();
          const pair = { locationId: reference.locationId, externalId };
          pairs.set(JSON.stringify(pair), pair);
        }
      }
      if (pairs.size === 0) return [];
      const result: ExternalParticipantName[] = [];
      const requested = [...pairs.values()];
      // Bounded batches also support a large authorized pipeline without N+1 per resource.
      try {
        for (let start = 0; start < requested.length; start += 1000) {
          const found = await pool.query(
            `SELECT participant.source_location_id AS "locationId", participant.external_id AS "externalId", participant.display_name AS "displayName"
             FROM jsonb_to_recordset($1::jsonb) AS requested("locationId" text, "externalId" text)
             JOIN iam.external_participants participant ON participant.source_system = 'GHL'
               AND participant.source_location_id = requested."locationId" AND participant.external_id = requested."externalId"`,
            [JSON.stringify(requested.slice(start, start + 1000))],
          ) as { readonly rows: readonly ExternalParticipantName[] };
          result.push(...found.rows);
        }
      } catch { throw new DatabaseUnavailableError(); }
      return result;
    },
  };
}
