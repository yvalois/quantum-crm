import {
  authorizeHistoricalImport,
  HistoricalImportValidationError,
  validateHistoricalJson,
  type HistoricalSettingsImportPort,
} from "@quantum-crm/domain";

import { withHistoricalImport } from "./historical-import-transaction.js";
import type { PostgresPool } from "./postgres-database.js";

export function createSettingsHistoricalImportPort(
  pool: PostgresPool,
): HistoricalSettingsImportPort {
  return Object.freeze<HistoricalSettingsImportPort>({
    importCustomField: async (input) => {
      authorizeHistoricalImport(input, "crm:contacts:create");
      if (
        !input.key ||
        input.key.length > 1000 ||
        !input.name ||
        input.name.length > 1000 ||
        !input.dataType ||
        input.dataType.length > 100 ||
        !input.section ||
        input.section.length > 100 ||
        input.description.length > 100_000
      )
        throw new HistoricalImportValidationError();
      validateHistoricalJson(input.options);
      return withHistoricalImport(pool, "settings", "custom_field", input, async (client) => {
        const inserted = await client.query<{ readonly id: string }>(
          `INSERT INTO settings.custom_field_definitions
           (field_key, name, description, data_type, section, options)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id::text`,
          [
            input.key,
            input.name,
            input.description,
            input.dataType,
            input.section,
            JSON.stringify(input.options),
          ],
        );
        if (!inserted.rows[0]) throw new HistoricalImportValidationError();
        return inserted.rows[0];
      });
    },
  });
}

export function createSettingsHistoricalImportVerification(pool: PostgresPool) {
  return {
    verify: async (locationId: string) => {
      const client = await pool.connect();
      try {
        const result = await client.query<{ mapped_fields: string; existing_fields: string }>(
          `SELECT count(*)::text AS mapped_fields, count(field.id)::text AS existing_fields
           FROM settings.historical_imports AS map
           LEFT JOIN settings.custom_field_definitions AS field ON field.id = map.entity_id
           WHERE map.source_system = 'GHL' AND map.source_location_id = $1 AND map.entity_type = 'custom_field'`,
          [locationId],
        );
        const row = result.rows[0];
        if (!row) throw new HistoricalImportValidationError();
        return {
          mappedFields: Number(row.mapped_fields),
          existingFields: Number(row.existing_fields),
        };
      } finally {
        client.release();
      }
    },
  };
}
