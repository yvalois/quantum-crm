import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { createActivationDeliveryRepository } from "./activation-delivery-repository.js";
import type { PostgresPool } from "./postgres-database.js";

const now = new Date("2026-09-27T12:00:00.000Z");
const tenantProfileId = "019b0000-0000-7000-8000-000000000101";
const operatorId = "019b0000-0000-7000-8000-000000000102";
const administratorSubject = "019b0000-0000-7000-8000-000000000103";
const idempotencyKey = ["activation", "20260927"].join("-");

const administratorRow = {
  tenant_profile_id: tenantProfileId,
  keycloak_subject: administratorSubject,
  generation: 1,
  status: "activation_issued",
  expires_at: new Date("2026-09-27T11:30:00.000Z"),
  consumed_at: null,
  version: "2",
  created_at: now,
  updated_at: now,
  tenant_version: "3",
};

const insertedIntent = {
  id: "019b0000-0000-7000-8000-000000000104",
  tenant_profile_id: tenantProfileId,
  requested_by_operator_id: operatorId,
  administrator_subject: administratorSubject,
  generation: 2,
  expires_at: new Date("2026-09-27T12:30:00.000Z"),
  correlation_id: "activation-20260927",
  idempotency_key: idempotencyKey,
  payload_hash: "a".repeat(64),
  status: "pending",
  lease_owner: null,
  lease_expires_at: null,
  result_code: null,
  version: "1",
  created_at: now,
  updated_at: now,
};

describe("activation delivery repository expiry", () => {
  it("terminalizes a tenant's expired active intents inside the reissue transaction", async () => {
    const clientQuery = vi.fn(async (text: string) => {
      if (
        text.includes("FROM operations.activation_delivery_intents WHERE requested_by_operator_id")
      )
        return { rows: [] };
      if (text.includes("FROM tenants.tenant_initial_administrators administrator"))
        return { rows: [administratorRow] };
      if (text.startsWith("INSERT INTO operations.activation_delivery_intents"))
        return { rows: [insertedIntent] };
      return { rows: [] };
    });
    const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    } as unknown as PostgresPool;

    await createActivationDeliveryRepository(pool).request({
      id: insertedIntent.id,
      tenantProfileId,
      requestedByOperatorId: operatorId,
      expectedTenantVersion: 3n,
      idempotencyKey: insertedIntent.idempotency_key,
      payloadHash: insertedIntent.payload_hash,
      correlationId: insertedIntent.correlation_id,
      now,
    });

    const statements = clientQuery.mock.calls.map(([text]) => text as string);
    const expireIndex = statements.findIndex((text) =>
      text.startsWith("UPDATE operations.activation_delivery_intents SET status='expired'"),
    );
    const insertIndex = statements.findIndex((text) =>
      text.startsWith("INSERT INTO operations.activation_delivery_intents"),
    );
    expect(statements[0]).toBe("BEGIN");
    expect(expireIndex).toBeGreaterThan(0);
    expect(expireIndex).toBeLessThan(insertIndex);
    expect(statements[expireIndex]).toContain(
      "status IN ('pending', 'claimed') AND expires_at <= $2",
    );
    expect(statements.at(-1)).toBe("COMMIT");
  });

  it("terminalizes expired pending and claimed intents before finding the next delivery", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const pool = { connect: vi.fn(), query, end: vi.fn(), on: vi.fn() } as unknown as PostgresPool;

    await expect(
      createActivationDeliveryRepository(pool).claimNext({
        workerId: "deploy-executor:test",
        leaseDurationSeconds: 30,
        now,
      }),
    ).resolves.toBeNull();

    const statement = query.mock.calls[0]?.[0] as string;
    expect(statement).toContain("WITH expired AS");
    expect(statement).toContain(
      "status='expired', result_code='EXPIRED', lease_owner=NULL, lease_expires_at=NULL",
    );
    expect(statement).toContain("status IN ('pending', 'claimed') AND expires_at <= $3");
    expect(statement).toContain("candidate AS");
  });

  it("marks an administrator consumed only with its delivered generation", async () => {
    const deliveredIntent = { ...insertedIntent, status: "delivered", version: "3" };
    const consumedIntent = {
      ...deliveredIntent,
      status: "consumed",
      result_code: "CONSUMED",
      version: "4",
    };
    const clientQuery = vi.fn(async (text: string) => {
      if (text.startsWith("SELECT id::text") && text.includes("status='delivered'"))
        return { rows: [deliveredIntent] };
      if (text.startsWith("UPDATE tenants.tenant_initial_administrators"))
        return {
          rows: [{ ...administratorRow, status: "consumed", consumed_at: now, version: "3" }],
        };
      if (text.startsWith("UPDATE operations.activation_delivery_intents SET status='consumed'"))
        return { rows: [consumedIntent] };
      return { rows: [] };
    });
    const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    } as unknown as PostgresPool;

    await expect(
      createActivationDeliveryRepository(pool).consumeInitialAdministrator({
        tenantProfileId,
        subject: administratorSubject,
        generation: 2,
        now,
      }),
    ).resolves.toMatchObject({ status: "CONSUMED" });

    const statements = clientQuery.mock.calls.map(([text]) => text as string);
    expect(statements).toContainEqual(expect.stringContaining("status='delivered' FOR UPDATE"));
    expect(statements).toContainEqual(
      expect.stringContaining("SET status='consumed', result_code='CONSUMED'"),
    );
  });

  it("does not consume an administrator when no delivered intent exists", async () => {
    const clientQuery = vi.fn(async () => ({ rows: [] }));
    const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    } as unknown as PostgresPool;

    await expect(
      createActivationDeliveryRepository(pool).consumeInitialAdministrator({
        tenantProfileId,
        subject: administratorSubject,
        generation: 2,
        now,
      }),
    ).resolves.toBeNull();

    expect(clientQuery.mock.calls.map(([text]) => text as string)).not.toContainEqual(
      expect.stringContaining("UPDATE tenants.tenant_initial_administrators SET status='consumed'"),
    );
  });
});
