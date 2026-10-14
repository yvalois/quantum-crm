import type { CatalogItem } from "@quantum-crm/contracts";
import {
  CatalogIdempotencyConflictError,
  CatalogStockConflictError,
  CatalogValidationError,
  type CatalogCategory,
  type CatalogField,
  type CatalogRepository,
  type CatalogType,
} from "@quantum-crm/domain";
import type { PoolClient } from "pg";

import type { PostgresPool } from "./postgres-database.js";

type Queryable = Pick<PostgresPool, "query">;
interface ItemRow {
  readonly id: string;
  readonly kind: CatalogItem["kind"];
  readonly name: string;
  readonly description: string;
  readonly sku: string | null;
  readonly category_id: string | null;
  readonly item_type_id: string | null;
  readonly price: string;
  readonly currency: string;
  readonly availability_mode: CatalogItem["availabilityMode"];
  readonly capacity: number | null;
  readonly locks_advisor: boolean;
  readonly active: boolean;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly stock_on_hand: string;
  readonly fields: Record<string, unknown>;
}
interface FieldRow {
  readonly id: string;
  readonly item_type_id: string | null;
  readonly item_id: string | null;
  readonly field_key: string;
  readonly label: string;
  readonly description: string;
  readonly value_type: CatalogField["valueType"];
  readonly options: CatalogField["options"];
  readonly required: boolean;
  readonly active: boolean;
  readonly sort_order: number;
}

async function query<Row>(client: Queryable, sql: string, params: unknown[] = []): Promise<readonly Row[]> {
  const result = await client.query(sql, params) as { readonly rows: readonly Row[] };
  return result.rows;
}
const itemColumns = `i.id::text, i.kind, i.name, i.description, i.sku, i.category_id::text,
  i.item_type_id::text, i.price::text, i.currency, i.availability_mode, i.capacity,
  i.locks_advisor, i.active, i.version::text, i.created_at, i.updated_at,
  COALESCE((SELECT sum(delta) FROM catalog.stock_movements m WHERE m.item_id = i.id), 0)::text AS stock_on_hand,
  COALESCE((SELECT jsonb_object_agg(v.field_id::text, v.value) FROM catalog.field_values v WHERE v.item_id = i.id), '{}'::jsonb) AS fields`;

