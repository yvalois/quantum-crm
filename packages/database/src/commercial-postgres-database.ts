import { randomUUID } from "node:crypto";

import {
  AutomationNotFoundError,
  AutomationValidationError,
  type AutomationActivationResult,
  type AutomationDefinition,
  type AutomationExecutionResult,
  type AutomationRepository,
} from "@quantum-crm/domain";
import type {
  ContactRecord,
  ContactImportResult,
  ContactImportResultRow,
  ContactListFilters,
  ContactRepository,
  ConversationRepository,
  CommercialActor,
  Opportunity,
  OpportunityHistoryEntry,
  OpportunityListFilters,
  Pipeline,
  PipelineStage,
  SalesRepository,
  TaskCommentRecord,
  TaskHistoryRecord,
  TaskListFilters,
  TaskRecord,
  TaskRepository,
  TaskStatus,
} from "@quantum-crm/domain";
import type { PoolClient } from "pg";

import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";
import { createConversationPostgresRepository } from "./conversation-postgres-repository.js";

interface VisibilityPredicate {
  readonly sql: string;
  readonly params: string[];
}

/**
 * Builds the only visibility predicates used by commercial repositories.
 * The scope is resolved from the authenticated membership in the database;
 * the client never supplies a scope or a team identifier.
 */
