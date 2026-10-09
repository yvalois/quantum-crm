import type {
  FormRecord,
  FormRepository,
  PublishedFormRecord,
  SubmittedFormRecord,
} from "@quantum-crm/domain";
import type { PoolClient } from "pg";

import { CommercialIdempotencyConflictError } from "./commercial-postgres-database.js";
import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

interface FormRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly definition: unknown;
  readonly theme: unknown;
  readonly published_revision: number | null;
  readonly closes_at: Date | null;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}
interface PublishedRow extends FormRow {
  readonly published_definition: unknown;
  readonly published_theme: unknown;
  readonly published_at: Date;
}
interface ResponseRow {
  readonly id: string;
  readonly form_id: string;
  readonly form_revision: number;
  readonly contact_id: string | null;
  readonly answers: unknown;
  readonly submitted_at: Date;
}
interface IdempotencyRow<Row> {
  readonly payload_hash: string;
  readonly response: Row;
}

const selection = `id::text, slug, title, description, status, definition, theme,
  published_revision, closes_at, version::text, created_at, updated_at`;
const responseSelection = `id::text, form_id::text, form_revision, contact_id::text, answers, submitted_at`;

function form(row: FormRow): FormRecord {
  const status = row.status.toUpperCase() as FormRecord["status"];
  if (!(["DRAFT", "PUBLISHED", "CLOSED"] as const).includes(status)) {
    throw new DatabaseUnavailableError();
  }
  return Object.freeze({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status,
    definition: row.definition as FormRecord["definition"],
    theme: row.theme as FormRecord["theme"],
    publishedRevision: row.published_revision,
    closesAt: row.closes_at ? new Date(row.closes_at) : null,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}

function submission(row: ResponseRow): SubmittedFormRecord {
  return Object.freeze({
    id: row.id,
    formId: row.form_id,
    formRevision: row.form_revision,
    contactId: row.contact_id,
    answers: row.answers as SubmittedFormRecord["answers"],
    submittedAt: new Date(row.submitted_at),
  });
}

function fail(error: unknown): never {
  if (error instanceof CommercialIdempotencyConflictError) throw error;
  throw new DatabaseUnavailableError();
}

async function previous<Row>(
  client: PoolClient,
  principal: string,
  command: string,
  key: string,
  hash: string,
): Promise<Row | null> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${principal}:${command}:${key}`,
  ]);
  const result = (await client.query(
    `SELECT payload_hash, response FROM forms.command_idempotency
      WHERE principal_key = $1 AND command = $2 AND idempotency_key = $3`,
    [principal, command, key],
  )) as { readonly rows: readonly IdempotencyRow<Row>[] };
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
    `INSERT INTO forms.command_idempotency
      (principal_key, command, idempotency_key, payload_hash, response)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [principal, command, key, hash, JSON.stringify(response)],
  );
}