function item(row: ItemRow): CatalogItem {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    sku: row.sku,
    categoryId: row.category_id,
    itemTypeId: row.item_type_id,
    price: row.price,
    currency: row.currency,
    availabilityMode: row.availability_mode,
    capacity: row.capacity,
    locksAdvisor: row.locks_advisor,
    active: row.active,
    stockOnHand: Number(row.stock_on_hand),
    fields: row.fields,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
function field(row: FieldRow): CatalogField {
  return {
    id: row.id,
    itemTypeId: row.item_type_id,
    itemId: row.item_id,
    key: row.field_key,
    label: row.label,
    description: row.description,
    valueType: row.value_type,
    options: row.options,
    required: row.required,
    active: row.active,
    sortOrder: row.sort_order,
  };
}
async function withTransaction<T>(pool: PostgresPool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
async function findItem(client: Queryable, id: string): Promise<CatalogItem | null> {
  const [row] = await query<ItemRow>(client, `SELECT ${itemColumns} FROM catalog.items i WHERE i.id = $1::uuid`, [id]);
  return row ? item(row) : null;
}
async function saveFields(client: Queryable, itemId: string, values: Record<string, unknown>): Promise<void> {
  await client.query("DELETE FROM catalog.field_values WHERE item_id = $1::uuid", [itemId]);
  for (const [fieldId, value] of Object.entries(values)) {
    await client.query(
      `INSERT INTO catalog.field_values (item_id, field_id, value) VALUES ($1::uuid, $2::uuid, $3::jsonb)`,
      [itemId, fieldId, JSON.stringify(value)],
    );
  }
}

export function createCatalogPostgresRepository(pool: PostgresPool): CatalogRepository {
  return {
    listCategories: async () => {
      const rows = await query<{ id: string; name: string; parent_id: string | null; active: boolean }>(pool,
        "SELECT id::text, name, parent_id::text, active FROM catalog.categories ORDER BY name, id LIMIT 500");
      return rows.map((row) => ({ id: row.id, name: row.name, parentId: row.parent_id, active: row.active }));
    },
    createCategory: async (input: CatalogCategory) => {
      await pool.query("INSERT INTO catalog.categories (id, name, parent_id, active) VALUES ($1::uuid, $2, $3::uuid, $4)",
        [input.id, input.name, input.parentId, input.active]);
      return input;
    },
    listTypes: async () => {
      const rows = await query<{ id: string; name: string; description: string; active: boolean }>(pool,
        "SELECT id::text, name, description, active FROM catalog.item_types ORDER BY name, id LIMIT 500");
      return rows;
    },
    createType: async (input: CatalogType) => {
      await pool.query("INSERT INTO catalog.item_types (id, name, description, active) VALUES ($1::uuid, $2, $3, $4)",
        [input.id, input.name, input.description, input.active]);
      return input;
    },
    listFields: async (input) => {
      if (!input.itemTypeId && !input.itemId) return [];
      const rows = await query<FieldRow>(pool,
        `SELECT id::text, item_type_id::text, item_id::text, field_key, label, description,
                value_type, options, required, active, sort_order
         FROM catalog.field_definitions
         WHERE (item_type_id = $1::uuid OR item_id = $2::uuid)
         ORDER BY sort_order, label, id LIMIT 500`, [input.itemTypeId ?? null, input.itemId ?? null]);
      return rows.map(field);
    },
    createField: async (input) => {
      await pool.query(
        `INSERT INTO catalog.field_definitions
         (id, item_type_id, item_id, field_key, label, description, value_type, options, required, active, sort_order)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
        [input.id, input.itemTypeId, input.itemId, input.key, input.label, input.description,
          input.valueType, JSON.stringify(input.options), input.required, input.active, input.sortOrder],
      );
      return input;
    },
    listItems: async (input) => {
      const rows = await query<ItemRow>(pool,
        `SELECT ${itemColumns} FROM catalog.items i
         WHERE ($1::text IS NULL OR i.kind = $1)
           AND ($2::uuid IS NULL OR i.category_id = $2)
           AND ($3::text IS NULL OR i.name ILIKE '%' || $3 || '%' OR i.sku ILIKE '%' || $3 || '%')
           AND ($4::boolean OR i.active)
         ORDER BY i.name, i.id LIMIT $5`,
        [input.kind ?? null, input.categoryId ?? null, input.query ?? null, input.includeInactive, input.limit]);
      return rows.map(item);
    },
    findItem: async (id) => findItem(pool, id),
    createItem: async (input) => withTransaction(pool, async (client) => {
      await client.query(
        `INSERT INTO catalog.items
         (id, kind, name, description, sku, category_id, item_type_id, price, currency,
          availability_mode, capacity, locks_advisor, active, version, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7::uuid, $8::numeric, $9,
                 $10, $11, $12, $13, 1, $14::timestamptz, $15::timestamptz)`,
        [input.id, input.kind, input.name, input.description, input.sku, input.categoryId,
          input.itemTypeId, input.price, input.currency, input.availabilityMode, input.capacity,
          input.locksAdvisor, input.active, input.createdAt, input.updatedAt],
      );
      await saveFields(client, input.id, input.fields);
      const created = await findItem(client, input.id);
      if (!created) throw new CatalogValidationError("Catalog item creation failed");
      return created;
    }),
    updateItem: async ({ item: input, expectedVersion }) => withTransaction(pool, async (client) => {
      const [locked] = await query<{ availability_mode: string; capacity: number | null; locks_advisor: boolean }>(client,
        "SELECT availability_mode, capacity, locks_advisor FROM catalog.items WHERE id = $1::uuid AND version = $2 FOR UPDATE",
        [input.id, expectedVersion.toString()]);
      if (!locked) return null;
      if (locked.availability_mode !== input.availabilityMode || locked.capacity !== input.capacity || locked.locks_advisor !== input.locksAdvisor) {
        const [count] = await query<{ count: string }>(client,
          "SELECT count(*)::text AS count FROM catalog.capacity_reservations WHERE item_id = $1::uuid AND active", [input.id]);
        if (Number(count?.count ?? 0) > 0) throw new CatalogStockConflictError("Cannot change availability with active reservations");
      }
      await client.query(
        `UPDATE catalog.items SET kind = $2, name = $3, description = $4, sku = $5,
         category_id = $6::uuid, item_type_id = $7::uuid, price = $8::numeric, currency = $9,
         availability_mode = $10, capacity = $11, locks_advisor = $12, active = $13,
         version = version + 1, updated_at = $14::timestamptz WHERE id = $1::uuid`,
        [input.id, input.kind, input.name, input.description, input.sku, input.categoryId,
          input.itemTypeId, input.price, input.currency, input.availabilityMode, input.capacity,
          input.locksAdvisor, input.active, input.updatedAt],
      );
      await saveFields(client, input.id, input.fields);
      return findItem(client, input.id);
    }),
    adjustStock: async (input) => withTransaction(pool, async (client) => {
      const [locked] = await query<{ availability_mode: string }>(client,
        "SELECT availability_mode FROM catalog.items WHERE id = $1::uuid FOR UPDATE", [input.itemId]);
      if (!locked || locked.availability_mode !== "stock") throw new CatalogValidationError("Not a stock item");
      const [prior] = await query<{ delta: number; reason: string }>(client,
        `SELECT delta, reason FROM catalog.stock_movements
         WHERE item_id = $1::uuid AND actor_member_id = $2::uuid AND idempotency_key = $3`,
        [input.itemId, input.actorMemberId, input.idempotencyKey]);
      if (prior) {
        if (prior.delta !== input.delta || prior.reason !== input.reason) throw new CatalogIdempotencyConflictError();
        const existing = await findItem(client, input.itemId);
        if (!existing) throw new CatalogValidationError("Stock item disappeared");
        return existing;
      }
      const [balance] = await query<{ quantity: string }>(client,
        "SELECT COALESCE(sum(delta), 0)::text AS quantity FROM catalog.stock_movements WHERE item_id = $1::uuid", [input.itemId]);
      if (Number(balance?.quantity ?? 0) + input.delta < 0) throw new CatalogStockConflictError("Insufficient stock");
      await client.query(
        `INSERT INTO catalog.stock_movements (item_id, delta, reason, actor_member_id, idempotency_key)
         VALUES ($1::uuid, $2, $3, $4::uuid, $5)`,
        [input.itemId, input.delta, input.reason, input.actorMemberId, input.idempotencyKey],
      );
      await client.query("UPDATE catalog.items SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid", [input.itemId]);
      const updated = await findItem(client, input.itemId);
      if (!updated) throw new CatalogValidationError("Stock item disappeared");
      return updated;
    }),
  };
}
