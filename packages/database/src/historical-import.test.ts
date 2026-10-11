import type { HistoricalContactInput, HistoricalOpportunityInput } from "@quantum-crm/domain";
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { createContactsHistoricalImportPort } from "./contacts-historical-import-repository.js";
import { withHistoricalImport } from "./historical-import-transaction.js";
import { createSalesHistoricalImportPort } from "./sales-historical-import-repository.js";
import { createSettingsHistoricalImportPort } from "./settings-historical-import-repository.js";
import type { PostgresPool } from "./postgres-database.js";

const memberId = "019b0000-0000-7000-8000-000000000001";
const entityId = "019b0000-0000-7000-8000-000000000002";
const fieldId = "019b0000-0000-7000-8000-000000000003";
const source = {
  system: "GHL" as const,
  locationId: "synthetic-location",
  externalId: "synthetic-contact",
  payloadHash: "a".repeat(64),
  raw: { id: "synthetic-contact", assignedTo: "unmapped-source-advisor" },
};
const context = {
  actor: { memberId, scope: "PROFILE" as const },
  permissions: ["crm:contacts:create", "crm:sales:create", "crm:sales:configure"] as const,
};
const contact: HistoricalContactInput = {
  ...context,
  source,
  displayName: "Synthetic contact",
  email: "person@example.test",
  phone: null,
  ownerMemberId: null,
  labelIds: [],
  customFields: [],
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-02-01T00:00:00Z"),
};

function harness(handler: (text: string, values?: unknown[]) => Promise<unknown>) {
  const query = vi.fn(handler);
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(),
    end: vi.fn(async () => undefined),
    on: vi.fn(),
  } as unknown as PostgresPool;
  return { pool, query, client };
}

