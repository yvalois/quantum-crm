import type {
  CommercialActor,
  FileListFilters,
  FileOperationRecord,
  FileRecord,
  FileReferenceRecord,
  FileRepository,
} from "@quantum-crm/domain";
import type { PoolClient } from "pg";

import { CommercialIdempotencyConflictError } from "./commercial-postgres-database.js";
import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

interface FileRow {
  readonly id: string;
  readonly owner_member_id: string;
  readonly owner_kind: "existing" | "claim";
  readonly owner_module: "documents" | "conversations" | "forms" | "catalog" | null;
  readonly owner_type:
    | "commercial_document"
    | "document_template"
    | "conversation"
    | "message"
    | "form_response"
    | "product"
    | "variant"
    | null;
  readonly owner_id: string | null;
  readonly attachment_claim_id: string | null;
  readonly file_class: string;
  readonly original_name: string;
  readonly declared_mime: string;
  readonly declared_size: string;
  readonly expected_sha256: string;
  readonly status: string;
  readonly incoming_key: string;
  readonly incoming_version_id: string | null;
  readonly completion_receipt: string | null;
  readonly completion_requested_at: Date | null;
  readonly observed_mime: string | null;
  readonly observed_size: string | null;
  readonly observed_sha256: string | null;
  readonly scan_verdict: string | null;
  readonly scanner_version: string | null;
  readonly scanner_signatures_updated_at: Date | null;
  readonly object_key: string | null;
  readonly object_version_id: string | null;
  readonly rejection_code: string | null;
  readonly delete_after: Date | null;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface OperationRow {
  readonly id: string;
  readonly file_id: string;
  readonly kind: string;
  readonly status: string;
  readonly generation: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface ReferenceRow {
  readonly id: string;
  readonly file_id: string;
  readonly module: "documents" | "conversations" | "forms" | "catalog";
  readonly resource_type:
    | "commercial_document"
    | "document_template"
    | "conversation"
    | "message"
    | "form_response"
    | "product"
    | "variant";
  readonly resource_id: string;
  readonly purpose: string;
  readonly created_at: Date;
}

const fileSelection = `file.id::text, file.owner_member_id::text, file.owner_kind,
  file.owner_module, file.owner_type, file.owner_id::text, file.attachment_claim_id::text,
  file.file_class, file.original_name, file.declared_mime, file.declared_size::text,
  file.expected_sha256, file.status, file.incoming_key, file.incoming_version_id,
  file.completion_receipt, file.completion_requested_at, file.observed_mime,
  file.observed_size::text, file.observed_sha256, file.scan_verdict, file.scanner_version,
  file.scanner_signatures_updated_at, file.object_key, file.object_version_id,
  file.rejection_code, file.delete_after, file.version::text, file.created_at, file.updated_at`;
const operationSelection = `operation.id::text, operation.file_id::text, operation.kind,
  operation.status, operation.generation, operation.created_at, operation.updated_at`;
const referenceSelection = `reference.id::text, reference.file_id::text, reference.module,
  reference.resource_type, reference.resource_id::text, reference.purpose, reference.created_at`;

function fileFromRow(row: FileRow): FileRecord {
  const owner =
    row.owner_kind === "claim"
      ? { kind: "claim" as const, attachmentClaimId: row.attachment_claim_id! }
      : {
          kind: "existing" as const,
          module: row.owner_module!,
          type: row.owner_type!,
          id: row.owner_id!,
        };
  return Object.freeze({
    id: row.id,
    status: row.status.toUpperCase() as FileRecord["status"],
    fileClass: row.file_class.toUpperCase() as FileRecord["fileClass"],
    owner: Object.freeze(owner),
    originalName: row.original_name,
    declaredMime: row.declared_mime,
    declaredSize: Number(row.declared_size),
    expectedSha256: row.expected_sha256,
    incomingObjectKey: row.incoming_key,
    incomingVersionId: row.incoming_version_id,
    completionReceipt: row.completion_receipt,
    completionRequestedAt:
      row.completion_requested_at === null ? null : new Date(row.completion_requested_at),
    observedMime: row.observed_mime,
    observedSize: row.observed_size === null ? null : Number(row.observed_size),
    observedSha256: row.observed_sha256,
    scanVerdict:
      row.scan_verdict === null
        ? null
        : (row.scan_verdict.toUpperCase() as NonNullable<FileRecord["scanVerdict"]>),
    scannerVersion: row.scanner_version,
    scannerSignaturesUpdatedAt:
      row.scanner_signatures_updated_at === null
        ? null
        : new Date(row.scanner_signatures_updated_at),
    objectKey: row.object_key,
    objectVersionId: row.object_version_id,
    rejectionCode:
      row.rejection_code === null
        ? null
        : (row.rejection_code.toUpperCase() as NonNullable<FileRecord["rejectionCode"]>),
    deleteAfter: row.delete_after === null ? null : new Date(row.delete_after),
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}

function operationFromRow(row: OperationRow): FileOperationRecord {
  return Object.freeze({
    id: row.id,
    fileId: row.file_id,
    kind: row.kind === "delete" ? "DELETE" : "PROCESS_UPLOAD",
    status: row.status.toUpperCase() as FileOperationRecord["status"],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}

function referenceFromRow(row: ReferenceRow): FileReferenceRecord {
  return Object.freeze({
    id: row.id,
    fileId: row.file_id,
    owner: Object.freeze({
      kind: "existing" as const,
      module: row.module,
      type: row.resource_type,
      id: row.resource_id,
    }),
    kind: row.purpose.toUpperCase() as FileReferenceRecord["kind"],
    createdAt: new Date(row.created_at),
  });
}

function visibility(
  actor: CommercialActor,
  placeholder: number,
): { readonly sql: string; readonly params: readonly string[] } {
  if (actor.scope === "PROFILE") return { sql: "TRUE", params: [] };
  if (actor.scope === "TEAM") {
    return {
      sql: `EXISTS (
        SELECT 1 FROM iam.team_members AS viewer_team
        JOIN iam.team_members AS owner_team ON owner_team.team_id = viewer_team.team_id
        WHERE viewer_team.member_id = $${placeholder}::uuid
          AND owner_team.member_id = file.owner_member_id
      )`,
      params: [actor.memberId],
    };
  }
  return { sql: `file.owner_member_id = $${placeholder}::uuid`, params: [actor.memberId] };
}

function cursor(
  value: string | undefined,
): { readonly updatedAt: Date; readonly id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      u?: unknown;
      i?: unknown;
    };
    if (typeof parsed.u !== "string" || typeof parsed.i !== "string") return null;
    const updatedAt = new Date(parsed.u);
    if (Number.isNaN(updatedAt.getTime())) return null;
    return { updatedAt, id: parsed.i };
  } catch {
    return null;
  }
}

function encodeCursor(file: FileRecord): string {
  return Buffer.from(JSON.stringify({ u: file.updatedAt.toISOString(), i: file.id })).toString(
    "base64url",
  );
}

async function lock(
  client: PoolClient,
  principal: string,
  command: string,
  key: string,
): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${principal}:${command}:${key}`,
  ]);
}

async function replay<T>(
  client: PoolClient,
  principal: string,
  command: string,
  key: string,
  hash: string,
): Promise<T | null> {
  const result = await client.query<{ readonly payload_hash: string; readonly response: T }>(
    `SELECT payload_hash, response FROM files.command_idempotency
     WHERE principal_key = $1 AND command = $2 AND idempotency_key = $3 FOR UPDATE`,
    [principal, command, key],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.payload_hash !== hash) throw new CommercialIdempotencyConflictError();
  return row.response;
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
    `INSERT INTO files.command_idempotency
      (principal_key, command, idempotency_key, payload_hash, response)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [principal, command, key, hash, JSON.stringify(response)],
  );
}

function fail(error: unknown): never {
  if (error instanceof CommercialIdempotencyConflictError) throw error;
  throw new DatabaseUnavailableError();
}

export interface FileProcessingLease {
  readonly file: FileRecord;
  readonly operationId: string;
  readonly leaseGeneration: number;
}

export interface FileProcessingRepository extends FileRepository {
  readonly claimNextProcessing: (input: {
    readonly workerId: string;
    readonly leaseSeconds: number;
    readonly now: Date;
  }) => Promise<FileProcessingLease | null>;
  readonly transitionProcessing: (input: {
    readonly operationId: string;
    readonly leaseGeneration: number;
    readonly file: FileRecord;
    readonly now: Date;
  }) => Promise<boolean>;
}

export function createFilePostgresRepository(pool: PostgresPool): FileProcessingRepository {
  return Object.freeze<FileProcessingRepository>({
    list: async (actor, filters: FileListFilters) => {
      try {
        const visible = visibility(actor, 1);
        const params: unknown[] = [...visible.params];
        const clauses = [visible.sql];
        if (filters.status) {
          params.push(filters.status.toLowerCase());
          clauses.push(`file.status = $${params.length}`);
        }
        if (filters.fileClass) {
          params.push(filters.fileClass.toLowerCase());
          clauses.push(`file.file_class = $${params.length}`);
        }
        const decoded = cursor(filters.cursor);
        if (filters.cursor && !decoded) throw new DatabaseUnavailableError();
        if (decoded) {
          params.push(decoded.updatedAt, decoded.id);
          clauses.push(
            `(file.updated_at, file.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
          );
        }
        params.push(filters.limit + 1);
        const result = (await pool.query(
          `SELECT ${fileSelection} FROM files.files AS file
           WHERE ${clauses.join(" AND ")}
           ORDER BY file.updated_at DESC, file.id DESC LIMIT $${params.length}`,
          params,
        )) as { rows: FileRow[] };
        const all = result.rows.map(fileFromRow);
        const items = Object.freeze(all.slice(0, filters.limit));
        return Object.freeze({
          items,
          nextCursor: all.length > filters.limit ? encodeCursor(items.at(-1)!) : null,
        });
      } catch (error) {
        return fail(error);
      }
    },
    find: async (actor, fileId) => {
      try {
        const visible = visibility(actor, 2);
        const result = (await pool.query(
          `SELECT ${fileSelection} FROM files.files AS file
           WHERE file.id = $1::uuid AND ${visible.sql}`,
          [fileId, ...visible.params],
        )) as { rows: FileRow[] };
        return result.rows[0] ? fileFromRow(result.rows[0]) : null;
      } catch (error) {
        return fail(error);
      }
    },
    reserve: async (input) => {
      let client: PoolClient | undefined;
      try {
        const principal = `member:${input.actorMemberId}`;
        client = await pool.connect();
        await client.query("BEGIN");
        await lock(client, principal, "files.reserve", input.idempotencyKey);
        const previous = await replay<{ readonly file: FileRow }>(
          client,
          principal,
          "files.reserve",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (previous) {
          await client.query("COMMIT");
          return Object.freeze({ file: fileFromRow(previous.file), replayed: true });
        }
        const owner = input.file.owner;
        const result = await client.query<FileRow>(
          `INSERT INTO files.files AS file
            (id, owner_member_id, owner_kind, owner_module, owner_type, owner_id,
             attachment_claim_id, file_class, original_name, declared_mime, declared_size,
             expected_sha256, status, incoming_key, expires_at, version, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7::uuid, $8, $9, $10,
                   $11::bigint, $12, 'pending', $13, $14, 1, $15, $15)
           RETURNING ${fileSelection}`,
          [
            input.file.id,
            input.actorMemberId,
            owner.kind,
            owner.kind === "existing" ? owner.module : null,
            owner.kind === "existing" ? owner.type : null,
            owner.kind === "existing" ? owner.id : null,
            owner.kind === "claim" ? owner.attachmentClaimId : null,
            input.file.fileClass.toLowerCase(),
            input.file.originalName,
            input.file.declaredMime,
            input.file.declaredSize,
            input.file.expectedSha256,
            input.file.incomingObjectKey,
            new Date(input.file.createdAt.getTime() + 10 * 60 * 1_000),
            input.file.createdAt,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await remember(
          client,
          principal,
          "files.reserve",
          input.idempotencyKey,
          input.payloadHash,
          {
            file: row,
          },
        );
        await client.query("COMMIT");
        return Object.freeze({ file: fileFromRow(row), replayed: false });
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    requestCompletion: async (input) => {
      let client: PoolClient | undefined;
      try {
        const principal = `member:${input.actor.memberId}`;
        client = await pool.connect();
        await client.query("BEGIN");
        await lock(client, principal, "files.complete", input.idempotencyKey);
        const previous = await replay<{
          readonly file: FileRow;
          readonly operation: OperationRow;
        }>(client, principal, "files.complete", input.idempotencyKey, input.payloadHash);
        if (previous) {
          await client.query("COMMIT");
          return Object.freeze({
            file: fileFromRow(previous.file),
            operation: operationFromRow(previous.operation),
            replayed: true,
          });
        }
        const visible = visibility(input.actor, 7);
        const fileResult = await client.query<FileRow>(
          `UPDATE files.files AS file SET incoming_version_id = $3,
             completion_receipt = $4, completion_requested_at = $5,
             version = $6::bigint, updated_at = $5
           WHERE file.id = $1::uuid AND file.version = $2::bigint
             AND file.status = 'pending' AND file.incoming_version_id IS NULL AND ${visible.sql}
           RETURNING ${fileSelection}`,
          [
            input.file.id,
            (input.file.version - 1n).toString(),
            input.file.incomingVersionId,
            input.file.completionReceipt,
            input.file.updatedAt,
            input.file.version.toString(),
            ...visible.params,
          ],
        );
        const fileRow = fileResult.rows[0];
        if (!fileRow) {
          await client.query("COMMIT");
          return null;
        }
        const operationResult = await client.query<OperationRow>(
          `INSERT INTO files.operations AS operation
            (id, file_id, kind, status, requested_by_member_id, generation, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, 'process_upload', 'pending', $3::uuid, 1, $4, $4)
           RETURNING ${operationSelection}`,
          [input.operation.id, input.file.id, input.actor.memberId, input.operation.createdAt],
        );
        const operationRow = operationResult.rows[0];
        if (!operationRow) throw new DatabaseUnavailableError();
        await client.query(
          `INSERT INTO files.outbox
            (id, aggregate_id, event_type, payload, created_at, available_at)
           VALUES (uuidv7(), $1::uuid, 'file.upload.completion_requested',
             jsonb_build_object('fileId', $1::text, 'operationId', $2::text), $3, $3)`,
          [input.file.id, input.operation.id, input.operation.createdAt],
        );
        await remember(
          client,
          principal,
          "files.complete",
          input.idempotencyKey,
          input.payloadHash,
          { file: fileRow, operation: operationRow },
        );
        await client.query("COMMIT");
        return Object.freeze({
          file: fileFromRow(fileRow),
          operation: operationFromRow(operationRow),
          replayed: false,
        });
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    attachReference: async (input) => {
      let client: PoolClient | undefined;
      try {
        const principal = `member:${input.actor.memberId}`;
        client = await pool.connect();
        await client.query("BEGIN");
        await lock(client, principal, "files.reference.attach", input.idempotencyKey);
        const previous = await replay<{ readonly reference: ReferenceRow }>(
          client,
          principal,
          "files.reference.attach",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (previous) {
          await client.query("COMMIT");
          return Object.freeze({ reference: referenceFromRow(previous.reference), replayed: true });
        }
        const visible = visibility(input.actor, 2);
        const permitted = await client.query(
          `SELECT 1 FROM files.files AS file
           WHERE file.id = $1::uuid AND file.status = 'available' AND ${visible.sql}
           FOR SHARE OF file`,
          [input.reference.fileId, ...visible.params],
        );
        if (permitted.rowCount !== 1) throw new DatabaseUnavailableError();
        const owner = input.reference.owner;
        const inserted = await client.query<ReferenceRow>(
          `INSERT INTO files.references AS reference
            (id, file_id, module, resource_type, resource_id, purpose, position,
             created_by_member_id, created_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, 0, $7::uuid, $8)
           ON CONFLICT (file_id, module, resource_type, resource_id, purpose)
           DO UPDATE SET position = files.references.position
           RETURNING ${referenceSelection}`,
          [
            input.reference.id,
            input.reference.fileId,
            owner.module,
            owner.type,
            owner.id,
            input.reference.kind.toLowerCase(),
            input.actor.memberId,
            input.reference.createdAt,
          ],
        );
        const row = inserted.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await remember(
          client,
          principal,
          "files.reference.attach",
          input.idempotencyKey,
          input.payloadHash,
          { reference: row },
        );
        await client.query("COMMIT");
        return Object.freeze({ reference: referenceFromRow(row), replayed: false });
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    claimNextProcessing: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const claimed = await client.query<OperationRow>(
          `WITH candidate AS (
             SELECT operation.id
             FROM files.operations AS operation
             WHERE operation.kind = 'process_upload'
               AND (operation.status = 'pending'
                 OR (operation.status = 'running' AND operation.lease_expires_at <= $1))
             ORDER BY operation.created_at, operation.id
             FOR UPDATE SKIP LOCKED LIMIT 1
           )
           UPDATE files.operations AS operation SET status = 'running',
             lease_owner = $2, lease_expires_at = $1 + make_interval(secs => $3),
             generation = operation.generation + 1, updated_at = $1
           FROM candidate WHERE operation.id = candidate.id
           RETURNING ${operationSelection}`,
          [input.now, input.workerId, input.leaseSeconds],
        );
        const operation = claimed.rows[0];
        if (!operation) {
          await client.query("COMMIT");
          return null;
        }
        const fileResult = await client.query<FileRow>(
          `SELECT ${fileSelection} FROM files.files AS file
           WHERE file.id = $1::uuid FOR UPDATE`,
          [operation.file_id],
        );
        const fileRow = fileResult.rows[0];
        if (!fileRow) throw new DatabaseUnavailableError();
        await client.query("COMMIT");
        return Object.freeze({
          file: fileFromRow(fileRow),
          operationId: operation.id,
          leaseGeneration: operation.generation,
        });
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    transitionProcessing: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const lease = await client.query(
          `SELECT 1 FROM files.operations
           WHERE id = $1::uuid AND generation = $2 AND status = 'running'
             AND lease_expires_at > $3 FOR UPDATE`,
          [input.operationId, input.leaseGeneration, input.now],
        );
        if (lease.rowCount !== 1) {
          await client.query("ROLLBACK");
          return false;
        }
        const file = input.file;
        const updated = await client.query(
          `UPDATE files.files SET status = $2, observed_mime = $3, observed_size = $4,
             observed_sha256 = $5, scan_verdict = $6, scanner_version = $7,
             scanner_signatures_updated_at = $8, object_key = $9, object_version_id = $10,
             verified_sha256 = CASE WHEN $2 = 'available' THEN $5 ELSE verified_sha256 END,
             available_at = CASE WHEN $2 = 'available' THEN $15 ELSE available_at END,
             rejection_code = $11, delete_after = $12, version = $13::bigint, updated_at = $15
           WHERE id = $1::uuid AND version = $14::bigint`,
          [
            file.id,
            file.status.toLowerCase(),
            file.observedMime,
            file.observedSize,
            file.observedSha256,
            file.scanVerdict?.toLowerCase() ?? null,
            file.scannerVersion,
            file.scannerSignaturesUpdatedAt,
            file.objectKey,
            file.objectVersionId,
            file.rejectionCode?.toLowerCase() ?? null,
            file.deleteAfter,
            file.version.toString(),
            (file.version - 1n).toString(),
            input.now,
          ],
        );
        if (updated.rowCount !== 1) {
          await client.query("ROLLBACK");
          return false;
        }
        const terminal = ["AVAILABLE", "REJECTED", "FAILED", "DELETED"].includes(file.status);
        if (terminal) {
          await client.query(
            `UPDATE files.operations SET status = $2, lease_owner = NULL,
               lease_expires_at = NULL, completed_at = $3, updated_at = $3
             WHERE id = $1::uuid AND generation = $4`,
            [
              input.operationId,
              file.status === "AVAILABLE" || file.status === "DELETED" ? "succeeded" : "failed",
              input.now,
              input.leaseGeneration,
            ],
          );
          await client.query(
            `INSERT INTO files.outbox
              (id, aggregate_id, event_type, payload, created_at, available_at)
             VALUES (uuidv7(), $1::uuid, $2,
               jsonb_build_object('fileId', $1::text, 'operationId', $3::text), $4, $4)`,
            [
              file.id,
              file.status === "AVAILABLE" ? "file.available" : "file.processing.failed",
              input.operationId,
              input.now,
            ],
          );
        }
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
  });
}
