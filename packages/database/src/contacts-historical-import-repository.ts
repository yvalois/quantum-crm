import {
  authorizeHistoricalImport,
  HistoricalImportValidationError,
  validateHistoricalDates,
  validateHistoricalJson,
  type HistoricalContactImportPort,
  type SalesMemberLookup,
} from "@quantum-crm/domain";

import { withHistoricalImport } from "./historical-import-transaction.js";
import type { PostgresPool } from "./postgres-database.js";

export function createContactsHistoricalImportPort(
  pool: PostgresPool,
  members: SalesMemberLookup = { isActive: async () => false },
): HistoricalContactImportPort {
  return Object.freeze<HistoricalContactImportPort>({
    importLabel: async (input) => {
      authorizeHistoricalImport(input, "crm:contacts:create");
      if (!input.name.trim() || input.name.length > 80) throw new HistoricalImportValidationError();
      return withHistoricalImport(pool, "contacts", "label", input, async (client) => {
        // Labels follow the CRM's case-insensitive naming; people never match by email or phone.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `historical-label:${input.name.toLowerCase()}`,
        ]);
        const canonical = await client.query<{ readonly id: string }>(
          "SELECT id::text FROM contacts.labels WHERE lower(name) = lower($1) ORDER BY id LIMIT 1 FOR UPDATE",
          [input.name],
        );
        if (canonical.rows[0]) return canonical.rows[0];
        const result = await client.query<{ readonly id: string }>(
          `INSERT INTO contacts.labels (name) VALUES ($1)
           ON CONFLICT (name) DO NOTHING RETURNING id::text`,
          [input.name],
        );
        const created = result.rows[0];
        if (created) return created;
        const existing = await client.query<{ readonly id: string }>(
          "SELECT id::text FROM contacts.labels WHERE name = $1",
          [input.name],
        );
        if (!existing.rows[0]) throw new HistoricalImportValidationError();
        return existing.rows[0];
      });
    },
    importContact: async (input) => {
      authorizeHistoricalImport(input, "crm:contacts:create");
      validateHistoricalDates(input.createdAt, input.updatedAt);
      if (input.ownerMemberId !== null && input.ownerMemberId !== input.actor.memberId) {
        authorizeHistoricalImport(input, "crm:contacts:assign");
      }
      if (
        !input.displayName.trim() ||
        input.displayName.length > 160 ||
        (input.email !== null &&
          (input.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(input.email))) ||
        (input.phone !== null && (input.phone.length < 3 || input.phone.length > 40)) ||
        input.customFields.length > 500 ||
        input.labelIds.length > 500
      )
        throw new HistoricalImportValidationError();
      if (input.ownerMemberId !== null && !(await members.isActive(input.ownerMemberId))) {
        throw new HistoricalImportValidationError();
      }
      const fieldIds = new Set<string>();
      const customFields = input.customFields.map((field) => {
        if (
          !field.fieldId ||
          fieldIds.has(field.fieldId) ||
          !field.key ||
          field.key.length > 1000 ||
          !field.label ||
          field.label.length > 1000 ||
          !field.dataType ||
          field.dataType.length > 100
        ) {
          throw new HistoricalImportValidationError();
        }
        fieldIds.add(field.fieldId);
        validateHistoricalJson(field.value);
        return {
          ...field,
          // URL references are not files approved by Files/ClamAV, nor API attachment links.
          value:
            field.dataType.toUpperCase() === "FILE_UPLOAD"
              ? "Adjunto pendiente de transferencia y análisis"
              : field.value,
        };
      });
      return withHistoricalImport(pool, "contacts", "contact", input, async (client) => {
        const labelIds = [...new Set(input.labelIds)];
        if (labelIds.length) {
          const labels = await client.query<{ readonly id: string }>(
            "SELECT id::text FROM contacts.labels WHERE id = ANY($1::uuid[]) FOR KEY SHARE",
            [labelIds],
          );
          if (labels.rows.length !== labelIds.length) throw new HistoricalImportValidationError();
        }
        const inserted = await client.query<{ readonly id: string }>(
          `INSERT INTO contacts.contacts
           (owner_member_id, display_name, email, phone, source, custom_fields, created_at, updated_at)
           VALUES ($1::uuid, $2, $3::citext, $4, 'migration', $5::jsonb, $6, $7) RETURNING id::text`,
          [
            input.ownerMemberId,
            input.displayName,
            input.email,
            input.phone,
            JSON.stringify(customFields),
            input.createdAt,
            input.updatedAt,
          ],
        );
        const contact = inserted.rows[0];
        if (!contact) throw new HistoricalImportValidationError();
        if (labelIds.length) {
          await client.query(
            `INSERT INTO contacts.contact_labels (contact_id, label_id)
             SELECT $1::uuid, unnest($2::uuid[])`,
            [contact.id, labelIds],
          );
        }
        return contact;
      });
    },
  });
}

export function createContactsHistoricalImportVerification(pool: PostgresPool) {
  return {
    verify: async (locationId: string) => {
      const client = await pool.connect();
      try {
        const result = await client.query<{
          mapped_contacts: string;
          existing_contacts: string;
          mapped_labels: string;
          existing_labels: string;
          custom_field_values: string;
        }>(
          `SELECT
            count(*) FILTER (WHERE map.entity_type = 'contact')::text AS mapped_contacts,
            count(contact.id)::text AS existing_contacts,
            count(*) FILTER (WHERE map.entity_type = 'label')::text AS mapped_labels,
            count(label.id)::text AS existing_labels,
            COALESCE(sum(jsonb_array_length(contact.custom_fields)), 0)::text AS custom_field_values
           FROM contacts.historical_imports AS map
           LEFT JOIN contacts.contacts AS contact ON map.entity_type = 'contact' AND contact.id = map.entity_id
           LEFT JOIN contacts.labels AS label ON map.entity_type = 'label' AND label.id = map.entity_id
           WHERE map.source_system = 'GHL' AND map.source_location_id = $1`,
          [locationId],
        );
        const row = result.rows[0];
        if (!row) throw new HistoricalImportValidationError();
        return {
          mappedContacts: Number(row.mapped_contacts),
          existingContacts: Number(row.existing_contacts),
          mappedLabels: Number(row.mapped_labels),
          existingLabels: Number(row.existing_labels),
          customFieldValues: Number(row.custom_field_values),
        };
      } finally {
        client.release();
      }
    },
  };
}
