import {
  CustomFieldDefinitionValidationError,
  type CustomFieldDefinition,
  type CustomFieldModel,
  type CustomFieldDefinitionRepository,
} from "@quantum-crm/domain";
import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

interface DefinitionRow {
  readonly id: string;
  readonly field_key: string;
  readonly name: string;
  readonly description: string;
  readonly data_type: string;
}

function decodeCursor(value: string, model: CustomFieldModel): string {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("model" in decoded) ||
      decoded.model !== model ||
      !("id" in decoded) ||
      typeof decoded.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(decoded.id)
    )
      throw new CustomFieldDefinitionValidationError();
    return decoded.id;
  } catch {
    throw new CustomFieldDefinitionValidationError();
  }
}

/** The pool belongs to the configured profile; no caller can select another database. */
export function createSettingsCustomFieldPostgresRepository(
  pool: PostgresPool,
): CustomFieldDefinitionRepository {
  return Object.freeze<CustomFieldDefinitionRepository>({
    list: async (query) => {
      const after = query.cursor ? decodeCursor(query.cursor, query.model) : null;
      try {
        const result = (await pool.query(
          `SELECT id::text, field_key, name, description, data_type
           FROM settings.custom_field_definitions
           WHERE section = $1 AND ($2::uuid IS NULL OR id > $2::uuid)
           ORDER BY id ASC LIMIT $3`,
          [query.model, after, query.limit + 1],
        )) as { readonly rows: readonly DefinitionRow[] };
        const rows = result.rows.slice(0, query.limit);
        const last = rows.at(-1);
        const items: readonly CustomFieldDefinition[] = rows.map((row) => ({
          id: row.id,
          key: row.field_key,
          label: row.name,
          description: row.description,
          dataType: row.data_type,
          model: query.model,
        }));
        return {
          items,
          nextCursor:
            result.rows.length > query.limit && last
              ? Buffer.from(JSON.stringify({ model: query.model, id: last.id })).toString(
                  "base64url",
                )
              : null,
        };
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
  });
}
