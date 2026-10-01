import type {
  CommercialActor,
  CommercialDocumentRecord,
  DocumentBlock,
  DocumentDesign,
  DocumentRepository,
  DocumentTemplateRecord,
} from "@quantum-crm/domain";
import type { PoolClient } from "pg";

import { CommercialIdempotencyConflictError } from "./commercial-postgres-database.js";
import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

interface DocumentRow {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly title: string;
  readonly contact_id: string | null;
  readonly opportunity_id: string | null;
  readonly owner_member_id: string;
  readonly source_template_id: string | null;
  readonly blocks: unknown;
  readonly design: unknown;
  readonly revision: number;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface TemplateRow {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly blocks: unknown;
  readonly design: unknown;
  readonly revision: number;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const documentSelection = `document.id::text, document.kind, document.status, document.title,
  document.contact_id::text, document.opportunity_id::text, document.owner_member_id::text,
  document.source_template_id::text, document.blocks, document.design, document.revision,
  document.version::text, document.created_at, document.updated_at`;
const templateSelection = `template.id::text, template.kind, template.name, template.blocks,
  template.design, template.revision, template.version::text, template.created_at, template.updated_at`;

function blocks(value: unknown): readonly DocumentBlock[] {
  if (!Array.isArray(value)) throw new DatabaseUnavailableError();
  return Object.freeze(structuredClone(value) as DocumentBlock[]);
}

function design(value: unknown): DocumentDesign {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new DatabaseUnavailableError();
  return Object.freeze(structuredClone(value) as DocumentDesign);
}

function documentFromRow(row: DocumentRow): CommercialDocumentRecord {
  const kind = row.kind.toUpperCase();
  const status = row.status.toUpperCase();
  if (kind !== "QUOTE" && kind !== "INVOICE") throw new DatabaseUnavailableError();
  if (status !== "DRAFT") throw new DatabaseUnavailableError();
  return Object.freeze({
    id: row.id,
    kind,
    status,
    title: row.title,
    contactId: row.contact_id,
    opportunityId: row.opportunity_id,
    ownerMemberId: row.owner_member_id,
    sourceTemplateId: row.source_template_id,
    blocks: blocks(row.blocks),
    design: design(row.design),
    revision: row.revision,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}

function templateFromRow(row: TemplateRow): DocumentTemplateRecord {
  const kind = row.kind.toUpperCase();
  if (kind !== "QUOTE" && kind !== "INVOICE") throw new DatabaseUnavailableError();
  return Object.freeze({
    id: row.id,
    kind,
    name: row.name,
    blocks: blocks(row.blocks),
    design: design(row.design),
    revision: row.revision,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}

function visibility(
  actor: CommercialActor,
  placeholder: number,
): { readonly sql: string; readonly params: readonly string[] } {
  if (actor.scope === "PROFILE") return { sql: "TRUE", params: [] };
  if (actor.scope === "TEAM")
    return {
      sql: `EXISTS (
        SELECT 1 FROM iam.team_members AS viewer_team
        JOIN iam.team_members AS owner_team ON owner_team.team_id = viewer_team.team_id
        WHERE viewer_team.member_id = $${placeholder}::uuid
          AND owner_team.member_id = document.owner_member_id
      )`,
      params: [actor.memberId],
    };
  return { sql: `document.owner_member_id = $${placeholder}::uuid`, params: [actor.memberId] };
}

function fail(error: unknown): never {
  if (error instanceof CommercialIdempotencyConflictError) throw error;
  throw new DatabaseUnavailableError();
}

async function lockCommand(
  client: PoolClient,
  principal: string,
  command: string,
  key: string,
): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${principal}:${command}:${key}`,
  ]);
}

async function replay<Row>(
  client: PoolClient,
  principal: string,
  command: string,
  key: string,
  hash: string,
): Promise<Row | null> {
  const result = await client.query<{ readonly payload_hash: string; readonly response: Row }>(
    `SELECT payload_hash, response FROM documents.command_idempotency
      WHERE principal_key = $1 AND command = $2 AND idempotency_key = $3 FOR UPDATE`,
    [principal, command, key],
  );
  const found = result.rows[0];
  if (!found) return null;
  if (found.payload_hash !== hash) throw new CommercialIdempotencyConflictError();
  return found.response;
}

async function remember(
  client: PoolClient,
  principal: string,
  command: string,
  key: string,
  hash: string,
  response: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO documents.command_idempotency
      (principal_key, command, idempotency_key, payload_hash, response)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [principal, command, key, hash, JSON.stringify(response)],
  );
}

async function insertDocumentRevision(
  client: PoolClient,
  row: DocumentRow,
  actorMemberId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO documents.document_revisions
      (document_id, revision, actor_member_id, snapshot, created_at)
     VALUES ($1::uuid, $2, $3::uuid, $4::jsonb, $5)`,
    [row.id, row.revision, actorMemberId, JSON.stringify(row), row.updated_at],
  );
}

async function insertTemplateRevision(
  client: PoolClient,
  row: TemplateRow,
  actorMemberId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO documents.template_revisions
      (template_id, revision, actor_member_id, snapshot, created_at)
     VALUES ($1::uuid, $2, $3::uuid, $4::jsonb, $5)`,
    [row.id, row.revision, actorMemberId, JSON.stringify(row), row.updated_at],
  );
}

export function createDocumentPostgresRepository(pool: PostgresPool): DocumentRepository {
  return Object.freeze<DocumentRepository>({
    list: async (actor, filters) => {
      try {
        const clauses: string[] = [];
        const params: unknown[] = [];
        if (filters.kind) {
          params.push(filters.kind.toLowerCase());
          clauses.push(`document.kind = $${params.length}`);
        }
        if (filters.status) {
          params.push(filters.status.toLowerCase());
          clauses.push(`document.status = $${params.length}`);
        }
        const visible = visibility(actor, params.length + 1);
        params.push(...visible.params);
        clauses.push(visible.sql);
        const result = (await pool.query(
          `SELECT ${documentSelection} FROM documents.documents AS document
           WHERE ${clauses.join(" AND ")} ORDER BY document.updated_at DESC, document.id DESC LIMIT 500`,
          params,
        )) as { rows: DocumentRow[] };
        return Object.freeze(result.rows.map(documentFromRow));
      } catch (error) {
        return fail(error);
      }
    },
    find: async (actor, id) => {
      try {
        const visible = visibility(actor, 2);
        const result = (await pool.query(
          `SELECT ${documentSelection} FROM documents.documents AS document
           WHERE document.id = $1::uuid AND ${visible.sql}`,
          [id, ...visible.params],
        )) as { rows: DocumentRow[] };
        return result.rows[0] ? documentFromRow(result.rows[0]) : null;
      } catch (error) {
        return fail(error);
      }
    },
    create: async (input) => {
      let client: PoolClient | undefined;
      try {
        const principal = `member:${input.document.ownerMemberId}`;
        client = await pool.connect();
        await client.query("BEGIN");
        await lockCommand(client, principal, "documents.create", input.idempotencyKey);
        const previous = await replay<DocumentRow>(
          client,
          principal,
          "documents.create",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (previous) {
          await client.query("COMMIT");
          return documentFromRow(previous);
        }
        const document = input.document;
        const result = await client.query<DocumentRow>(
          `INSERT INTO documents.documents
            (id, kind, status, title, contact_id, opportunity_id, owner_member_id, source_template_id,
             blocks, design, revision, version, created_at, updated_at)
           VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::uuid, $7::uuid, $8::uuid,
                   $9::jsonb, $10::jsonb, 1, 1, $11, $11)
           RETURNING id::text, kind, status, title, contact_id::text, opportunity_id::text,
             owner_member_id::text, source_template_id::text, blocks, design, revision,
             version::text, created_at, updated_at`,
          [
            document.id,
            document.kind.toLowerCase(),
            document.status.toLowerCase(),
            document.title,
            document.contactId,
            document.opportunityId,
            document.ownerMemberId,
            document.sourceTemplateId,
            JSON.stringify(document.blocks),
            JSON.stringify(document.design),
            document.createdAt,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await insertDocumentRevision(client, row, document.ownerMemberId);
        await remember(
          client,
          principal,
          "documents.create",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return documentFromRow(row);
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
        const principal = `member:${input.actor.memberId}`;
        client = await pool.connect();
        await client.query("BEGIN");
        await lockCommand(client, principal, "documents.update", input.idempotencyKey);
        const previous = await replay<DocumentRow>(
          client,
          principal,
          "documents.update",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (previous) {
          await client.query("COMMIT");
          return documentFromRow(previous);
        }
        const visible = visibility(input.actor, 9);
        const result = await client.query<DocumentRow>(
          `UPDATE documents.documents AS document SET
             title = $3, contact_id = $4::uuid, opportunity_id = $5::uuid,
             blocks = $6::jsonb, design = $7::jsonb, revision = revision + 1,
             version = version + 1, updated_at = $8
           WHERE document.id = $1::uuid AND document.version = $2::bigint AND ${visible.sql}
           RETURNING document.id::text, document.kind, document.status, document.title,
             document.contact_id::text, document.opportunity_id::text, document.owner_member_id::text,
             document.source_template_id::text, document.blocks, document.design, document.revision,
             document.version::text, document.created_at, document.updated_at`,
          [
            input.id,
            input.expectedVersion.toString(),
            input.title,
            input.contactId,
            input.opportunityId,
            JSON.stringify(input.blocks),
            JSON.stringify(input.design),
            input.now,
            ...visible.params,
          ],
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        await insertDocumentRevision(client, row, input.actor.memberId);
        await remember(
          client,
          principal,
          "documents.update",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return documentFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    listTemplates: async (kind) => {
      try {
        const result = (await pool.query(
          `SELECT ${templateSelection} FROM documents.templates AS template
           WHERE ($1::text IS NULL OR template.kind = $1)
           ORDER BY template.name, template.id LIMIT 500`,
          [kind?.toLowerCase() ?? null],
        )) as { rows: TemplateRow[] };
        return Object.freeze(result.rows.map(templateFromRow));
      } catch (error) {
        return fail(error);
      }
    },
    findTemplate: async (id) => {
      try {
        const result = (await pool.query(
          `SELECT ${templateSelection} FROM documents.templates AS template WHERE template.id = $1::uuid`,
          [id],
        )) as { rows: TemplateRow[] };
        return result.rows[0] ? templateFromRow(result.rows[0]) : null;
      } catch (error) {
        return fail(error);
      }
    },
    createTemplate: async (input) => {
      let client: PoolClient | undefined;
      try {
        const principal = `member:${input.actorMemberId}`;
        client = await pool.connect();
        await client.query("BEGIN");
        await lockCommand(client, principal, "documents.template.create", input.idempotencyKey);
        const previous = await replay<TemplateRow>(
          client,
          principal,
          "documents.template.create",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (previous) {
          await client.query("COMMIT");
          return templateFromRow(previous);
        }
        const template = input.template;
        const result = await client.query<TemplateRow>(
          `INSERT INTO documents.templates
            (id, kind, name, blocks, design, revision, version, created_at, updated_at)
           VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb, 1, 1, $6, $6)
           RETURNING id::text, kind, name, blocks, design, revision, version::text, created_at, updated_at`,
          [
            template.id,
            template.kind.toLowerCase(),
            template.name,
            JSON.stringify(template.blocks),
            JSON.stringify(template.design),
            template.createdAt,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await insertTemplateRevision(client, row, input.actorMemberId);
        await remember(
          client,
          principal,
          "documents.template.create",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return templateFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    updateTemplate: async (input) => {
      let client: PoolClient | undefined;
      try {
        const principal = `member:${input.actorMemberId}`;
        client = await pool.connect();
        await client.query("BEGIN");
        await lockCommand(client, principal, "documents.template.update", input.idempotencyKey);
        const previous = await replay<TemplateRow>(
          client,
          principal,
          "documents.template.update",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (previous) {
          await client.query("COMMIT");
          return templateFromRow(previous);
        }
        const result = await client.query<TemplateRow>(
          `UPDATE documents.templates AS template SET name = $3, blocks = $4::jsonb,
             design = $5::jsonb, revision = revision + 1, version = version + 1, updated_at = $6
           WHERE template.id = $1::uuid AND template.version = $2::bigint
           RETURNING template.id::text, template.kind, template.name, template.blocks, template.design,
             template.revision, template.version::text, template.created_at, template.updated_at`,
          [
            input.id,
            input.expectedVersion.toString(),
            input.name,
            JSON.stringify(input.blocks),
            JSON.stringify(input.design),
            input.now,
          ],
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        await insertTemplateRevision(client, row, input.actorMemberId);
        await remember(
          client,
          principal,
          "documents.template.update",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return templateFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
  });
}