describe("historical import durability", () => {
  it("replays external identities without invoking creation or overwriting local changes", async () => {
    const { pool, query } = harness(async (text) => {
      if (text.includes("SELECT entity_id"))
        return {
          rows: [{ entity_id: entityId, payload_hash: source.payloadHash, result_metadata: {} }],
        };
      return { rows: [] };
    });
    const create = vi.fn(async () => ({ id: entityId }));
    await expect(
      withHistoricalImport(pool, "contacts", "contact", contact, create),
    ).resolves.toMatchObject({
      id: entityId,
      status: "REPLAYED",
    });
    expect(create).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([text]) => text.includes("UPDATE "))).toBe(false);
    expect(query.mock.calls.some(([text]) => text.includes("INSERT "))).toBe(false);
    expect(query.mock.calls.some(([text]) => text.includes("pg_advisory_xact_lock"))).toBe(true);
  });

  it("reports changed source without changing the destination", async () => {
    const { pool } = harness(async (text) =>
      text.includes("SELECT entity_id")
        ? { rows: [{ entity_id: entityId, payload_hash: "b".repeat(64), result_metadata: {} }] }
        : { rows: [] },
    );
    const create = vi.fn(async () => ({ id: entityId }));
    await expect(
      withHistoricalImport(pool, "contacts", "contact", contact, create),
    ).resolves.toMatchObject({
      id: entityId,
      status: "SOURCE_CHANGED",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rolls back the entity when writing its durable external map fails", async () => {
    const { pool, query, client } = harness(async (text) => {
      if (text.includes("INSERT INTO contacts.historical_imports"))
        throw new Error("synthetic failure");
      return { rows: [] };
    });
    await expect(
      withHistoricalImport(pool, "contacts", "contact", contact, async (transaction) => {
        await transaction.query("INSERT INTO contacts.contacts DEFAULT VALUES");
        return { id: entityId };
      }),
    ).rejects.toThrow("PostgreSQL dependency is unavailable");
    const statements = query.mock.calls.map(([text]) => text);
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("separates source locations in both replay lookup and lock identity", async () => {
    const { pool, query } = harness(async () => ({ rows: [] }));
    await withHistoricalImport(pool, "contacts", "contact", contact, async () => ({
      id: entityId,
    }));
    await withHistoricalImport(
      pool,
      "contacts",
      "contact",
      {
        ...contact,
        source: { ...source, locationId: "other-location" },
      },
      async () => ({ id: fieldId }),
    );
    const locks = query.mock.calls.filter(([text]) => text.includes("pg_advisory_xact_lock"));
    expect(locks[0]?.[1]).not.toEqual(locks[1]?.[1]);
    const reads = query.mock.calls.filter(([text]) => text.includes("SELECT entity_id"));
    expect(reads[0]?.[1]).toContain("synthetic-location");
    expect(reads[1]?.[1]).toContain("other-location");
  });
});

describe("module historical import ports", () => {
  it("preserves long custom-field names and keys without clipping and rejects values beyond the limit", async () => {
    const { pool, query } = harness(async (text) =>
      text.includes("INSERT INTO settings.custom_field_definitions") ||
      text.includes("INSERT INTO contacts.contacts")
        ? { rows: [{ id: entityId }] }
        : { rows: [] },
    );
    const key = "k".repeat(1000);
    const name = "n".repeat(1000);
    const definition = {
      ...context,
      source,
      key,
      name,
      description: "Synthetic long field",
      dataType: "TEXT",
      section: "contact",
      options: [],
    };
    const settings = createSettingsHistoricalImportPort(pool);
    await expect(settings.importCustomField(definition)).resolves.toMatchObject({
      status: "CREATED",
    });
    const field = { fieldId, key, label: name, dataType: "TEXT", value: "original" };
    const contacts = createContactsHistoricalImportPort(pool);
    await expect(
      contacts.importContact({ ...contact, customFields: [field] }),
    ).resolves.toMatchObject({ status: "CREATED" });
    expect(
      query.mock.calls
        .find(([text]) => text.includes("INSERT INTO settings.custom_field_definitions"))?.[1]
        ?.slice(0, 2),
    ).toEqual([key, name]);
    const saved = query.mock.calls.find(([text]) => text.includes("INSERT INTO contacts.contacts"));
    expect(JSON.parse(String(saved?.[1]?.[4]))).toEqual([field]);
    await expect(settings.importCustomField({ ...definition, key: `${key}x` })).rejects.toThrow();
    await expect(
      contacts.importContact({ ...contact, customFields: [{ ...field, label: `${name}x` }] }),
    ).rejects.toThrow();
  });

  it("maps imported labels to the existing case-insensitive CRM identity", async () => {
    const { pool, query } = harness(async (text) =>
      text.includes("lower(name) = lower($1)") ? { rows: [{ id: entityId }] } : { rows: [] },
    );
    await expect(
      createContactsHistoricalImportPort(pool).importLabel({
        ...context,
        source,
        name: "VIP",
      }),
    ).resolves.toMatchObject({ id: entityId, status: "CREATED" });
    expect(query.mock.calls.some(([text]) => text.includes("INSERT INTO contacts.labels"))).toBe(
      false,
    );
    expect(
      query.mock.calls.some(([text]) => text.includes("INSERT INTO contacts.historical_imports")),
    ).toBe(true);
  });

  it("denies non-profile actors and missing permission before opening the database", async () => {
    const { pool } = harness(async () => ({ rows: [] }));
    const repository = createContactsHistoricalImportPort(pool);
    await expect(
      repository.importContact({ ...contact, actor: { memberId, scope: "OWN" } }),
    ).rejects.toThrow();
    await expect(repository.importContact({ ...contact, permissions: [] })).rejects.toThrow();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("creates a separate person without matching email or phone and stores safe file placeholders", async () => {
    const { pool, query } = harness(async (text) =>
      text.includes("INSERT INTO contacts.contacts") ? { rows: [{ id: entityId }] } : { rows: [] },
    );
    const result = await createContactsHistoricalImportPort(pool).importContact({
      ...contact,
      customFields: [
        { fieldId, key: "file", label: "File", dataType: "FILE_UPLOAD", value: { pending: true } },
      ],
    });
    expect(result).toMatchObject({ id: entityId, status: "CREATED" });
    const statements = query.mock.calls.map(([text]) => text);
    expect(
      statements.some(
        (text) => text.includes("contact.email =") || text.includes("contact.phone ="),
      ),
    ).toBe(false);
    expect(statements.some((text) => text.includes("outbox") || text.includes("automation."))).toBe(
      false,
    );
    const insert = query.mock.calls.find(([text]) =>
      text.includes("INSERT INTO contacts.contacts"),
    );
    expect(String(insert?.[1]?.[4])).toContain("Adjunto pendiente");
    expect(insert?.[1]?.[5]).toEqual(contact.createdAt);
    expect(insert?.[1]?.[6]).toEqual(contact.updatedAt);
  });

  it("rejects an unresolved destination owner without creating contacts", async () => {
    const { pool } = harness(async () => ({ rows: [] }));
    await expect(
      createContactsHistoricalImportPort(pool).importContact({
        ...contact,
        ownerMemberId: memberId,
      }),
    ).rejects.toThrow();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("checks contact ownership through the public port before importing an opportunity", async () => {
    const { pool } = harness(async () => ({ rows: [] }));
    const sales = createSalesHistoricalImportPort(pool, {
      contacts: { existsFor: async () => false },
      members: { isActive: async () => true },
    });
    await expect(sales.importOpportunity(opportunity())).rejects.toThrow();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("rejects a stage from another pipeline before any opportunity write", async () => {
    const { pool, query } = harness(async () => ({ rows: [] }));
    const sales = createSalesHistoricalImportPort(pool, {
      contacts: { existsFor: async () => true },
      members: { isActive: async () => true },
    });
    await expect(sales.importOpportunity(opportunity())).rejects.toThrow();
    expect(
      query.mock.calls.some(([text]) => text.includes("INSERT INTO sales.opportunities")),
    ).toBe(false);
    expect(query.mock.calls.some(([text]) => text === "ROLLBACK")).toBe(true);
  });
});

function opportunity(): HistoricalOpportunityInput {
  return {
    ...context,
    source: { ...source, externalId: "synthetic-opportunity" },
    contactId: entityId,
    pipelineId: entityId,
    stageId: fieldId,
    ownerMemberId: memberId,
    title: "Historical opportunity",
    amountMinor: 12345n,
    currency: "GTQ",
    status: "OPEN",
    closeReason: null,
    closedAt: null,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
  };
}
