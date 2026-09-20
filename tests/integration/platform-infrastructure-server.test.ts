import { parseDatabaseConfig } from "@quantum-crm/config";
import { createPlatformPostgresDatabase } from "@quantum-crm/database";
import { InfrastructureServerConflictError } from "@quantum-crm/platform-domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const config = parseDatabaseConfig(
  "platform-infrastructure-server-integration",
  { target: "platform", requiresTenant: false },
  "test",
  { QCRM_DATABASE_URL_FILE: "/run/secrets/platform_runtime_database_url" },
);
const pool = new Pool({ connectionString: config.connectionUrl.expose(), max: 1 });
const database = createPlatformPostgresDatabase(config, "infrastructure-server-integration");

const draft = {
  code: "integration-primary",
  displayName: "Integration primary",
  provider: "Test provider",
  region: "test-region",
  publicIpv4: "192.0.2.20",
  operatingSystem: "Test Linux 1",
  architecture: "X86_64" as const,
  status: "AVAILABLE" as const,
  totalCapacity: { cpuMillicores: 4000, memoryMiB: 8192, storageMiB: 102400 },
  reservedCapacity: { cpuMillicores: 1000, memoryMiB: 2048, storageMiB: 20480 },
  operationCredentialRef: "secret://test/servers/primary/ssh-key",
  confirmedAt: new Date("2026-09-20T12:00:00.000Z"),
};

beforeAll(async () => {
  await pool.query("DELETE FROM infrastructure.servers");
  await database.connect();
});

afterAll(async () => {
  await pool.query("DELETE FROM infrastructure.servers");
  await database.close();
  await pool.end();
});

describe("platform infrastructure server migration", () => {
  it("persists, filters and updates confirmed capacity", async () => {
    const created = await database.infrastructureServers.create(draft);
    expect(created).toMatchObject({
      code: draft.code,
      availableCapacity: { cpuMillicores: 3000, memoryMiB: 6144, storageMiB: 81920 },
      version: 1n,
    });
    await expect(
      database.infrastructureServers.list({ status: "AVAILABLE", limit: 25 }),
    ).resolves.toMatchObject([{ id: created.id }]);
    const updated = await database.infrastructureServers.update(created.id, 1n, {
      ...draft,
      status: "DRAINING",
    });
    expect(updated).toMatchObject({ status: "DRAINING", version: 2n });
    await expect(database.infrastructureServers.update(created.id, 1n, draft)).resolves.toBeNull();
  });

  it("enforces uniqueness and capacity invariants in PostgreSQL", async () => {
    await expect(database.infrastructureServers.create(draft)).rejects.toBeInstanceOf(
      InfrastructureServerConflictError,
    );
    await expect(
      pool.query(`
        UPDATE infrastructure.servers
        SET reserved_memory_mib = total_memory_mib + 1
        WHERE code = 'integration-primary'
      `),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("stores the credential reference but does not mistake it for a credential value", async () => {
    const result = await pool.query<{ operation_credential_ref: string }>(`
      SELECT operation_credential_ref
      FROM infrastructure.servers
      WHERE code = 'integration-primary'
    `);
    expect(result.rows[0]?.operation_credential_ref).toBe(draft.operationCredentialRef);
    expect(result.rows[0]?.operation_credential_ref).not.toContain("PRIVATE KEY");
  });
});