function visibility(
  actor: CommercialActor,
  memberPlaceholder: number,
  recordMembers: readonly string[],
  legacyOwnMembers = recordMembers,
): VisibilityPredicate {
  if (actor.scope === "PROFILE") return Object.freeze({ sql: "TRUE", params: [] });
  if (actor.scope === "TEAM") {
    const relation = recordMembers
      .map((member) => `record_team.member_id = ${member}`)
      .join(" OR ");
    return Object.freeze({
      sql: `EXISTS (
        SELECT 1
        FROM iam.team_members AS viewer_team
        JOIN iam.team_members AS record_team ON record_team.team_id = viewer_team.team_id
        WHERE viewer_team.member_id = $${memberPlaceholder}::uuid
          AND (${relation})
      )`,
      params: [actor.memberId],
    });
  }
  const members =
    actor.scope === "OWN" ? legacyOwnMembers : [recordMembers[recordMembers.length - 1]!];
  return Object.freeze({
    sql: `(${members.map((member) => `${member} = $${memberPlaceholder}::uuid`).join(" OR ")})`,
    params: [actor.memberId],
  });
}

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
interface AutomationRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly trigger_event: string;
  readonly action_type: string;
  readonly action_config: {
    readonly type: "CREATE_TASK";
    readonly title: string;
    readonly description: string;
    readonly priority: "LOW" | "MEDIUM" | "HIGH";
    readonly dueHours: number;
  };
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}
function automationFromRow(row: AutomationRow): AutomationDefinition {
  return Object.freeze({
    id: row.id,
    name: row.name,
    status: row.status.toUpperCase() as AutomationDefinition["status"],
    triggerEvent: "CONTACT_MANUAL",
    action: Object.freeze(row.action_config),
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
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
  if (
    error instanceof CommercialIdempotencyConflictError ||
    error instanceof AutomationNotFoundError ||
    error instanceof AutomationValidationError
  )
    throw error;
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
  readonly status: string;
  readonly close_reason: string | null;
  readonly closed_at: Date | null;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}
interface OpportunityHistoryRow {
  readonly id: string;
  readonly opportunity_id: string;
  readonly event_type: string;
  readonly actor_member_id: string;
  readonly previous_stage_id: string | null;
  readonly next_stage_id: string | null;
  readonly previous_owner_member_id: string | null;
  readonly next_owner_member_id: string | null;
  readonly previous_status: string | null;
  readonly next_status: string | null;
  readonly previous_amount_minor: string | null;
  readonly next_amount_minor: string | null;
  readonly note: string | null;
  readonly created_at: Date;
}
const opportunitySelection = `id::text, owner_member_id::text, contact_id::text, pipeline_id::text, stage_id::text, title, amount_minor::text, currency::text, status, close_reason, closed_at, version::text, created_at, updated_at`;
const opportunityHistorySelection = `id::text, opportunity_id::text, event_type, actor_member_id::text, previous_stage_id::text, next_stage_id::text, previous_owner_member_id::text, next_owner_member_id::text, previous_status, next_status, previous_amount_minor::text, next_amount_minor::text, note, created_at`;
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
  const status = (row.status ?? "open").toUpperCase();
  if (!(["OPEN", "WON", "LOST", "ABANDONED"] as const).includes(status as Opportunity["status"]))
    throw new DatabaseUnavailableError();
  return Object.freeze({
    id: row.id,
    ownerMemberId: row.owner_member_id,
    contactId: row.contact_id,
    pipelineId: row.pipeline_id,
    stageId: row.stage_id,
    title: row.title,
    amountMinor: BigInt(row.amount_minor),
    currency: row.currency,
    status: status as Opportunity["status"],
    closeReason: row.close_reason ?? null,
    closedAt: row.closed_at == null ? null : new Date(row.closed_at),
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}
function opportunityHistoryFromRow(row: OpportunityHistoryRow): OpportunityHistoryEntry {
  return Object.freeze({
    id: row.id,
    opportunityId: row.opportunity_id,
    eventType: row.event_type.toUpperCase() as OpportunityHistoryEntry["eventType"],
    actorMemberId: row.actor_member_id,
    previousStageId: row.previous_stage_id,
    nextStageId: row.next_stage_id,
    previousOwnerMemberId: row.previous_owner_member_id,
    nextOwnerMemberId: row.next_owner_member_id,
    previousStatus:
      row.previous_status === null
        ? null
        : (row.previous_status.toUpperCase() as NonNullable<
            OpportunityHistoryEntry["previousStatus"]
          >),
    nextStatus:
      row.next_status === null
        ? null
        : (row.next_status.toUpperCase() as NonNullable<OpportunityHistoryEntry["nextStatus"]>),
    previousAmountMinor:
      row.previous_amount_minor === null ? null : BigInt(row.previous_amount_minor),
    nextAmountMinor: row.next_amount_minor === null ? null : BigInt(row.next_amount_minor),
    note: row.note,
    createdAt: new Date(row.created_at),
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
  readonly type: string;
  readonly origin: string;
  readonly due_at: Date | null;
  readonly status: string;
  readonly completed_at: Date | null;
  readonly completed_by_member_id: string | null;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}
interface TaskCommentRow {
  readonly id: string;
  readonly task_id: string;
  readonly author_member_id: string;
  readonly body: string;
  readonly created_at: Date;
}
interface TaskHistoryRow {
  readonly id: string;
  readonly task_id: string;
  readonly event_type: string;
  readonly actor_member_id: string;
  readonly note: string | null;
  readonly created_at: Date;
}
const taskSelection = `id::text, created_by_member_id::text, contact_id::text, opportunity_id::text, assignee_member_id::text, title, description, priority, type, origin, due_at, status, completed_at, completed_by_member_id::text, version::text, created_at, updated_at`;
function taskFromRow(row: TaskRow): TaskRecord {
  if (row.priority !== "low" && row.priority !== "medium" && row.priority !== "high")
    throw new DatabaseUnavailableError();
  const status = row.status.toUpperCase() as TaskStatus;
  if (!["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED"].includes(status))
    throw new DatabaseUnavailableError();
  const type = row.type.toUpperCase() as TaskRecord["type"];
  const origin = row.origin.toUpperCase() as TaskRecord["origin"];
  if (!["CALL", "MESSAGE", "MEETING", "QUOTE", "COLLECTION", "OTHER"].includes(type))
    throw new DatabaseUnavailableError();
  if (!["MANUAL", "AUTOMATION", "AGENT"].includes(origin)) throw new DatabaseUnavailableError();
  return Object.freeze({
    id: row.id,
    createdByMemberId: row.created_by_member_id,
    contactId: row.contact_id,
    opportunityId: row.opportunity_id,
    assigneeMemberId: row.assignee_member_id,
    title: row.title,
    description: row.description,
    priority: row.priority.toUpperCase() as TaskRecord["priority"],
    type,
    origin,
    dueAt: row.due_at === null ? null : new Date(row.due_at),
    status,
    completedAt: row.completed_at === null ? null : new Date(row.completed_at),
    completedByMemberId: row.completed_by_member_id,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}
function taskCommentFromRow(row: TaskCommentRow): TaskCommentRecord {
  return Object.freeze({
    id: row.id,
    taskId: row.task_id,
    authorMemberId: row.author_member_id,
    body: row.body,
    createdAt: new Date(row.created_at),
  });
}
function taskHistoryFromRow(row: TaskHistoryRow): TaskHistoryRecord {
  const eventType = row.event_type.toUpperCase() as TaskHistoryRecord["eventType"];
  if (
    !["CREATED", "UPDATED", "ASSIGNEE_CHANGED", "STATUS_CHANGED", "COMMENTED"].includes(eventType)
  )
    throw new DatabaseUnavailableError();
  return Object.freeze({
    id: row.id,
    taskId: row.task_id,
    eventType,
    actorMemberId: row.actor_member_id,
    note: row.note,
    createdAt: new Date(row.created_at),
  });
}
async function lockTaskCommand(
  client: PoolClient,
  actorMemberId: string,
  command: string,
  idempotencyKey: string,
): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${actorMemberId}:${command}:${idempotencyKey}`,
  ]);
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
  readonly conversations: ConversationRepository;
  readonly sales: SalesRepository;
  readonly tasks: TaskRepository;
  readonly automation: AutomationRepository;
}

export function createCommercialPostgresRepositories(
  pool: PostgresPool,
): CommercialPostgresRepositories {
  const contacts: ContactRepository = Object.freeze<ContactRepository>({
    list: async (actor, filters: ContactListFilters = {}) => {
      try {
        const access = visibility(actor, 1, ["contact.owner_member_id"]);
        const params: unknown[] = [...access.params];
        const conditions = [access.sql];
        const parameter = (value: unknown): string => {
          params.push(value);
          return `$${params.length}`;
        };
        if (filters.label !== undefined) {
          const label = parameter(filters.label);
          conditions.push(
            `EXISTS (SELECT 1 FROM contacts.contact_labels AS contact_label JOIN contacts.labels AS label ON label.id = contact_label.label_id WHERE contact_label.contact_id = contact.id AND lower(label.name) = lower(${label}))`,
          );
        }
        if (filters.pipelineId !== undefined) {
          const pipeline = parameter(filters.pipelineId);
          const opportunityAccess = visibility(actor, 1, ["opportunity.owner_member_id"]);
          conditions.push(
            `EXISTS (SELECT 1 FROM sales.opportunities AS opportunity WHERE opportunity.contact_id = contact.id AND opportunity.pipeline_id = ${pipeline}::uuid AND ${opportunityAccess.sql})`,
          );
        }
        if (filters.ownerMemberId !== undefined) {
          const owner = parameter(filters.ownerMemberId);
          conditions.push(`contact.owner_member_id = ${owner}::uuid`);
        }
        if (filters.channel === "EMAIL") conditions.push("contact.email IS NOT NULL");
        if (filters.channel === "PHONE") conditions.push("contact.phone IS NOT NULL");
        if (filters.channel === "NONE") {
          conditions.push("contact.email IS NULL AND contact.phone IS NULL");
        }
        if (filters.createdFrom !== undefined) {
          const createdFrom = parameter(filters.createdFrom);
          conditions.push(`contact.created_at >= ${createdFrom}::timestamptz`);
        }
        if (filters.createdTo !== undefined) {
          const createdTo = parameter(filters.createdTo);
          conditions.push(`contact.created_at <= ${createdTo}::timestamptz`);
        }
        const result = (await pool.query(
          `SELECT ${contactSelection} FROM contacts.contacts AS contact WHERE ${conditions.join(" AND ")} ORDER BY contact.created_at DESC, contact.id DESC`,
          params,
        )) as { readonly rows: readonly ContactRow[] };
        return Object.freeze(result.rows.map(contactFromRow));
      } catch (error) {
        return fail(error);
      }
    },
    find: async (actor, id) => {
      try {
        const access = visibility(actor, 2, ["contact.owner_member_id"]);
        const result = (await pool.query(
          `SELECT ${contactSelection} FROM contacts.contacts AS contact WHERE contact.id = $1::uuid AND ${access.sql}`,
          [id, ...access.params],
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
        const access = visibility(input.actor, 7, ["contact.owner_member_id"]);
        const result = (await pool.query(
          `UPDATE contacts.contacts AS contact SET display_name = $2, email = $3, phone = $4, version = version + 1, updated_at = $5 WHERE contact.id = $1::uuid AND contact.version = $6::bigint AND ${access.sql} RETURNING ${contactSelection}`,
          [
            input.contact.id,
            input.contact.displayName,
            input.contact.email,
            input.contact.phone,
            input.contact.updatedAt,
            input.expectedVersion.toString(),
            ...access.params,
          ],
        )) as { readonly rows: readonly ContactRow[] };
        const row = result.rows[0];
        return row ? contactFromRow(row) : null;
      } catch (error) {
        return fail(error);
      }
    },
    importRows: async (input): Promise<ContactImportResult> => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const existing = await client.query<{
          readonly payload_hash: string;
          readonly response: ContactImportResult;
        }>(
          `SELECT payload_hash, response FROM contacts.command_idempotency WHERE actor_member_id = $1::uuid AND command = 'contacts.import' AND idempotency_key = $2 FOR UPDATE`,
          [input.actor.memberId, input.operationKey],
        );
        const replay = existing.rows[0];
        if (replay) {
          if (replay.payload_hash !== input.payloadHash)
            throw new CommercialIdempotencyConflictError();
          await client.query("COMMIT");
          return replay.response;
        }
        const rows: ContactImportResultRow[] = [];
        let created = 0;
        let updated = 0;
        for (const row of input.rows) {
          const email = row.email?.trim().toLowerCase() || null;
          const phone = row.phone?.trim() || null;
          const found = await client.query<ContactRow>(
            `SELECT ${contactSelection}
               FROM contacts.contacts AS contact
              WHERE ${visibility(input.actor, 1, ["contact.owner_member_id"]).sql}
                AND (($2::citext IS NOT NULL AND contact.email = $2::citext)
                  OR ($3::text IS NOT NULL AND contact.phone = $3::text))
              ORDER BY contact.id ASC
              LIMIT 1
              FOR UPDATE`,
            [input.actor.memberId, email, phone],
          );
          const match = found.rows[0];
          let result: ContactImportResultRow;
          if (match) {
            const changed = await client.query<ContactRow>(
              `UPDATE contacts.contacts
                  SET display_name = $2, email = $3::citext, phone = $4, version = version + 1,
                      updated_at = CURRENT_TIMESTAMP
                WHERE id = $1::uuid
                RETURNING ${contactSelection}`,
              [match.id, row.displayName.trim(), email, phone],
            );
            const updatedRow = changed.rows[0];
            if (!updatedRow) throw new DatabaseUnavailableError();
            updated += 1;
            result = {
              ...row,
              email,
              phone,
              status: "UPDATED",
              contactId: updatedRow.id,
              errors: [],
            };
          } else {
            const inserted = await client.query<ContactRow>(
              `INSERT INTO contacts.contacts (id, owner_member_id, display_name, email, phone, version, created_at, updated_at)
               VALUES ($1::uuid, $2::uuid, $3, $4::citext, $5, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               RETURNING ${contactSelection}`,
              [randomUUID(), input.actor.memberId, row.displayName.trim(), email, phone],
            );
            const insertedRow = inserted.rows[0];
            if (!insertedRow) throw new DatabaseUnavailableError();
            created += 1;
            result = {
              ...row,
              email,
              phone,
              status: "CREATED",
              contactId: insertedRow.id,
              errors: [],
            };
          }
          rows.push(result);
        }
        const response: ContactImportResult = { rows, created, updated, errors: 0 };
        await client.query(
          `INSERT INTO contacts.command_idempotency (actor_member_id, command, idempotency_key, payload_hash, response)
           VALUES ($1::uuid, 'contacts.import', $2, $3, $4::jsonb)`,
          [input.actor.memberId, input.operationKey, input.payloadHash, JSON.stringify(response)],
        );
        await client.query("COMMIT");
        return response;
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
  });
  const automation: AutomationRepository = Object.freeze<AutomationRepository>({
    list: async () => {
      try {
        const result = (await pool.query(
          `SELECT id::text, name, status, trigger_event, action_type, action_config, version::text, created_at, updated_at FROM automation.definitions ORDER BY created_at ASC, id ASC`,
        )) as { readonly rows: readonly AutomationRow[] };
        return Object.freeze(result.rows.map(automationFromRow));
      } catch (error) {
        return fail(error);
      }
    },
    create: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const previous = await client.query<{
          readonly payload_hash: string;
          readonly response: AutomationRow;
        }>(
          `SELECT payload_hash, response FROM automation.command_idempotency WHERE actor_member_id = $1::uuid AND command = 'automation.create' AND idempotency_key = $2 FOR UPDATE`,
          [input.actor.memberId, input.idempotencyKey],
        );
        const replay = previous.rows[0];
        if (replay) {
          if (replay.payload_hash !== input.payloadHash)
            throw new CommercialIdempotencyConflictError();
          await client.query("COMMIT");
          return automationFromRow(replay.response);
        }
        const inserted = await client.query<AutomationRow>(
          `INSERT INTO automation.definitions (id, name, status, trigger_event, action_type, action_config, version, created_at, updated_at)
           VALUES ($1::uuid, $2, $3, 'CONTACT_MANUAL', 'CREATE_TASK', $4::jsonb, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING id::text, name, status, trigger_event, action_type, action_config, version::text, created_at, updated_at`,
          [
            input.automation.id,
            input.automation.name,
            input.automation.status.toLowerCase(),
            JSON.stringify(input.automation.action),
          ],
        );
        const row = inserted.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await client.query(
          `INSERT INTO automation.command_idempotency (actor_member_id, command, idempotency_key, payload_hash, response) VALUES ($1::uuid, 'automation.create', $2, $3, $4::jsonb)`,
          [input.actor.memberId, input.idempotencyKey, input.payloadHash, JSON.stringify(row)],
        );
        await client.query("COMMIT");
        return automationFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    activate: async (input): Promise<AutomationActivationResult> => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const previous = await client.query<{
          readonly payload_hash: string;
          readonly response: AutomationActivationResult;
        }>(
          `SELECT payload_hash, response FROM automation.command_idempotency WHERE actor_member_id = $1::uuid AND command = 'automation.activate' AND idempotency_key = $2 FOR UPDATE`,
          [input.actor.memberId, input.operationKey],
        );
        const replay = previous.rows[0];
        if (replay) {
          if (replay.payload_hash !== input.payloadHash)
            throw new CommercialIdempotencyConflictError();
          await client.query("COMMIT");
          return replay.response;
        }
        const definition = await client.query<AutomationRow>(
          `SELECT id::text, name, status, trigger_event, action_type, action_config, version::text, created_at, updated_at FROM automation.definitions WHERE id = $1::uuid FOR UPDATE`,
          [input.automationId],
        );
        const automationRow = definition.rows[0];
        if (!automationRow || automationRow.status !== "active")
          throw new AutomationNotFoundError();
        const action = automationRow.action_config;
        const results: AutomationExecutionResult[] = [];
        for (const contactId of [...new Set(input.contactIds)]) {
          const executionId = randomUUID();
          const contactAccess = visibility(input.actor, 1, ["contact.owner_member_id"]);
          const contact = await client.query<{
            readonly id: string;
            readonly owner_member_id: string;
          }>(
            `SELECT contact.id::text, contact.owner_member_id::text FROM contacts.contacts AS contact WHERE contact.id = $2::uuid AND ${contactAccess.sql} FOR UPDATE`,
            [input.actor.memberId, contactId],
          );
          const contactRow = contact.rows[0];
          if (!contactRow) {
            await client.query(
              `INSERT INTO automation.executions (id, definition_id, contact_id, actor_member_id, operation_key, status, error_code, completed_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'FAILED', 'CONTACT_NOT_VISIBLE', CURRENT_TIMESTAMP)`,
              [
                executionId,
                input.automationId,
                contactId,
                input.actor.memberId,
                input.operationKey,
              ],
            );
            results.push({
              executionId,
              contactId,
              status: "FAILED",
              taskId: null,
              errorCode: "CONTACT_NOT_VISIBLE",
            });
            continue;
          }
          const member = await client.query<{ readonly status: string }>(
            `SELECT status::text FROM iam.members WHERE id = $1::uuid`,
            [contactRow.owner_member_id],
          );
          if (member.rows[0]?.status !== "active") {
            await client.query(
              `INSERT INTO automation.executions (id, definition_id, contact_id, actor_member_id, operation_key, status, error_code, completed_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'FAILED', 'OWNER_INACTIVE', CURRENT_TIMESTAMP)`,
              [
                executionId,
                input.automationId,
                contactId,
                input.actor.memberId,
                input.operationKey,
              ],
            );
            results.push({
              executionId,
              contactId,
              status: "FAILED",
              taskId: null,
              errorCode: "OWNER_INACTIVE",
            });
            continue;
          }
          await client.query(
            `INSERT INTO automation.executions (id, definition_id, contact_id, actor_member_id, operation_key, status) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'PENDING')`,
            [executionId, input.automationId, contactId, input.actor.memberId, input.operationKey],
          );
          const taskId = randomUUID();
          const createdAt = new Date();
          const dueAt = new Date(createdAt.getTime() + action.dueHours * 60 * 60 * 1000);
          await client.query(
            `INSERT INTO tasks.tasks (id, created_by_member_id, contact_id, opportunity_id, assignee_member_id, title, description, priority, due_at, status, version, created_at, updated_at)
             VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, $4::uuid, $5, $6, $7, $8, 'pending', 1, $9, $9)`,
            [
              taskId,
              input.actor.memberId,
              contactId,
              contactRow.owner_member_id,
              action.title,
              action.description,
              action.priority.toLowerCase(),
              dueAt,
              createdAt,
            ],
          );
          await client.query(
            `UPDATE automation.executions SET status = 'SUCCEEDED', task_id = $2::uuid, result = $3::jsonb, completed_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
            [executionId, taskId, JSON.stringify({ taskId })],
          );
          results.push({ executionId, contactId, status: "SUCCEEDED", taskId, errorCode: null });
        }
        const response: AutomationActivationResult = {
          automationId: input.automationId,
          operationKey: input.operationKey,
          results,
          succeeded: results.filter((result) => result.status === "SUCCEEDED").length,
          failed: results.filter((result) => result.status === "FAILED").length,
        };
        await client.query(
          `INSERT INTO automation.command_idempotency (actor_member_id, command, idempotency_key, payload_hash, response) VALUES ($1::uuid, 'automation.activate', $2, $3, $4::jsonb)`,
          [input.actor.memberId, input.operationKey, input.payloadHash, JSON.stringify(response)],
        );
        await client.query("COMMIT");
        return response;
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
  });

  const sales: SalesRepository = Object.freeze<SalesRepository>({
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
    listOpportunities: async (actor, filters: OpportunityListFilters = {}) => {
      try {
        const access = visibility(actor, 1, ["opportunity.owner_member_id"]);
        const params: unknown[] = [...access.params];
        const conditions = [access.sql];
        const parameter = (value: unknown): string => {
          params.push(value);
          return `$${params.length}`;
        };
        if (filters.contactId !== undefined)
          conditions.push(`opportunity.contact_id = ${parameter(filters.contactId)}::uuid`);
        if (filters.pipelineId !== undefined)
          conditions.push(`opportunity.pipeline_id = ${parameter(filters.pipelineId)}::uuid`);
        if (filters.stageId !== undefined)
          conditions.push(`opportunity.stage_id = ${parameter(filters.stageId)}::uuid`);
        if (filters.ownerMemberId !== undefined)
          conditions.push(
            `opportunity.owner_member_id = ${parameter(filters.ownerMemberId)}::uuid`,
          );
        if (filters.status !== undefined)
          conditions.push(`opportunity.status = ${parameter(filters.status.toLowerCase())}`);
        if (filters.label !== undefined) {
          const label = parameter(filters.label);
          conditions.push(
            `EXISTS (SELECT 1 FROM contacts.contact_labels AS contact_label JOIN contacts.labels AS label ON label.id = contact_label.label_id WHERE contact_label.contact_id = opportunity.contact_id AND lower(label.name) = lower(${label}))`,
          );
        }
        if (filters.createdFrom !== undefined)
          conditions.push(
            `opportunity.created_at >= ${parameter(filters.createdFrom)}::timestamptz`,
          );
        if (filters.createdTo !== undefined)
          conditions.push(`opportunity.created_at <= ${parameter(filters.createdTo)}::timestamptz`);
        const result = (await pool.query(
          `SELECT ${opportunitySelection} FROM sales.opportunities AS opportunity WHERE ${conditions.join(" AND ")} ORDER BY opportunity.updated_at DESC, opportunity.id DESC`,
          params,
        )) as { readonly rows: readonly OpportunityRow[] };
        return Object.freeze(result.rows.map(opportunityFromRow));
      } catch (error) {
        return fail(error);
      }
    },
    findOpportunity: async (actor, id) => {
      try {
        const access = visibility(actor, 2, ["opportunity.owner_member_id"]);
        const result = (await pool.query(
          `SELECT ${opportunitySelection} FROM sales.opportunities AS opportunity WHERE opportunity.id = $1::uuid AND ${access.sql}`,
          [id, ...access.params],
        )) as { readonly rows: readonly OpportunityRow[] };
        const row = result.rows[0];
        return row ? opportunityFromRow(row) : null;
      } catch (error) {
        return fail(error);
      }
    },
    listOpportunityHistory: async (actor, id) => {
      try {
        const access = visibility(actor, 2, ["opportunity.owner_member_id"]);
        const result = (await pool.query(
          `SELECT ${opportunityHistorySelection}
             FROM sales.opportunity_history AS history
            WHERE history.opportunity_id = $1::uuid
              AND EXISTS (
                SELECT 1 FROM sales.opportunities AS opportunity
                 WHERE opportunity.id = history.opportunity_id AND ${access.sql}
              )
            ORDER BY history.created_at DESC, history.id DESC`,
          [id, ...access.params],
        )) as { readonly rows: readonly OpportunityHistoryRow[] };
        return Object.freeze(result.rows.map(opportunityHistoryFromRow));
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
          `INSERT INTO sales.opportunities (id, owner_member_id, contact_id, pipeline_id, stage_id, title, amount_minor, currency, status, close_reason, closed_at, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7::bigint, $8, $9, $10, $11, $12::bigint, $13, $14) RETURNING ${opportunitySelection}`,
          [
            input.opportunity.id,
            input.opportunity.ownerMemberId,
            input.opportunity.contactId,
            input.opportunity.pipelineId,
            input.opportunity.stageId,
            input.opportunity.title,
            input.opportunity.amountMinor.toString(),
            input.opportunity.currency,
            input.opportunity.status.toLowerCase(),
            input.opportunity.closeReason,
            input.opportunity.closedAt,
            input.opportunity.version.toString(),
            input.opportunity.createdAt,
            input.opportunity.updatedAt,
          ],
        );
        const row = inserted.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await client.query(
          `INSERT INTO sales.opportunity_history (opportunity_id, event_type, actor_member_id, next_stage_id, next_owner_member_id, next_status, next_amount_minor) VALUES ($1::uuid, 'created', $2::uuid, $3::uuid, $4::uuid, $5, $6::bigint)`,
          [
            row.id,
            input.actor.memberId,
            row.stage_id,
            row.owner_member_id,
            row.status,
            row.amount_minor,
          ],
        );
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
        const access = visibility(input.actor, 5, ["opportunity.owner_member_id"]);
        const readAccess = visibility(input.actor, 3, ["opportunity.owner_member_id"]);
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
        const beforeResult = await client.query<OpportunityRow>(
          `SELECT ${opportunitySelection} FROM sales.opportunities AS opportunity WHERE opportunity.id = $1::uuid AND opportunity.version = $2::bigint AND ${readAccess.sql} FOR UPDATE`,
          [input.id, input.expectedVersion.toString(), ...readAccess.params],
        );
        const before = beforeResult.rows[0];
        if (!before) {
          await client.query("COMMIT");
          return null;
        }
        const result = await client.query<OpportunityRow>(
          `UPDATE sales.opportunities AS opportunity SET stage_id = $2::uuid, version = version + 1, updated_at = $3 WHERE opportunity.id = $1::uuid AND opportunity.version = $4::bigint AND ${access.sql} RETURNING ${opportunitySelection}`,
          [input.id, input.stageId, input.now, input.expectedVersion.toString(), ...access.params],
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        await client.query(
          `INSERT INTO sales.opportunity_history (opportunity_id, event_type, actor_member_id, previous_stage_id, next_stage_id, previous_owner_member_id, next_owner_member_id, previous_status, next_status, previous_amount_minor, next_amount_minor) VALUES ($1::uuid, 'stage_changed', $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7, $8, $9::bigint, $10::bigint)`,
          [
            row.id,
            input.actor.memberId,
            before.stage_id,
            row.stage_id,
            before.owner_member_id,
            row.owner_member_id,
            before.status,
            row.status,
            before.amount_minor,
            row.amount_minor,
          ],
        );
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
    updateOpportunity: async (input) => {
      let client: PoolClient | undefined;
      try {
        const access = visibility(input.actor, 3, ["opportunity.owner_member_id"]);
        client = await pool.connect();
        await client.query("BEGIN");
        const replay = await client.query<{
          readonly payload_hash: string;
          readonly response: OpportunityRow;
        }>(
          `SELECT payload_hash, response FROM sales.command_idempotency WHERE actor_member_id = $1::uuid AND command = 'sales.opportunity.update' AND idempotency_key = $2 FOR UPDATE`,
          [input.actor.memberId, input.idempotencyKey],
        );
        const previous = replay.rows[0];
        if (previous) {
          if (previous.payload_hash !== input.payloadHash)
            throw new CommercialIdempotencyConflictError();
          await client.query("COMMIT");
          return opportunityFromRow(previous.response);
        }
        const beforeResult = await client.query<OpportunityRow>(
          `SELECT ${opportunitySelection} FROM sales.opportunities AS opportunity WHERE opportunity.id = $1::uuid AND opportunity.version = $2::bigint AND ${access.sql} FOR UPDATE`,
          [input.opportunity.id, input.expectedVersion.toString(), ...access.params],
        );
        const before = beforeResult.rows[0];
        if (!before) {
          await client.query("COMMIT");
          return null;
        }
        const result = await client.query<OpportunityRow>(
          `UPDATE sales.opportunities AS opportunity
              SET owner_member_id = $2::uuid, title = $3, amount_minor = $4::bigint,
                  currency = $5, status = $6, close_reason = $7, closed_at = $8,
                  version = version + 1, updated_at = $9
            WHERE opportunity.id = $1::uuid AND opportunity.version = $10::bigint
            RETURNING ${opportunitySelection}`,
          [
            input.opportunity.id,
            input.opportunity.ownerMemberId,
            input.opportunity.title,
            input.opportunity.amountMinor.toString(),
            input.opportunity.currency,
            input.opportunity.status.toLowerCase(),
            input.opportunity.closeReason,
            input.opportunity.closedAt,
            input.opportunity.updatedAt,
            input.expectedVersion.toString(),
          ],
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        const eventType =
          before.status !== row.status
            ? "status_changed"
            : before.owner_member_id !== row.owner_member_id
              ? "owner_changed"
              : "updated";
        await client.query(
          `INSERT INTO sales.opportunity_history (opportunity_id, event_type, actor_member_id, previous_stage_id, next_stage_id, previous_owner_member_id, next_owner_member_id, previous_status, next_status, previous_amount_minor, next_amount_minor, note) VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8, $9, $10::bigint, $11::bigint, $12)`,
          [
            row.id,
            eventType,
            input.actor.memberId,
            before.stage_id,
            row.stage_id,
            before.owner_member_id,
            row.owner_member_id,
            before.status,
            row.status,
            before.amount_minor,
            row.amount_minor,
            row.close_reason,
          ],
        );
        await client.query(
          `INSERT INTO sales.command_idempotency (actor_member_id, command, idempotency_key, payload_hash, response) VALUES ($1::uuid, 'sales.opportunity.update', $2, $3, $4::jsonb)`,
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
  const tasks: TaskRepository = Object.freeze<TaskRepository>({
    list: async (actor, filters: TaskListFilters = {}, now) => {
      try {
        const effectiveNow = now ?? new Date();
        if (Number.isNaN(effectiveNow.getTime())) throw new DatabaseUnavailableError();
        const access = visibility(actor, 1, [
          "task.created_by_member_id",
          "task.assignee_member_id",
        ]);
        const params: unknown[] = [...access.params];
        const conditions = [access.sql];
        const parameter = (value: unknown): string => {
          params.push(value);
          return `$${params.length}`;
        };
        if (filters.contactId !== undefined)
          conditions.push(`task.contact_id = ${parameter(filters.contactId)}::uuid`);
        if (filters.opportunityId !== undefined)
          conditions.push(`task.opportunity_id = ${parameter(filters.opportunityId)}::uuid`);
        if (filters.assigneeMemberId !== undefined)
          conditions.push(`task.assignee_member_id = ${parameter(filters.assigneeMemberId)}::uuid`);
        if (filters.priority !== undefined)
          conditions.push(`task.priority = ${parameter(filters.priority.toLowerCase())}`);
        if (filters.type !== undefined)
          conditions.push(`task.type = ${parameter(filters.type.toLowerCase())}`);
        if (filters.status !== undefined) {
          if (filters.status === "EXPIRED") {
            const at = parameter(effectiveNow);
            conditions.push(
              `task.status IN ('pending', 'in_progress') AND task.due_at IS NOT NULL AND task.due_at <= ${at}::timestamptz`,
            );
          } else {
            conditions.push(`task.status = ${parameter(filters.status.toLowerCase())}`);
            if (filters.status === "PENDING" || filters.status === "IN_PROGRESS") {
              const at = parameter(effectiveNow);
              conditions.push(`(task.due_at IS NULL OR task.due_at > ${at}::timestamptz)`);
            }
          }
        }
        if (filters.dueFrom !== undefined)
          conditions.push(`task.due_at >= ${parameter(filters.dueFrom)}::timestamptz`);
        if (filters.dueTo !== undefined)
          conditions.push(`task.due_at <= ${parameter(filters.dueTo)}::timestamptz`);
        const result = (await pool.query(
          `SELECT ${taskSelection}
             FROM tasks.tasks AS task
            WHERE ${conditions.join(" AND ")}
            ORDER BY task.due_at ASC NULLS LAST, task.id DESC
            LIMIT 200`,
          params,
        )) as { readonly rows: readonly TaskRow[] };
        return Object.freeze(result.rows.map(taskFromRow));
      } catch (error) {
        return fail(error);
      }
    },
    find: async (actor, id) => {
      try {
        const access = visibility(actor, 2, [
          "task.created_by_member_id",
          "task.assignee_member_id",
        ]);
        const result = (await pool.query(
          `SELECT ${taskSelection} FROM tasks.tasks AS task WHERE task.id = $1::uuid AND ${access.sql}`,
          [id, ...access.params],
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
        await lockTaskCommand(client, input.actor.memberId, "tasks.create", input.idempotencyKey);
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
          `INSERT INTO tasks.tasks (
             id, created_by_member_id, contact_id, opportunity_id, assignee_member_id,
             title, description, priority, type, origin, due_at, status,
             completed_at, completed_by_member_id, version, created_at, updated_at
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
             $6, $7, $8, $9, $10, $11, 'pending', NULL, NULL, $12::bigint, $13, $14
           ) RETURNING ${taskSelection}`,
          [
            input.task.id,
            input.task.createdByMemberId,
            input.task.contactId,
            input.task.opportunityId,
            input.task.assigneeMemberId,
            input.task.title,
            input.task.description,
            input.task.priority.toLowerCase(),
            input.task.type.toLowerCase(),
            input.task.origin.toLowerCase(),
            input.task.dueAt,
            input.task.version.toString(),
            input.task.createdAt,
            input.task.updatedAt,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await client.query(
          `INSERT INTO tasks.history (task_id, event_type, actor_member_id, note, created_at)
           VALUES ($1::uuid, 'created', $2::uuid, $3, $4)`,
          [row.id, input.actor.memberId, "Tarea creada", row.created_at],
        );
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
        const access = visibility(input.actor, 3, [
          "task.created_by_member_id",
          "task.assignee_member_id",
        ]);
        client = await pool.connect();
        await client.query("BEGIN");
        await lockTaskCommand(
          client,
          input.actor.memberId,
          "tasks.status.update",
          input.idempotencyKey,
        );
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
        const beforeResult = await client.query<TaskRow>(
          `SELECT ${taskSelection}
             FROM tasks.tasks AS task
            WHERE task.id = $1::uuid
              AND task.version = $2::bigint
              AND task.status IN ('pending', 'in_progress')
              AND ${access.sql}
            FOR UPDATE`,
          [input.id, input.expectedVersion.toString(), ...access.params],
        );
        const before = beforeResult.rows[0];
        if (!before) {
          await client.query("COMMIT");
          return null;
        }
        const result = await client.query<TaskRow>(
          `UPDATE tasks.tasks AS task
              SET status = $2,
                  completed_at = CASE WHEN $2 IN ('completed', 'cancelled') THEN $3 ELSE NULL END,
                  completed_by_member_id = CASE WHEN $2 IN ('completed', 'cancelled') THEN $4::uuid ELSE NULL END,
                  version = version + 1,
                  updated_at = $3
            WHERE task.id = $1::uuid
              AND task.version = $5::bigint
              AND task.status IN ('pending', 'in_progress')
            RETURNING ${taskSelection}`,
          [
            input.id,
            input.status.toLowerCase(),
            input.now,
            input.actor.memberId,
            input.expectedVersion.toString(),
          ],
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        await client.query(
          `INSERT INTO tasks.history (task_id, event_type, actor_member_id, note, created_at)
           VALUES ($1::uuid, 'status_changed', $2::uuid, $3, $4)`,
          [
            row.id,
            input.actor.memberId,
            `${before.status.toUpperCase()} -> ${row.status.toUpperCase()}`,
            input.now,
          ],
        );
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
    update: async (input) => {
      let client: PoolClient | undefined;
      try {
        const access = visibility(input.actor, 3, [
          "task.created_by_member_id",
          "task.assignee_member_id",
        ]);
        client = await pool.connect();
        await client.query("BEGIN");
        await lockTaskCommand(client, input.actor.memberId, "tasks.update", input.idempotencyKey);
        const replay = await client.query<{
          readonly payload_hash: string;
          readonly response: TaskRow;
        }>(
          `SELECT payload_hash, response
             FROM tasks.command_idempotency
            WHERE actor_member_id = $1::uuid
              AND command = 'tasks.update'
              AND idempotency_key = $2
            FOR UPDATE`,
          [input.actor.memberId, input.idempotencyKey],
        );
        const previous = replay.rows[0];
        if (previous) {
          if (previous.payload_hash !== input.payloadHash)
            throw new CommercialIdempotencyConflictError();
          await client.query("COMMIT");
          return taskFromRow(previous.response);
        }
        const beforeResult = await client.query<TaskRow>(
          `SELECT ${taskSelection}
             FROM tasks.tasks AS task
            WHERE task.id = $1::uuid
              AND task.version = $2::bigint
              AND ${access.sql}
            FOR UPDATE`,
          [input.id, input.expectedVersion.toString(), ...access.params],
        );
        const before = beforeResult.rows[0];
        if (!before) {
          await client.query("COMMIT");
          return null;
        }
        const result = await client.query<TaskRow>(
          `UPDATE tasks.tasks AS task
              SET assignee_member_id = CASE WHEN $2::boolean THEN $3::uuid ELSE task.assignee_member_id END,
                  title = CASE WHEN $4::boolean THEN $5 ELSE task.title END,
                  description = CASE WHEN $6::boolean THEN $7 ELSE task.description END,
                  priority = CASE WHEN $8::boolean THEN $9 ELSE task.priority END,
                  type = CASE WHEN $10::boolean THEN $11 ELSE task.type END,
                  due_at = CASE WHEN $12::boolean THEN $13::timestamptz ELSE task.due_at END,
                  version = version + 1,
                  updated_at = $14
            WHERE task.id = $1::uuid AND task.version = $15::bigint
            RETURNING ${taskSelection}`,
          [
            input.id,
            input.patch.assigneeMemberId !== undefined,
            input.patch.assigneeMemberId ?? null,
            input.patch.title !== undefined,
            input.patch.title ?? null,
            input.patch.description !== undefined,
            input.patch.description ?? null,
            input.patch.priority !== undefined,
            input.patch.priority?.toLowerCase() ?? null,
            input.patch.type !== undefined,
            input.patch.type?.toLowerCase() ?? null,
            input.patch.dueAt !== undefined,
            input.patch.dueAt ?? null,
            input.now,
            input.expectedVersion.toString(),
          ],
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        const assigneeChanged = before.assignee_member_id !== row.assignee_member_id;
        const updatedFields = [
          before.title === row.title ? null : "title",
          before.description === row.description ? null : "description",
          before.priority === row.priority ? null : "priority",
          before.type === row.type ? null : "type",
          before.due_at?.getTime() === row.due_at?.getTime() ? null : "dueAt",
        ].filter((field): field is string => field !== null);
        if (assigneeChanged)
          await client.query(
            `INSERT INTO tasks.history (task_id, event_type, actor_member_id, note, created_at)
             VALUES ($1::uuid, 'assignee_changed', $2::uuid, $3, $4)`,
            [
              row.id,
              input.actor.memberId,
              `${before.assignee_member_id} -> ${row.assignee_member_id}`,
              input.now,
            ],
          );
        if (updatedFields.length > 0 || !assigneeChanged)
          await client.query(
            `INSERT INTO tasks.history (task_id, event_type, actor_member_id, note, created_at)
             VALUES ($1::uuid, 'updated', $2::uuid, $3, $4)`,
            [
              row.id,
              input.actor.memberId,
              updatedFields.length > 0
                ? `Campos actualizados: ${updatedFields.join(", ")}`
                : "Actualizacion confirmada sin cambios de valor",
              input.now,
            ],
          );
        await client.query(
          `INSERT INTO tasks.command_idempotency
             (actor_member_id, command, idempotency_key, payload_hash, response)
           VALUES ($1::uuid, 'tasks.update', $2, $3, $4::jsonb)`,
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
    addComment: async (input) => {
      let client: PoolClient | undefined;
      try {
        const access = visibility(input.actor, 2, [
          "task.created_by_member_id",
          "task.assignee_member_id",
        ]);
        client = await pool.connect();
        await client.query("BEGIN");
        await lockTaskCommand(
          client,
          input.actor.memberId,
          "tasks.comment.create",
          input.idempotencyKey,
        );
        const replay = await client.query<{
          readonly payload_hash: string;
          readonly response: TaskCommentRow;
        }>(
          `SELECT payload_hash, response
             FROM tasks.command_idempotency
            WHERE actor_member_id = $1::uuid
              AND command = 'tasks.comment.create'
              AND idempotency_key = $2
            FOR UPDATE`,
          [input.actor.memberId, input.idempotencyKey],
        );
        const previous = replay.rows[0];
        if (previous) {
          if (previous.payload_hash !== input.payloadHash)
            throw new CommercialIdempotencyConflictError();
          await client.query("COMMIT");
          return taskCommentFromRow(previous.response);
        }
        const visible = await client.query<{ readonly id: string }>(
          `SELECT task.id::text
             FROM tasks.tasks AS task
            WHERE task.id = $1::uuid AND ${access.sql}
            FOR UPDATE`,
          [input.taskId, ...access.params],
        );
        if (!visible.rows[0]) throw new DatabaseUnavailableError();
        const result = await client.query<TaskCommentRow>(
          `INSERT INTO tasks.comments (id, task_id, author_member_id, body, created_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
           RETURNING id::text, task_id::text, author_member_id::text, body, created_at`,
          [
            input.comment.id,
            input.taskId,
            input.comment.authorMemberId,
            input.comment.body,
            input.comment.createdAt,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await client.query(
          `INSERT INTO tasks.history (task_id, event_type, actor_member_id, note, created_at)
           VALUES ($1::uuid, 'commented', $2::uuid, $3, $4)`,
          [input.taskId, input.actor.memberId, "Comentario interno agregado", row.created_at],
        );
        await client.query(
          `INSERT INTO tasks.command_idempotency
             (actor_member_id, command, idempotency_key, payload_hash, response)
           VALUES ($1::uuid, 'tasks.comment.create', $2, $3, $4::jsonb)`,
          [input.actor.memberId, input.idempotencyKey, input.payloadHash, JSON.stringify(row)],
        );
        await client.query("COMMIT");
        return taskCommentFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    listComments: async (actor, taskId) => {
      try {
        const access = visibility(actor, 2, [
          "task.created_by_member_id",
          "task.assignee_member_id",
        ]);
        const result = (await pool.query(
          `SELECT comment.id::text, comment.task_id::text, comment.author_member_id::text,
                  comment.body, comment.created_at
             FROM tasks.comments AS comment
             JOIN tasks.tasks AS task ON task.id = comment.task_id
            WHERE task.id = $1::uuid AND ${access.sql}
            ORDER BY comment.created_at ASC, comment.id ASC
            LIMIT 500`,
          [taskId, ...access.params],
        )) as { readonly rows: readonly TaskCommentRow[] };
        return Object.freeze(result.rows.map(taskCommentFromRow));
      } catch (error) {
        return fail(error);
      }
    },
    listHistory: async (actor, taskId) => {
      try {
        const access = visibility(actor, 2, [
          "task.created_by_member_id",
          "task.assignee_member_id",
        ]);
        const result = (await pool.query(
          `SELECT history.id::text, history.task_id::text, history.event_type,
                  history.actor_member_id::text, history.note, history.created_at
             FROM tasks.history AS history
             JOIN tasks.tasks AS task ON task.id = history.task_id
            WHERE task.id = $1::uuid AND ${access.sql}
            ORDER BY history.created_at DESC, history.id DESC
            LIMIT 500`,
          [taskId, ...access.params],
        )) as { readonly rows: readonly TaskHistoryRow[] };
        return Object.freeze(result.rows.map(taskHistoryFromRow));
      } catch (error) {
        return fail(error);
      }
    },
  });
  return Object.freeze({
    contacts,
    conversations: createConversationPostgresRepository(pool),
    sales,
    tasks,
    automation,
  });
}
