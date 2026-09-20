import type { DatabaseConfig } from "@quantum-crm/config";
import { SecretValue } from "@quantum-crm/config";
import { describe, expect, it, vi } from "vitest";

import {
  createPostgresDatabase,
  DatabaseUnavailableError,
  type PostgresPoolFactory,
} from "./postgres-database.js";

const databaseConfig: DatabaseConfig = Object.freeze({
  schemaVersion: "database-config/v1",
  target: "crm",
  tenantId: "00000000-0000-4000-8000-000000000001",
  connectionUrl: new SecretValue(
    "postgresql://runtime:test-only-not-a-secret@postgres:5432/profile_a",
  ),
  poolMax: 5,
  connectionTimeoutMs: 5_000,
  statementTimeoutMs: 15_000,
  lockTimeoutMs: 5_000,
  idleInTransactionTimeoutMs: 10_000,
});

function createPoolDouble(options: { readonly connectFails?: boolean } = {}): {
  readonly factory: PostgresPoolFactory;
  readonly poolConfig: () => Record<string, unknown>;
  readonly query: ReturnType<typeof vi.fn>;
  readonly end: ReturnType<typeof vi.fn>;
} {
  let capturedConfig: Record<string, unknown> = {};
  const query = vi.fn(async () => ({
    rows: [
      {
        server_version_num: 180_000,
        can_create_database_objects: false,
        can_create_public_objects: false,
      },
    ],
  }));
  const release = vi.fn();
  const end = vi.fn(async () => undefined);
  const factory: PostgresPoolFactory = (config) => {
    capturedConfig = config as Record<string, unknown>;
    return {
      connect: options.connectFails
        ? async () => Promise.reject(new Error("connection failed"))
        : async () => ({ query, release }) as never,
      query,
      end,
      on: vi.fn(),
    };
  };

  return { factory, poolConfig: () => capturedConfig, query, end };
}

describe("PostgreSQL database", () => {
  it("uses bounded pool settings and becomes ready after its initial probe", async () => {
    const pool = createPoolDouble();
    const database = createPostgresDatabase(databaseConfig, "api", pool.factory);

    expect(await database.isReady()).toBe(false);
    await database.connect();
    expect(await database.isReady()).toBe(true);
    expect(pool.poolConfig()).toMatchObject({
      application_name: "quantum-crm:api",
      max: 5,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      lock_timeout: 5_000,
      idle_in_transaction_session_timeout: 10_000,
    });
    expect(pool.poolConfig()).toHaveProperty("connectionString");
  });

  it("fails closed with a generic error when the initial connection is unavailable", async () => {
    const pool = createPoolDouble({ connectFails: true });
    const database = createPostgresDatabase(databaseConfig, "api", pool.factory);

    await expect(database.connect()).rejects.toEqual(new DatabaseUnavailableError());
    expect(await database.isReady()).toBe(false);
  });

  it("closes the pool once and remains not ready", async () => {
    const pool = createPoolDouble();
    const database = createPostgresDatabase(databaseConfig, "worker", pool.factory);

    await database.connect();
    await database.close();
    await database.close();

    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(await database.isReady()).toBe(false);
    await expect(database.connect()).rejects.toEqual(new DatabaseUnavailableError());
  });
});
