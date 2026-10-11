import { Buffer } from "node:buffer";
import { CustomFieldDefinitionValidationError } from "@quantum-crm/domain";
import { describe, expect, it, vi } from "vitest";
import { createSettingsCustomFieldPostgresRepository } from "./settings-custom-field-postgres-repository.js";
import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

const fieldId = "019b0000-0000-7000-8000-000000000001";
const field = {
  id: fieldId,
  field_key: "contact.favorite_color",
  name: "Color favorito",
  description: "Preferencia del contacto",
  data_type: "TEXT",
};

function poolWith(query: PostgresPool["query"]): PostgresPool {
  return {
    query,
    connect: vi.fn(),
    end: vi.fn(async () => undefined),
    on: vi.fn(),
  };
}

describe("settings custom field catalog persistence", () => {
  it("reads only the requested model and paginates without exposing source payloads", async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({
      rows: [field, { ...field, id: "019b0000-0000-7000-8000-000000000002" }],
    }));
    const repository = createSettingsCustomFieldPostgresRepository(poolWith(query));
    const result = await repository.list({ model: "contact", limit: 1 });
    expect(result.items).toEqual([{
      id: fieldId,
      key: field.field_key,
      label: field.name,
      description: field.description,
      dataType: field.data_type,
      model: "contact",
    }]);
    expect(result.nextCursor).not.toBeNull();
    expect(query.mock.calls[0]?.[1]).toEqual(["contact", null, 2]);
    expect(query.mock.calls[0]?.[0]).toContain("FROM settings.custom_field_definitions");
    expect(query.mock.calls[0]?.[0]).not.toContain("source_payload");
    await repository.list({ model: "contact", limit: 1, cursor: result.nextCursor! });
    expect(query.mock.calls[1]?.[1]).toEqual(["contact", fieldId, 2]);
  });

  it("rejects a cursor from another model before querying the profile database", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const repository = createSettingsCustomFieldPostgresRepository(poolWith(query));
    const cursor = Buffer.from(JSON.stringify({ model: "contact", id: fieldId })).toString("base64url");
    await expect(repository.list({ model: "opportunity", limit: 100, cursor })).rejects.toThrow(
      CustomFieldDefinitionValidationError,
    );
    await expect(repository.list({ model: "contact", limit: 100, cursor: "invalid" })).rejects.toThrow(
      CustomFieldDefinitionValidationError,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("uses each configured profile pool without selecting a caller-provided tenant", async () => {
    const profileA = createSettingsCustomFieldPostgresRepository(
      poolWith(vi.fn(async () => ({ rows: [field] }))),
    );
    const profileB = createSettingsCustomFieldPostgresRepository(
      poolWith(vi.fn(async () => ({ rows: [] }))),
    );
    expect((await profileA.list({ model: "contact", limit: 100 })).items).toHaveLength(1);
    expect((await profileB.list({ model: "contact", limit: 100 })).items).toHaveLength(0);
    const unavailable = createSettingsCustomFieldPostgresRepository(
      poolWith(vi.fn(async () => { throw new Error("private database error"); })),
    );
    await expect(unavailable.list({ model: "contact", limit: 100 })).rejects.toThrow(
      DatabaseUnavailableError,
    );
  });
});
