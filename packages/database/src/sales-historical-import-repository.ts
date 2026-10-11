import {
  authorizeHistoricalImport,
  HistoricalImportValidationError,
  validateHistoricalDates,
  type HistoricalSalesImportLookups,
  type HistoricalSalesImportPort,
} from "@quantum-crm/domain";

import { withHistoricalImport } from "./historical-import-transaction.js";
import type { PostgresPool } from "./postgres-database.js";

export function createSalesHistoricalImportPort(
  pool: PostgresPool,
  lookups: HistoricalSalesImportLookups,
): HistoricalSalesImportPort {
  return Object.freeze<HistoricalSalesImportPort>({
    importPipeline: async (input) => {
      authorizeHistoricalImport(input, "crm:sales:configure");
      validateHistoricalDates(input.createdAt, input.createdAt);
      if (!input.name.trim() || input.name.length > 160 || input.description.length > 2000 ||
        input.stages.length === 0 || input.stages.length > 100) throw new HistoricalImportValidationError();
      const externalIds = new Set<string>();
      const positions = new Set<number>();
      for (const stage of input.stages) {
        if (!/^[A-Za-z0-9_-]{1,300}$/u.test(stage.externalId) || externalIds.has(stage.externalId) ||
          !stage.name.trim() || stage.name.length > 160 || stage.description.length > 2000 ||
          !Number.isSafeInteger(stage.position) || stage.position < 0 || positions.has(stage.position)) {
          throw new HistoricalImportValidationError();
        }
        externalIds.add(stage.externalId);
        positions.add(stage.position);
      }
      const result = await withHistoricalImport(pool, "sales", "pipeline", input, async (client) => {
        const inserted = await client.query<{ readonly id: string }>(
          `INSERT INTO sales.pipelines (name, description, created_at)
           VALUES ($1, $2, $3) RETURNING id::text`, [input.name, input.description, input.createdAt],
        );
        const pipeline = inserted.rows[0];
        if (!pipeline) throw new HistoricalImportValidationError();
        const relatedIds: Record<string, string> = {};
        for (const stage of input.stages) {
          const added = await client.query<{ readonly id: string }>(
            `INSERT INTO sales.pipeline_stages (pipeline_id, name, description, position)
             VALUES ($1::uuid, $2, $3, $4) RETURNING id::text`,
            [pipeline.id, stage.name, stage.description, stage.position],
          );
          if (!added.rows[0]) throw new HistoricalImportValidationError();
          Object.defineProperty(relatedIds, stage.externalId, {
            value: added.rows[0].id, enumerable: true, configurable: true, writable: true,
          });
        }
        return { id: pipeline.id, relatedIds };
      });
      return Object.freeze({
        id: result.id,
        status: result.status,
        stages: Object.freeze(Object.entries(result.relatedIds).map(([externalId, id]) => ({ externalId, id }))),
      });
    },
    importOpportunity: async (input) => {
      authorizeHistoricalImport(input, "crm:sales:create");
      validateHistoricalDates(input.createdAt, input.updatedAt);
      const terminal = input.status !== "OPEN";
      const requiresReason = input.status === "LOST" || input.status === "ABANDONED";
      if (!input.title.trim() || input.title.length > 160 || input.amountMinor < 0n ||
        input.amountMinor > 9_223_372_036_854_775_807n || !/^[A-Z]{3}$/u.test(input.currency) ||
        !["OPEN", "WON", "LOST", "ABANDONED"].includes(input.status) ||
        (requiresReason ? !input.closeReason?.trim() : input.closeReason !== null) ||
        (input.closeReason?.length ?? 0) > 2000 ||
        (terminal ? input.closedAt === null || !Number.isFinite(input.closedAt.getTime()) : input.closedAt !== null)) {
        throw new HistoricalImportValidationError();
      }
      // These public lookups preserve ownership of contacts and membership data.
      const [contactExists, ownerActive] = await Promise.all([
        lookups.contacts.existsFor(input.actor, input.contactId),
        lookups.members.isActive(input.ownerMemberId),
      ]);
      if (!contactExists || !ownerActive) throw new HistoricalImportValidationError();
      return withHistoricalImport(pool, "sales", "opportunity", input, async (client) => {
        const stages = await client.query<{ readonly id: string }>(
          `SELECT id::text FROM sales.pipeline_stages WHERE id = $1::uuid AND pipeline_id = $2::uuid FOR KEY SHARE`,
          [input.stageId, input.pipelineId],
        );
        if (!stages.rows[0]) throw new HistoricalImportValidationError();
        const inserted = await client.query<{ readonly id: string }>(
          `INSERT INTO sales.opportunities
           (owner_member_id, contact_id, pipeline_id, stage_id, title, amount_minor, currency,
            status, close_reason, closed_at, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::bigint, $7, $8, $9, $10, $11, $12)
           RETURNING id::text`,
          [input.ownerMemberId, input.contactId, input.pipelineId, input.stageId, input.title,
            input.amountMinor.toString(), input.currency, input.status.toLowerCase(), input.closeReason,
            input.closedAt, input.createdAt, input.updatedAt],
        );
        const opportunity = inserted.rows[0];
        if (!opportunity) throw new HistoricalImportValidationError();
        // Explicit migration note; historical load never publishes live automation/outbox events.
        await client.query(
          `INSERT INTO sales.opportunity_history
           (opportunity_id, event_type, actor_member_id, next_stage_id, next_owner_member_id,
            next_status, next_amount_minor, note, created_at)
           VALUES ($1::uuid, 'created', $2::uuid, $3::uuid, $4::uuid, $5, $6::bigint, $7, $8)`,
          [opportunity.id, input.actor.memberId, input.stageId, input.ownerMemberId,
            input.status.toLowerCase(), input.amountMinor.toString(),
            "Importación histórica GHL; responsable de destino asignado por migración.", input.createdAt],
        );
        return opportunity;
      });
    },
  });
}

