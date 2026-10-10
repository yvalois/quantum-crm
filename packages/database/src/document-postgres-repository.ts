import type {
  CommercialActor,
  CommercialDocumentRecord,
  DocumentBlock,
  DocumentDesign,
  DocumentRepository,
  DocumentTemplateRecord,
} from "@quantum-crm/domain";
import { DocumentValidationError } from "@quantum-crm/domain";
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
  if (
    error instanceof CommercialIdempotencyConflictError ||
    error instanceof DocumentValidationError
  )
    throw error;
  throw new DatabaseUnavailableError();
}

interface DocumentFileReference {
  readonly fileId: string;
  readonly checksum: string;
  readonly purpose: "inline_image" | "attachment" | "signature" | "logo" | "background";
  readonly position: number;
}

function documentFileReferences(
  blocksValue: readonly DocumentBlock[],
  designValue: DocumentDesign,
): readonly DocumentFileReference[] {
  const references: DocumentFileReference[] = [];
  for (const [position, block] of blocksValue.entries()) {
    if (block.type === "IMAGE" && block.fileId && block.checksum) {
      references.push({
        fileId: block.fileId,
        checksum: block.checksum,
        purpose: "inline_image",
        position,
      });
    } else if (block.type === "ATTACHMENT" && block.fileId && block.checksum) {
      references.push({
        fileId: block.fileId,
        checksum: block.checksum,
        purpose: "attachment",
        position,
      });
    } else if (block.type === "SIGNATURE" && block.fileId && block.checksum) {
      references.push({
        fileId: block.fileId,
        checksum: block.checksum,
        purpose: "signature",
        position,
      });
    }
    if (block.type === "COLUMNS") {
      for (const cell of block.cells ?? []) {
        for (const item of cell.items) {
          if (item.type === "IMAGE" && item.fileId && item.checksum) {
            references.push({
              fileId: item.fileId,
              checksum: item.checksum,
              purpose: "inline_image",
              position: references.length,
            });
          }
        }
      }
    }
  }
  if (designValue.logoFileId && designValue.logoChecksum) {
    references.push({
      fileId: designValue.logoFileId,
      checksum: designValue.logoChecksum,
      purpose: "logo",
      position: references.length,
    });
  }
  if (designValue.backgroundFileId && designValue.backgroundChecksum) {
    references.push({
      fileId: designValue.backgroundFileId,
      checksum: designValue.backgroundChecksum,
      purpose: "background",
      position: references.length,
    });
  }
  const unique = new Map<string, DocumentFileReference>();
  for (const reference of references) {
    const key = `${reference.fileId}:${reference.purpose}`;
    const existing = unique.get(key);
    if (existing && existing.checksum !== reference.checksum) {
      throw new DocumentValidationError("A file cannot be referenced with two checksums");
    }
    unique.set(key, existing ?? reference);
  }
  return Object.freeze([...unique.values()]);
}