export function createFormPostgresRepository(pool: PostgresPool): FormRepository {
  return Object.freeze<FormRepository>({
    list: async () => {
      try {
        const result = (await pool.query(
          `SELECT ${selection} FROM forms.forms ORDER BY updated_at DESC, id DESC LIMIT 500`,
        )) as { readonly rows: readonly FormRow[] };
        return Object.freeze(result.rows.map(form));
      } catch (error) {
        return fail(error);
      }
    },
    find: async (id) => {
      try {
        const result = (await pool.query(
          `SELECT ${selection} FROM forms.forms WHERE id = $1::uuid`,
          [id],
        )) as { readonly rows: readonly FormRow[] };
        return result.rows[0] ? form(result.rows[0]) : null;
      } catch (error) {
        return fail(error);
      }
    },
    findPublishedBySlug: async (slug) => {
      try {
        const result = (await pool.query(
          `SELECT ${selection.replaceAll(/\bdefinition\b/gu, "current.definition").replaceAll(/\btheme\b/gu, "current.theme")},
                  version.definition AS published_definition,
                  version.theme AS published_theme,
                  version.published_at
             FROM forms.forms AS current
             JOIN forms.versions AS version
               ON version.form_id = current.id AND version.revision = current.published_revision
            WHERE current.slug = $1`,
          [slug],
        )) as { readonly rows: readonly PublishedRow[] };
        const row = result.rows[0];
        if (!row) return null;
        const published: PublishedFormRecord = Object.freeze({
          form: form(row),
          revision: row.published_revision!,
          definition: row.published_definition as PublishedFormRecord["definition"],
          theme: row.published_theme as PublishedFormRecord["theme"],
          publishedAt: new Date(row.published_at),
        });
        return published;
      } catch (error) {
        return fail(error);
      }
    },
    create: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const principal = `member:${input.actorMemberId}`;
        const found = await previous<FormRow>(
          client,
          principal,
          "forms.create",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (found) {
          await client.query("COMMIT");
          return form(found);
        }
        const result = (await client.query(
          `INSERT INTO forms.forms
            (id, slug, title, description, status, definition, theme, published_revision, closes_at, version, created_at, updated_at)
           VALUES ($1::uuid, $2, $3, $4, 'draft', $5::jsonb, $6::jsonb, NULL, $7, 1, $8, $8)
           RETURNING ${selection}`,
          [
            input.form.id,
            input.form.slug,
            input.form.title,
            input.form.description,
            JSON.stringify(input.form.definition),
            JSON.stringify(input.form.theme),
            input.form.closesAt,
            input.form.createdAt,
          ],
        )) as { readonly rows: readonly FormRow[] };
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await remember(
          client,
          principal,
          "forms.create",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return form(row);
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
        client = await pool.connect();
        await client.query("BEGIN");
        const principal = `member:${input.actorMemberId}`;
        const found = await previous<FormRow>(
          client,
          principal,
          "forms.update",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (found) {
          await client.query("COMMIT");
          return form(found);
        }
        const result = (await client.query(
          `UPDATE forms.forms SET
             title = COALESCE($3, title), description = COALESCE($4, description),
             definition = COALESCE($5::jsonb, definition), theme = COALESCE($6::jsonb, theme),
             closes_at = CASE WHEN $7::boolean THEN $8::timestamptz ELSE closes_at END,
             version = version + 1, updated_at = $9
           WHERE id = $1::uuid AND version = $2::bigint
           RETURNING ${selection}`,
          [
            input.id,
            input.expectedVersion.toString(),
            input.patch.title ?? null,
            input.patch.description ?? null,
            input.patch.definition ? JSON.stringify(input.patch.definition) : null,
            input.patch.theme ? JSON.stringify(input.patch.theme) : null,
            Object.hasOwn(input.patch, "closesAt"),
            input.patch.closesAt ?? null,
            input.now,
          ],
        )) as { readonly rows: readonly FormRow[] };
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        await remember(
          client,
          principal,
          "forms.update",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return form(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    publish: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const principal = `member:${input.actorMemberId}`;
        const found = await previous<FormRow>(
          client,
          principal,
          "forms.publish",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (found) {
          await client.query("COMMIT");
          return form(found);
        }
        const result = (await client.query(
          `UPDATE forms.forms SET status = 'published', published_revision = COALESCE(published_revision, 0) + 1,
                  version = version + 1, updated_at = $3
            WHERE id = $1::uuid AND version = $2::bigint
            RETURNING ${selection}`,
          [input.id, input.expectedVersion.toString(), input.now],
        )) as { readonly rows: readonly FormRow[] };
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        await client.query(
          `INSERT INTO forms.versions (form_id, revision, definition, theme, published_by_member_id, published_at)
           VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb, $5::uuid, $6)`,
          [
            row.id,
            row.published_revision,
            JSON.stringify(row.definition),
            JSON.stringify(row.theme),
            input.actorMemberId,
            input.now,
          ],
        );
        await remember(
          client,
          principal,
          "forms.publish",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return form(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    close: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const principal = `member:${input.actorMemberId}`;
        const found = await previous<FormRow>(
          client,
          principal,
          "forms.close",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (found) {
          await client.query("COMMIT");
          return form(found);
        }
        const result = (await client.query(
          `UPDATE forms.forms SET status = 'closed', version = version + 1, updated_at = $3
            WHERE id = $1::uuid AND version = $2::bigint
            RETURNING ${selection}`,
          [input.id, input.expectedVersion.toString(), input.now],
        )) as { readonly rows: readonly FormRow[] };
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        await remember(
          client,
          principal,
          "forms.close",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return form(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    submit: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const principal = `public:${input.slug}`;
        const found = await previous<ResponseRow>(
          client,
          principal,
          "forms.submit",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (found) {
          await client.query("COMMIT");
          return submission(found);
        }
        const current = (await client.query(
          `SELECT id::text, status, published_revision, closes_at FROM forms.forms WHERE slug = $1 FOR SHARE`,
          [input.slug],
        )) as {
          readonly rows: readonly {
            id: string;
            status: string;
            published_revision: number | null;
            closes_at: Date | null;
          }[];
        };
        const target = current.rows[0];
        if (
          !target ||
          target.status !== "published" ||
          target.published_revision !== input.submission.formRevision ||
          (target.closes_at && new Date(target.closes_at) <= input.now)
        ) {
          throw new DatabaseUnavailableError();
        }
        const result = (await client.query(
          `INSERT INTO forms.responses (id, form_id, form_revision, contact_id, answers, submitted_at)
           VALUES ($1::uuid, $2::uuid, $3, NULL, $4::jsonb, $5)
           RETURNING ${responseSelection}`,
          [
            input.submission.id,
            input.submission.formId,
            input.submission.formRevision,
            JSON.stringify(input.submission.answers),
            input.submission.submittedAt,
          ],
        )) as { readonly rows: readonly ResponseRow[] };
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await client.query(
          `INSERT INTO forms.outbox (response_id, event_type, payload, occurred_at)
           VALUES ($1::uuid, 'forms.response.submitted.v1', $2::jsonb, $3)`,
          [
            row.id,
            JSON.stringify({
              responseId: row.id,
              formId: row.form_id,
              formRevision: row.form_revision,
            }),
            input.now,
          ],
        );
        await remember(
          client,
          principal,
          "forms.submit",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return submission(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return fail(error);
      } finally {
        client?.release();
      }
    },
    responses: async (formId, filters) => {
      try {
        const result = (await pool.query(
          `SELECT ${responseSelection} FROM forms.responses
            WHERE form_id = $1::uuid
              AND ($2::timestamptz IS NULL OR submitted_at >= $2::timestamptz)
              AND ($3::timestamptz IS NULL OR submitted_at <= $3::timestamptz)
            ORDER BY submitted_at DESC, id DESC LIMIT $4`,
          [formId, filters.from ?? null, filters.to ?? null, filters.limit],
        )) as { readonly rows: readonly ResponseRow[] };
        return Object.freeze(result.rows.map(submission));
      } catch (error) {
        return fail(error);
      }
    },
    findPublicResponseUpload: async (slug, responseId, now) => {
      try {
        const result = (await pool.query(
          `SELECT response.id::text, response.form_id::text, response.form_revision,
                  response.contact_id::text, response.answers, response.submitted_at,
                  version.definition AS published_definition
             FROM forms.responses AS response
             JOIN forms.forms AS form ON form.id = response.form_id
             JOIN forms.versions AS version
               ON version.form_id = response.form_id AND version.revision = response.form_revision
            WHERE form.slug = $1
              AND response.id = $2::uuid
              AND response.submitted_at >= $3 - INTERVAL '15 minutes'`,
          [slug, responseId, now],
        )) as { readonly rows: readonly (ResponseRow & { readonly published_definition: unknown })[] };
        const row = result.rows[0];
        return row
          ? Object.freeze({
              response: submission(row),
              definition: row.published_definition as PublishedFormRecord["definition"],
            })
          : null;
      } catch (error) {
        return fail(error);
      }
    },
    appendResponseImage: async (input) => {
      try {
        const result = (await pool.query(
          `UPDATE forms.responses
              SET answers = jsonb_set(
                answers,
                ARRAY[$2::text],
                jsonb_build_object(
                  'fileIds',
                  CASE
                    WHEN COALESCE(answers -> $2::text -> 'fileIds', '[]'::jsonb) @> jsonb_build_array($3::text)
                      THEN COALESCE(answers -> $2::text -> 'fileIds', '[]'::jsonb)
                    ELSE COALESCE(answers -> $2::text -> 'fileIds', '[]'::jsonb) || jsonb_build_array($3::text)
                  END
                ),
                true
              )
            WHERE id = $1::uuid
          RETURNING ${responseSelection}`,
          [input.responseId, input.fieldId, input.fileId],
        )) as { readonly rows: readonly ResponseRow[] };
        return result.rows[0] ? submission(result.rows[0]) : null;
      } catch (error) {
        return fail(error);
      }
    },
    findResponseForOwner: async (responseId, now) => {
      try {
        const result = (await pool.query(
          `SELECT ${responseSelection} FROM forms.responses
            WHERE id = $1::uuid AND submitted_at >= $2 - INTERVAL '15 minutes'`,
          [responseId, now],
        )) as { readonly rows: readonly ResponseRow[] };
        return result.rows[0] ? submission(result.rows[0]) : null;
      } catch (error) {
        return fail(error);
      }
    },
  });
}