export function createSalesHistoricalImportVerification(pool: PostgresPool) {
  return {
    verify: async (locationId: string) => {
      const client = await pool.connect();
      try {
        const result = await client.query<{
          mapped_pipelines: string; existing_pipelines: string; mapped_stages: string; existing_stages: string;
          mapped_opportunities: string; existing_opportunities: string; valid_opportunity_stages: string;
        }>(
          `WITH maps AS (
             SELECT * FROM sales.historical_imports WHERE source_system = 'GHL' AND source_location_id = $1
           ), stages AS (
             SELECT map.entity_id AS pipeline_id, entries.value AS stage_id
             FROM maps AS map CROSS JOIN LATERAL jsonb_each_text(map.result_metadata) AS entries
             WHERE map.entity_type = 'pipeline'
           )
           SELECT
             count(*) FILTER (WHERE map.entity_type = 'pipeline')::text AS mapped_pipelines,
             count(pipeline.id)::text AS existing_pipelines,
             (SELECT count(*)::text FROM stages) AS mapped_stages,
             (SELECT count(stage.id)::text FROM stages
              JOIN sales.pipeline_stages AS stage ON stage.id::text = stages.stage_id AND stage.pipeline_id = stages.pipeline_id) AS existing_stages,
             count(*) FILTER (WHERE map.entity_type = 'opportunity')::text AS mapped_opportunities,
             count(opportunity.id)::text AS existing_opportunities,
             count(opportunity_stage.id)::text AS valid_opportunity_stages
           FROM maps AS map
           LEFT JOIN sales.pipelines AS pipeline ON map.entity_type = 'pipeline' AND pipeline.id = map.entity_id
           LEFT JOIN sales.opportunities AS opportunity ON map.entity_type = 'opportunity' AND opportunity.id = map.entity_id
           LEFT JOIN sales.pipeline_stages AS opportunity_stage
             ON opportunity_stage.id = opportunity.stage_id AND opportunity_stage.pipeline_id = opportunity.pipeline_id`,
          [locationId],
        );
        const row = result.rows[0];
        if (!row) throw new HistoricalImportValidationError();
        return {
          mappedPipelines: Number(row.mapped_pipelines), existingPipelines: Number(row.existing_pipelines),
          mappedStages: Number(row.mapped_stages), existingStages: Number(row.existing_stages),
          mappedOpportunities: Number(row.mapped_opportunities), existingOpportunities: Number(row.existing_opportunities),
          validOpportunityStages: Number(row.valid_opportunity_stages),
        };
      } finally { client.release(); }
    },
  };
}