async function syncDocumentResourceFileReferences(
  client: PoolClient,
  input: {
    readonly resourceType: "commercial_document" | "document_template";
    readonly resourceId: string;
    readonly sourceTemplateId: string | null;
    readonly sourceDocumentId: string | null;
    readonly actorMemberId: string;
    readonly blocks: readonly DocumentBlock[];
    readonly design: DocumentDesign;
    readonly now: Date;
  },
): Promise<void> {
  const references = documentFileReferences(input.blocks, input.design);
  const fileIds = [...new Set(references.map((reference) => reference.fileId))];
  if (fileIds.length > 0) {
    const available = await client.query<{
      readonly id: string;
      readonly checksum: string;
    }>(
      `SELECT file.id::text,
              'sha256:' || encode(decode(file.verified_sha256, 'base64'), 'hex') AS checksum
       FROM files.files AS file
       WHERE file.id = ANY($1::uuid[])
         AND file.status = 'available'
         AND (
           (file.owner_module = 'documents' AND (
             (file.owner_type = $3 AND file.owner_id = $2::uuid)
             OR ($5::uuid IS NOT NULL AND file.owner_type = 'commercial_document'
               AND file.owner_id = $5::uuid)
           ))
           OR EXISTS (
             SELECT 1 FROM files.references AS existing
             WHERE existing.file_id = file.id
               AND existing.module = 'documents'
               AND existing.resource_type = $3
               AND existing.resource_id = $2::uuid
           )
           OR ($4::uuid IS NOT NULL AND EXISTS (
             SELECT 1 FROM files.references AS template_reference
             WHERE template_reference.file_id = file.id
               AND template_reference.module = 'documents'
               AND template_reference.resource_type = 'document_template'
               AND template_reference.resource_id = $4::uuid
           ))
           OR ($5::uuid IS NOT NULL AND EXISTS (
             SELECT 1 FROM files.references AS source_reference
             WHERE source_reference.file_id = file.id
               AND source_reference.module = 'documents'
               AND source_reference.resource_type = 'commercial_document'
               AND source_reference.resource_id = $5::uuid
           ))
         )
       FOR SHARE OF file`,
      [
        fileIds,
        input.resourceId,
        input.resourceType,
        input.sourceTemplateId,
        input.sourceDocumentId,
      ],
    );
    const checksums = new Map(available.rows.map((row) => [row.id, row.checksum]));
    if (
      checksums.size !== fileIds.length ||
      references.some((reference) => checksums.get(reference.fileId) !== reference.checksum)
    ) {
      throw new DocumentValidationError("Every document file must be available and authorized");
    }
  }

  const current = await client.query<{
    readonly file_id: string;
    readonly purpose: DocumentFileReference["purpose"];
  }>(
    `SELECT file_id::text, purpose
     FROM files.references
     WHERE module = 'documents' AND resource_type = $2
       AND resource_id = $1::uuid
     FOR UPDATE`,
    [input.resourceId, input.resourceType],
  );
  const desiredKeys = new Set(
    references.map((reference) => `${reference.fileId}:${reference.purpose}`),
  );
  const currentKeys = new Set(current.rows.map((row) => `${row.file_id}:${row.purpose}`));
  for (const row of current.rows.filter(
    (candidate) => !desiredKeys.has(`${candidate.file_id}:${candidate.purpose}`),
  )) {
    await client.query(
      `DELETE FROM files.references
       WHERE file_id = $1::uuid AND module = 'documents'
         AND resource_type = $3 AND resource_id = $2::uuid
         AND purpose = $4`,
      [row.file_id, input.resourceId, input.resourceType, row.purpose],
    );
    await client.query(
      `INSERT INTO files.outbox
        (id, aggregate_id, event_type, payload, created_at, available_at)
       VALUES (uuidv7(), $1::uuid, 'file.reference.detached',
         jsonb_build_object('fileId', $1::text, 'module', 'documents',
           'resourceType', $3::text, 'resourceId', $2::text), $4, $4)`,
      [row.file_id, input.resourceId, input.resourceType, input.now],
    );
  }
  for (const reference of references) {
    const referenceKey = `${reference.fileId}:${reference.purpose}`;
    if (currentKeys.has(referenceKey)) {
      await client.query(
        `UPDATE files.references SET position = $4
         WHERE file_id = $1::uuid AND module = 'documents'
           AND resource_type = $5 AND resource_id = $2::uuid
           AND purpose = $3`,
        [
          reference.fileId,
          input.resourceId,
          reference.purpose,
          reference.position,
          input.resourceType,
        ],
      );
      continue;
    }
    await client.query(
      `WITH attached AS (
         INSERT INTO files.references
           (id, file_id, module, resource_type, resource_id, purpose, position,
            created_by_member_id, created_at)
         VALUES (uuidv7(), $1::uuid, 'documents', $3, $2::uuid,
                 $4, $5, $6::uuid, $7)
         RETURNING id, file_id
       )
       INSERT INTO files.outbox
         (id, aggregate_id, event_type, payload, created_at, available_at)
       SELECT uuidv7(), attached.file_id, 'file.reference.attached',
         jsonb_build_object('fileId', attached.file_id::text, 'referenceId', attached.id::text,
           'module', 'documents', 'resourceType', $3::text,
           'resourceId', $2::text, 'kind', upper($4)), $7, $7
       FROM attached`,
      [
        reference.fileId,
        input.resourceId,
        input.resourceType,
        reference.purpose,
        reference.position,
        input.actorMemberId,
        input.now,
      ],
    );
  }
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
        if (filters.contactId) {
          params.push(filters.contactId);
          clauses.push(`document.contact_id = $${params.length}::uuid`);
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
        await syncDocumentResourceFileReferences(client, {
          resourceType: "commercial_document",
          resourceId: row.id,
          sourceTemplateId: row.source_template_id,
          sourceDocumentId: input.sourceDocumentId ?? null,
          actorMemberId: document.ownerMemberId,
          blocks: document.blocks,
          design: document.design,
          now: document.createdAt,
        });
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
        await syncDocumentResourceFileReferences(client, {
          resourceType: "commercial_document",
          resourceId: row.id,
          sourceTemplateId: row.source_template_id,
          sourceDocumentId: null,
          actorMemberId: input.actor.memberId,
          blocks: input.blocks,
          design: input.design,
          now: input.now,
        });
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
        await syncDocumentResourceFileReferences(client, {
          resourceType: "document_template",
          resourceId: row.id,
          sourceTemplateId: null,
          sourceDocumentId: input.sourceDocumentId,
          actorMemberId: input.actorMemberId,
          blocks: template.blocks,
          design: template.design,
          now: template.createdAt,
        });
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
        await syncDocumentResourceFileReferences(client, {
          resourceType: "document_template",
          resourceId: row.id,
          sourceTemplateId: null,
          sourceDocumentId: null,
          actorMemberId: input.actorMemberId,
          blocks: input.blocks,
          design: input.design,
          now: input.now,
        });
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
