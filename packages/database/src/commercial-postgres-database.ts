import type {
  ContactRecord,
  ContactRepository,
  Opportunity,
  Pipeline,
  PipelineStage,
  SalesRepository,
  TaskRecord,
  TaskRepository,
  TaskStatus,
} from "@quantum-crm/domain";
import type { PoolClient } from "pg";

import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

export class CommercialIdempotencyConflictError extends Error {
  public constructor() {
    super("Idempotency key was already used with a different request");
    this.name = "CommercialIdempotencyConflictError";
  }
}

interface ContactRow {
  readonly id: string;
  readonly owner_member_id: string;
  readonly display_name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}
const contactSelection = `id::text, owner_member_id::text, display_name, email::text, phone, version::text, created_at, updated_at`;
function contactFromRow(row: ContactRow): ContactRecord {
  return Object.freeze({
    id: row.id,
    ownerMemberId: row.owner_member_id,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}
function fail(error: unknown): never {
  if (error instanceof CommercialIdempotencyConflictError) throw error;
  throw new DatabaseUnavailableError();
}

async function replayContact(
  client: PoolClient,
  actorMemberId: string,
  command: string,
  idempotencyKey: string,
  payloadHash: string,
): Promise<ContactRecord | null> {
  const found = await client.query<{
    readonly payload_hash: string;
    readonly response: ContactRow;
  }>(
    `SELECT payload_hash, response FROM contacts.command_idempotency WHERE actor_member_id = $1::uuid AND command = $2 AND idempotency_key = $3 FOR UPDATE`,
    [actorMemberId, command, idempotencyKey],
  );
  const row = found.rows[0];
  if (!row) return null;
  if (row.payload_hash !== payloadHash) throw new CommercialIdempotencyConflictError();
  return contactFromRow(row.response);
}

interface PipelineRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly created_at: Date;
}
interface StageRow {
  readonly id: string;
  readonly pipeline_id: string;
  readonly name: string;
  readonly description: string;
  readonly position: number;
}
interface OpportunityRow {
  readonly id: string;
  readonly owner_member_id: string;
  readonly contact_id: string;
  readonly pipeline_id: string;
  readonly stage_id: string;
  readonly title: string;
  readonly amount_minor: string;
  readonly currency: string;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}
function stageFromRow(row: StageRow): PipelineStage {
  return Object.freeze({
    id: row.id,
    pipelineId: row.pipeline_id,
    name: row.name,
    description: row.description,
    position: row.position,
  });
}
function opportunityFromRow(row: OpportunityRow): Opportunity {
  return Object.freeze({
    id: row.id,
    ownerMemberId: row.owner_member_id,
    contactId: row.contact_id,
    pipelineId: row.pipeline_id,
    stageId: row.stage_id,
    title: row.title,
    amountMinor: BigInt(row.amount_minor),
    currency: row.currency,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}
interface TaskRow {
  readonly id: string;
  readonly created_by_member_id: string;
  readonly contact_id: string | null;
  readonly opportunity_id: string | null;
  readonly assignee_member_id: string;
  readonly title: string;
  readonly description: string;
  readonly priority: string;
  readonly due_at: Date | null;
  readonly status: string;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}
const taskSelection = `id::text, created_by_member_id::text, contact_id::text, opportunity_id::text, assignee_member_id::text, title, description, priority, due_at, status, version::text, created_at, updated_at`;
function taskFromRow(row: TaskRow): TaskRecord {
  if (row.priority !== "low" && row.priority !== "medium" && row.priority !== "high")
    throw new DatabaseUnavailableError();
  const status = row.status.toUpperCase() as TaskStatus;
  if (!["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED"].includes(status))
    throw new DatabaseUnavailableError();
  return Object.freeze({
    id: row.id,
    createdByMemberId: row.created_by_member_id,
    contactId: row.contact_id,
    opportunityId: row.opportunity_id,
    assigneeMemberId: row.assignee_member_id,
    title: row.title,
    description: row.description,
    priority: row.priority.toUpperCase() as TaskRecord["priority"],
    dueAt: row.due_at === null ? null : new Date(row.due_at),
    status,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}
async function pipelineFromRow(pool: PostgresPool, row: PipelineRow): Promise<Pipeline> {
  const stages = (await pool.query(
    `SELECT id::text, pipeline_id::text, name, description, position FROM sales.pipeline_stages WHERE pipeline_id = $1::uuid ORDER BY position ASC`,
    [row.id],
  )) as { readonly rows: readonly StageRow[] };
  return Object.freeze({
    id: row.id,
    name: row.name,
    description: row.description,
    stages: Object.freeze(stages.rows.map(stageFromRow)),
    createdAt: new Date(row.created_at),
  });
}

export interface CommercialPostgresRepositories {
  readonly contacts: ContactRepository;
  readonly sales: SalesRepository;
  readonly tasks: TaskRepository;
}

export function createCommercialPostgresRepositories(
  pool: PostgresPool,
): CommercialPostgresRepositories {
  const contacts: ContactRepository = Object.freeze({
    list: async (actor) => {
      try {
        const result = (await pool.query(
          `SELECT ${contactSelection} FROM contacts.contacts WHERE ($1::uuid IS NULL OR owner_member_id = $1::uuid) ORDER BY created_at DESC, id DESC`,
          [actor.scope === "OWN" ? actor.memberId : null],
        )) as { readonly rows: readonly ContactRow[] };
        return Object.freeze(result.rows.map(contactFromRow));
      } catch (error) {
        return fail(error);
      }
    },
    find: async (actor, id) => {
      try {
        const result = (await pool.query(
          `SELECT ${contactSelection} FROM contacts.contacts WHERE id = $1::uuid AND ($2::uuid IS NULL OR owner_member_id = $2::uuid)`,
          [id, actor.scope === "OWN" ? actor.memberId : null],
        )) as { readonly rows: readonly ContactRow[] };
        const row = result.rows[0];
        return row ? contactFromRow(row) : null;
      } catch (error) {
        return fail(error);
      }
    },
    create: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const replay = await replayContact(
          client,
          input.actor.memberId,
          "contacts.create",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (replay) {
          await client.query("COMMIT");
          return replay;
        }
        const result = await client.query<ContactRow>(
          `INSERT INTO contacts.contacts (id, owner_member_id, display_name, email, phone, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::bigint, $7, $8) RETURNING ${contactSelection}`,
          [
            input.contact.id,
            input.contact.ownerMemberId,
            input.contact.displayName,
            input.contact.email,
            input.contact.phone,
            input.contact.version.toString(),
            input.contact.createdAt,
            input.contact.updatedAt,
          ],
        );
        const created = result.rows[0];
        if (!created) throw new DatabaseUnavailableError();
        await client.query(
          `INSERT INTO contacts.command_idempotency (actor_member_id, command, idempotency_key, payload_hash, response) VALUES ($1::uuid, 'contacts.create', $2, $3, $4::jsonb)`,
          [input.actor.memberId, input.idempotencyKey, input.payloadHash, JSON.stringify(created)],
        );
        await client.query("COMMIT");
        return contactFromRow(created);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    update: async (input) => {
      try {
        const result = (await pool.query(
          `UPDATE contacts.contacts SET display_name = $2, email = $3, phone = $4, version = version + 1, updated_at = $5 WHERE id = $1::uuid AND version = $6::bigint AND ($7::uuid IS NULL OR owner_member_id = $7::uuid) RETURNING ${contactSelection}`,
          [
            input.contact.id,
            input.contact.displayName,
            input.contact.email,
            input.contact.phone,
            input.contact.updatedAt,
            input.expectedVersion.toString(),
            input.actor.scope === "OWN" ? input.actor.memberId : null,
          ],
        )) as { readonly rows: readonly ContactRow[] };
        const row = result.rows[0];
        return row ? contactFromRow(row) : null;
      } catch (error) {
        return fail(error);
      }
    },
  });
  const sales: SalesRepository = Object.freeze({
    listPipelines: async () => {
      try {
        const result = (await pool.query(
          `SELECT id::text, name, description, created_at FROM sales.pipelines ORDER BY created_at ASC, id ASC`,
        )) as { readonly rows: readonly PipelineRow[] };
        return Object.freeze(
          await Promise.all(result.rows.map((row) => pipelineFromRow(pool, row))),
        );
      } catch (error) {
        return fail(error);
      }
    },
    createPipeline: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const existing = await client.query<{
          readonly payload_hash: string;
          readonly response: PipelineRow;
        }>(
          `SELECT payload_hash, response FROM sales.command_idempotency WHERE actor_member_id = $1::uuid AND command = 'sales.pipeline.create' AND idempotency_key = $2 FOR UPDATE`,
          [input.actor.memberId, input.idempotencyKey],
        );
        const replay = existing.rows[0];
        if (replay) {
          if (replay.payload_hash !== input.payloadHash)
            throw new CommercialIdempotencyConflictError();
          await client.query("COMMIT");
          return pipelineFromRow(pool, replay.response);
        }
        const inserted = await client.query<PipelineRow>(
          `INSERT INTO sales.pipelines (id, name, description, created_at) VALUES ($1::uuid, $2, $3, $4) RETURNING id::text, name, description, created_at`,
          [
            input.pipeline.id,
            input.pipeline.name,
            input.pipeline.description,
            input.pipeline.createdAt,
          ],
        );
        const created = inserted.rows[0];
        if (!created) throw new DatabaseUnavailableError();
        await client.query(
          `INSERT INTO sales.command_idempotency (actor_member_id, command, idempotency_key, payload_hash, response) VALUES ($1::uuid, 'sales.pipeline.create', $2, $3, $4::jsonb)`,
          [input.actor.memberId, input.idempotencyKey, input.payloadHash, JSON.stringify(created)],
        );
        await client.query("COMMIT");
        return Object.freeze({ ...input.pipeline, stages: [] });
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    addStage: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const replay = await client.query<{
          readonly payload_hash: string;
          readonly response: StageRow;
        }>(
          `SELECT payload_hash, response FROM sales.command_idempotency WHERE actor_member_id = $1::uuid AND command = 'sales.pipeline.stage.create' AND idempotency_key = $2 FOR UPDATE`,
          [input.actor.memberId, input.idempotencyKey],
        );
        const previous = replay.rows[0];
        if (previous) {
          if (previous.payload_hash !== input.payloadHash)
            throw new CommercialIdempotencyConflictError();
          await client.query("COMMIT");
          return stageFromRow(previous.response);
        }
        const result = await client.query<StageRow>(
          `INSERT INTO sales.pipeline_stages (id, pipeline_id, name, description, position) VALUES ($1::uuid, $2::uuid, $3, $4, $5) RETURNING id::text, pipeline_id::text, name, description, position`,
          [
            input.stage.id,
            input.stage.pipelineId,
            input.stage.name,
            input.stage.description,
            input.stage.position,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await client.query(
          `INSERT INTO sales.command_idempotency (actor_member_id, command, idempotency_key, payload_hash, response) VALUES ($1::uuid, 'sales.pipeline.stage.create', $2, $3, $4::jsonb)`,
          [input.actor.memberId, input.idempotencyKey, input.payloadHash, JSON.stringify(row)],
        );
        await client.query("COMMIT");
        return stageFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    listOpportunities: async (actor) => {
      try {
        const result = (await pool.query(
          `SELECT id::text, owner_member_id::text, contact_id::text, pipeline_id::text, stage_id::text, title, amount_minor::text, currency::text, version::text, created_at, updated_at FROM sales.opportunities WHERE ($1::uuid IS NULL OR owner_member_id = $1::uuid) ORDER BY created_at DESC, id DESC`,
          [actor.scope === "OWN" ? actor.memberId : null],
        )) as { readonly rows: readonly OpportunityRow[] };
        return Object.freeze(result.rows.map(opportunityFromRow));
      } catch (error) {
        return fail(error);
      }
    },
    findOpportunity: async (actor, id) => {
      try {
        const result = (await pool.query(
          `SELECT id::text, owner_member_id::text, contact_id::text, pipeline_id::text, stage_id::text, title, amount_minor::text, currency::text, version::text, created_at, updated_at FROM sales.opportunities WHERE id = $1::uuid AND ($2::uuid IS NULL OR owner_member_id = $2::uuid)`,
          [id, actor.scope === "OWN" ? actor.memberId : null],
        )) as { readonly rows: readonly OpportunityRow[] };
        const row = result.rows[0];
        return row ? opportunityFromRow(row) : null;
      } catch (error) {
        return fail(error);
      }
    },
    findStage: async (id) => {
      try {
        const result = (await pool.query(
          `SELECT id::text, pipeline_id::text, name, description, position FROM sales.pipeline_stages WHERE id = $1::uuid`,
          [id],
        )) as { readonly rows: readonly StageRow[] };
        const row = result.rows[0];
        return row ? stageFromRow(row) : null;
      } catch (error) {
        return fail(error);
      }
    },
    createOpportunity: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const replay = await client.query<{
          readonly payload_hash: string;
          readonly response: OpportunityRow;
        }>(
          `SELECT payload_hash, response FROM sales.command_idempotency WHERE actor_member_id = $1::uuid AND command = 'sales.opportunity.create' AND idempotency_key = $2 FOR UPDATE`,
          [input.actor.memberId, input.idempotencyKey],
        );
        const previous = replay.rows[0];
        if (previous) {
          if (previous.payload_hash !== input.payloadHash)
            throw new CommercialIdempotencyConflictError();
          await client.query("COMMIT");
          return opportunityFromRow(previous.response);
        }
        const inserted = await client.query<OpportunityRow>(
          `INSERT INTO sales.opportunities (id, owner_member_id, contact_id, pipeline_id, stage_id, title, amount_minor, currency, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7::bigint, $8, $9::bigint, $10, $11) RETURNING id::text, owner_member_id::text, contact_id::text, pipeline_id::text, stage_id::text, title, amount_minor::text, currency::text, version::text, created_at, updated_at`,
          [
            input.opportunity.id,
            input.opportunity.ownerMemberId,
            input.opportunity.contactId,
            input.opportunity.pipelineId,
            input.opportunity.stageId,
            input.opportunity.title,
            input.opportunity.amountMinor.toString(),
            input.opportunity.currency,
            input.opportunity.version.toString(),
            input.opportunity.createdAt,
            input.opportunity.updatedAt,
          ],
        );
        const row = inserted.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await client.query(
          `INSERT INTO sales.command_idempotency (actor_member_id, command, idempotency_key, payload_hash, response) VALUES ($1::uuid, 'sales.opportunity.create', $2, $3, $4::jsonb)`,
          [input.actor.memberId, input.idempotencyKey, input.payloadHash, JSON.stringify(row)],
        );
        await client.query("COMMIT");
        return opportunityFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    moveOpportunity: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const replay = await client.query<{
          readonly payload_hash: string;
          readonly response: OpportunityRow;
        }>(
          `SELECT payload_hash, response FROM sales.command_idempotency WHERE actor_member_id = $1::uuid AND command = 'sales.opportunity.move' AND idempotency_key = $2 FOR UPDATE`,
          [input.actor.memberId, input.idempotencyKey],
        );
        const previous = replay.rows[0];
        if (previous) {
          if (previous.payload_hash !== input.payloadHash)
            throw new CommercialIdempotencyConflictError();
          await client.query("COMMIT");
          return opportunityFromRow(previous.response);
        }
        const result = await client.query<OpportunityRow>(
          `UPDATE sales.opportunities SET stage_id = $2::uuid, version = version + 1, updated_at = $3 WHERE id = $1::uuid AND version = $4::bigint AND ($5::uuid IS NULL OR owner_member_id = $5::uuid) RETURNING id::text, owner_member_id::text, contact_id::text, pipeline_id::text, stage_id::text, title, amount_minor::text, currency::text, version::text, created_at, updated_at`,
          [
            input.id,
            input.stageId,
            input.now,
            input.expectedVersion.toString(),
            input.actor.scope === "OWN" ? input.actor.memberId : null,
          ],
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        await client.query(
          `INSERT INTO sales.command_idempotency (actor_member_id, command, idempotency_key, payload_hash, response) VALUES ($1::uuid, 'sales.opportunity.move', $2, $3, $4::jsonb)`,
          [input.actor.memberId, input.idempotencyKey, input.payloadHash, JSON.stringify(row)],
        );
        await client.query("COMMIT");
        return opportunityFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
  });
  const tasks: TaskRepository = Object.freeze({
    list: async (actor) => {
      try {
        const result = (await pool.query(
          `SELECT ${taskSelection} FROM tasks.tasks WHERE ($1::uuid IS NULL OR created_by_member_id = $1::uuid OR assignee_member_id = $1::uuid) ORDER BY due_at NULLS LAST, id DESC`,
          [actor.scope === "OWN" ? actor.memberId : null],
        )) as { readonly rows: readonly TaskRow[] };
        return Object.freeze(result.rows.map(taskFromRow));
      } catch (error) {
        return fail(error);
      }
    },
    find: async (actor, id) => {
      try {
        const result = (await pool.query(
          `SELECT ${taskSelection} FROM tasks.tasks WHERE id = $1::uuid AND ($2::uuid IS NULL OR created_by_member_id = $2::uuid OR assignee_member_id = $2::uuid)`,
          [id, actor.scope === "OWN" ? actor.memberId : null],
        )) as { readonly rows: readonly TaskRow[] };
        const row = result.rows[0];
        return row ? taskFromRow(row) : null;
      } catch (error) {
        return fail(error);
      }
    },
    create: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const replay = await client.query<{
          readonly payload_hash: string;
          readonly response: TaskRow;
        }>(
          `SELECT payload_hash, response FROM tasks.command_idempotency WHERE actor_member_id = $1::uuid AND command = 'tasks.create' AND idempotency_key = $2 FOR UPDATE`,
          [input.actor.memberId, input.idempotencyKey],
        );
        const previous = replay.rows[0];
        if (previous) {
          if (previous.payload_hash !== input.payloadHash)
            throw new CommercialIdempotencyConflictError();
          await client.query("COMMIT");
          return taskFromRow(previous.response);
        }
        const result = await client.query<TaskRow>(
          `INSERT INTO tasks.tasks (id, created_by_member_id, contact_id, opportunity_id, assignee_member_id, title, description, priority, due_at, status, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9, 'pending', $10::bigint, $11, $12) RETURNING ${taskSelection}`,
          [
            input.task.id,
            input.task.createdByMemberId,
            input.task.contactId,
            input.task.opportunityId,
            input.task.assigneeMemberId,
            input.task.title,
            input.task.description,
            input.task.priority.toLowerCase(),
            input.task.dueAt,
            input.task.version.toString(),
            input.task.createdAt,
            input.task.updatedAt,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await client.query(
          `INSERT INTO tasks.command_idempotency (actor_member_id, command, idempotency_key, payload_hash, response) VALUES ($1::uuid, 'tasks.create', $2, $3, $4::jsonb)`,
          [input.actor.memberId, input.idempotencyKey, input.payloadHash, JSON.stringify(row)],
        );
        await client.query("COMMIT");
        return taskFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    updateStatus: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const replay = await client.query<{
          readonly payload_hash: string;
          readonly response: TaskRow;
        }>(
          `SELECT payload_hash, response FROM tasks.command_idempotency WHERE actor_member_id = $1::uuid AND command = 'tasks.status.update' AND idempotency_key = $2 FOR UPDATE`,
          [input.actor.memberId, input.idempotencyKey],
        );
        const previous = replay.rows[0];
        if (previous) {
          if (previous.payload_hash !== input.payloadHash)
            throw new CommercialIdempotencyConflictError();
          await client.query("COMMIT");
          return taskFromRow(previous.response);
        }
        const result = await client.query<TaskRow>(
          `UPDATE tasks.tasks SET status = $2, version = version + 1, updated_at = $3 WHERE id = $1::uuid AND version = $4::bigint AND ($5::uuid IS NULL OR created_by_member_id = $5::uuid OR assignee_member_id = $5::uuid) RETURNING ${taskSelection}`,
          [
            input.id,
            input.status.toLowerCase(),
            input.now,
            input.expectedVersion.toString(),
            input.actor.scope === "OWN" ? input.actor.memberId : null,
          ],
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        await client.query(
          `INSERT INTO tasks.command_idempotency (actor_member_id, command, idempotency_key, payload_hash, response) VALUES ($1::uuid, 'tasks.status.update', $2, $3, $4::jsonb)`,
          [input.actor.memberId, input.idempotencyKey, input.payloadHash, JSON.stringify(row)],
        );
        await client.query("COMMIT");
        return taskFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
  });
  return Object.freeze({ contacts, sales, tasks });
}
