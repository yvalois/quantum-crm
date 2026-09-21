import { parseDatabaseConfig } from "@quantum-crm/config";
import {
  createPlatformPostgresDatabase,
  type PlatformPostgresDatabase,
} from "@quantum-crm/database";
import {
  InfrastructureCapacityExceededError,
  ProvisioningOperationConflictError,
  TenantProfileConflictError,
  TenantProfileVersionConflictError,
} from "@quantum-crm/platform-domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const secretPath = "/run/secrets/platform_runtime_database_url";
const config = parseDatabaseConfig(
  "platform-tenant-profile-integration",
  { target: "platform", requiresTenant: false },
  "test",
  { QCRM_DATABASE_URL_FILE: secretPath },
);
const pool = new Pool({ connectionString: config.connectionUrl.expose(), max: 1 });
let database: PlatformPostgresDatabase;
let operatorId: string;
let serverId: string;

beforeAll(async () => {
  await pool.query("DELETE FROM operations.provisioning_operations");
  await pool.query("DELETE FROM infrastructure.capacity_reservations");
  await pool.query("DELETE FROM tenants.tenant_profiles");
  await pool.query("DELETE FROM infrastructure.servers");
  await pool.query("DELETE FROM platform_iam.operator_permissions");
  await pool.query("DELETE FROM platform_iam.operator_memberships");
  const operator = await pool.query<{ id: string }>(`
    INSERT INTO platform_iam.operator_memberships (oidc_subject, status)
    VALUES ('provisioning-integration-operator', 'active')
    RETURNING id::text
  `);
  operatorId = operator.rows[0]!.id;
  const server = await pool.query<{ id: string }>(`
    INSERT INTO infrastructure.servers (
      code, display_name, provider, region, public_ipv4, operating_system,
      architecture, status, total_cpu_millicores, total_memory_mib,
      total_storage_mib, operation_credential_ref, confirmed_at
    ) VALUES (
      'tenant-integration', 'Tenant integration', 'Test provider', 'test-region',
      '192.0.2.30', 'Test Linux 1', 'x86_64', 'available', 100000, 100000,
      1000000, 'secret://test/servers/tenant-integration/ssh-key', CURRENT_TIMESTAMP
    )
    RETURNING id::text
  `);
  serverId = server.rows[0]!.id;
  database = createPlatformPostgresDatabase(config, "tenant-profile-integration");
  await database.connect();
});

afterAll(async () => {
  await pool.query("DELETE FROM operations.provisioning_operations");
  await pool.query("DELETE FROM infrastructure.capacity_reservations");
  await pool.query("DELETE FROM tenants.tenant_profiles");
  await pool.query("DELETE FROM infrastructure.servers");
  await pool.query("DELETE FROM platform_iam.operator_permissions");
  await pool.query("DELETE FROM platform_iam.operator_memberships");
  await database.close();
  await pool.end();
});

describe("platform tenant profile migration", () => {
  it("creates a UUIDv7 profile with normalized constraints and filter indexes", async () => {
    const inserted = await pool.query<{
      id: string;
      id_version: number;
      status: string;
      version: string;
    }>(
      `
      INSERT INTO tenants.tenant_profiles (
        name,
        slug,
        admin_contact_name,
        admin_contact_email,
        server_id,
        release_id
      ) VALUES (
        'Acme Colombia',
        'acme-co',
        'Ana Perez',
        'admin@acme.example',
        $1::uuid,
        '01995f7e-7b52-7000-8000-000000000020'
      )
      RETURNING
        id::text,
        uuid_extract_version(id) AS id_version,
        status::text,
        version::text
    `,
      [serverId],
    );

    expect(inserted.rows[0]).toMatchObject({
      id_version: 7,
      status: "pending",
      version: "1",
    });

    const indexes = await pool.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'tenants' AND tablename = 'tenant_profiles'
      ORDER BY indexname
    `);
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        "tenant_profiles_pkey",
        "tenant_profiles_slug_key",
        "tenant_profiles_status_created_id_idx",
        "tenant_profiles_server_id_idx",
        "tenant_profiles_release_id_idx",
      ]),
    );
  });

  it("rejects duplicate, noncanonical and invalid profile data", async () => {
    await pool.query(`
      INSERT INTO tenants.tenant_profiles
        (name, slug, admin_contact_name, admin_contact_email)
      VALUES
        ('First', 'unique-slug', 'Ana', 'ana@example.test')
    `);

    await expect(
      pool.query(`
        INSERT INTO tenants.tenant_profiles
          (name, slug, admin_contact_name, admin_contact_email)
        VALUES
          ('Second', 'unique-slug', 'Bea', 'bea@example.test')
      `),
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      pool.query(`
        INSERT INTO tenants.tenant_profiles
          (name, slug, admin_contact_name, admin_contact_email)
        VALUES
          ('Uppercase', 'UPPERCASE-SLUG', 'Cia', 'cia@example.test')
      `),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      pool.query(`
        INSERT INTO tenants.tenant_profiles
          (name, slug, admin_contact_name, admin_contact_email)
        VALUES
          (' ', 'invalid-name', 'Ana', 'ana@example.test')
      `),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("allows runtime DML but denies runtime DDL", async () => {
    await expect(
      pool.query(`
        UPDATE tenants.tenant_profiles
        SET status = 'provisioning', version = version + 1, updated_at = transaction_timestamp()
        WHERE slug = 'acme-co'
      `),
    ).resolves.toMatchObject({ rowCount: 1 });

    await expect(
      pool.query("CREATE TABLE tenants.runtime_forbidden(id bigint PRIMARY KEY)"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("creates, filters and conditionally updates through the production repository", async () => {
    const created = await database.tenantProfiles.create({
      name: "Repository Profile",
      slug: "repository-profile",
      adminContactName: "Rita",
      adminContactEmail: "rita@example.test",
      status: "PENDING",
    });
    expect(created.version).toBe(1n);

    const page = await database.tenantProfiles.list({
      status: "PENDING",
      search: "Repository",
      limit: 1,
    });
    expect(page.items.map(({ id }) => id)).toContain(created.id);

    const updated = await database.tenantProfiles.update(created.id, 1n, {
      name: "Repository Profile Updated",
      slug: created.slug,
      adminContactName: created.adminContactName,
      adminContactEmail: created.adminContactEmail,
      status: "ACTIVE",
    });
    expect(updated).toMatchObject({ status: "ACTIVE", version: 2n });
    await expect(
      database.tenantProfiles.update(created.id, 1n, {
        name: created.name,
        slug: created.slug,
        adminContactName: created.adminContactName,
        adminContactEmail: created.adminContactEmail,
        status: created.status,
      }),
    ).resolves.toBeNull();

    await expect(
      database.tenantProfiles.create({
        name: "Duplicate",
        slug: created.slug,
        adminContactName: "Dora",
        adminContactEmail: "dora@example.test",
        status: "PENDING",
      }),
    ).rejects.toBeInstanceOf(TenantProfileConflictError);
  });

  it("records provisioning atomically and replays the same idempotency key", async () => {
    const created = await database.tenantProfiles.create({
      name: "Provisioning Profile",
      slug: "provisioning-profile",
      adminContactName: "Pia",
      adminContactEmail: "pia@example.test",
      status: "PENDING",
    });
    const command = {
      tenantProfileId: created.id,
      serverId,
      releaseId: "01995f7e-7b52-7000-8000-000000000302",
      requestedCapacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10240 },
      requestedByOperatorId: operatorId,
      idempotencyKey: "provisioning-integration-001",
      correlationId: "integration-request-001",
      expectedTenantVersion: created.version,
    } as const;

    const requested = await database.provisioningOperations.request(command);
    expect(requested).toMatchObject({ tenantVersion: 2n, idempotentReplay: false });
    expect(requested.operation).toMatchObject({ status: "PENDING", currentStep: "VALIDATE" });
    await expect(database.tenantProfiles.findById(created.id)).resolves.toMatchObject({
      status: "PROVISIONING",
      serverId: command.serverId,
      releaseId: command.releaseId,
      version: 2n,
    });

    await expect(database.provisioningOperations.request(command)).resolves.toMatchObject({
      operation: { id: requested.operation.id },
      tenantVersion: 2n,
      idempotentReplay: true,
    });
    await expect(
      database.provisioningOperations.request({
        ...command,
        releaseId: "01995f7e-7b52-7000-8000-000000000303",
      }),
    ).rejects.toBeInstanceOf(ProvisioningOperationConflictError);
  });

  it("rejects stale versions without leaving an operation", async () => {
    const created = await database.tenantProfiles.create({
      name: "Stale Provisioning",
      slug: "stale-provisioning",
      adminContactName: "Sia",
      adminContactEmail: "sia@example.test",
      status: "PENDING",
    });
    await expect(
      database.provisioningOperations.request({
        tenantProfileId: created.id,
        serverId,
        releaseId: "01995f7e-7b52-7000-8000-000000000302",
        requestedCapacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10240 },
        requestedByOperatorId: operatorId,
        idempotencyKey: "provisioning-integration-stale",
        correlationId: "integration-request-stale",
        expectedTenantVersion: 99n,
      }),
    ).rejects.toBeInstanceOf(TenantProfileVersionConflictError);
    const count = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM operations.provisioning_operations WHERE tenant_profile_id = $1::uuid",
      [created.id],
    );
    expect(count.rows[0]?.count).toBe("0");
  });

  it("admits only one concurrent request when the remaining capacity fits one", async () => {
    const constrainedServer = await database.infrastructureServers.create({
      code: "concurrency-capacity",
      displayName: "Concurrency capacity",
      provider: "Test provider",
      region: "test-region",
      publicIpv4: "192.0.2.31",
      operatingSystem: "Test Linux 1",
      architecture: "X86_64",
      status: "AVAILABLE",
      totalCapacity: { cpuMillicores: 1000, memoryMiB: 2048, storageMiB: 20000 },
      reservedCapacity: { cpuMillicores: 0, memoryMiB: 0, storageMiB: 0 },
      operationCredentialRef: "secret://test/servers/concurrency/ssh-key",
      confirmedAt: new Date("2026-09-20T12:00:00.000Z"),
    });
    const [first, second] = await Promise.all([
      database.tenantProfiles.create({
        name: "Capacity First",
        slug: "capacity-first",
        adminContactName: "Cora",
        adminContactEmail: "cora@example.test",
        status: "PENDING",
      }),
      database.tenantProfiles.create({
        name: "Capacity Second",
        slug: "capacity-second",
        adminContactName: "Ciro",
        adminContactEmail: "ciro@example.test",
        status: "PENDING",
      }),
    ]);
    const requestedCapacity = {
      cpuMillicores: 600,
      memoryMiB: 1536,
      storageMiB: 15000,
    } as const;

    const results = await Promise.allSettled(
      [first, second].map((profile, index) =>
        database.provisioningOperations.request({
          tenantProfileId: profile.id,
          serverId: constrainedServer.id,
          releaseId: `01995f7e-7b52-7000-8000-00000000050${index}`,
          requestedCapacity,
          requestedByOperatorId: operatorId,
          idempotencyKey: `capacity-concurrency-00${index}`,
          correlationId: `capacity-concurrency-00${index}`,
          expectedTenantVersion: profile.version,
        }),
      ),
    );

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(InfrastructureCapacityExceededError),
    });
    await expect(
      database.infrastructureServers.findById(constrainedServer.id),
    ).resolves.toMatchObject({
      reservedCapacity: requestedCapacity,
      availableCapacity: { cpuMillicores: 400, memoryMiB: 512, storageMiB: 5000 },
    });
    const effects = await pool.query<{ reservations: string; operations: string }>(
      `
        SELECT
          (SELECT count(*)::text FROM infrastructure.capacity_reservations WHERE server_id = $1::uuid) AS reservations,
          (SELECT count(*)::text FROM operations.provisioning_operations WHERE server_id = $1::uuid) AS operations
      `,
      [constrainedServer.id],
    );
    expect(effects.rows[0]).toEqual({ reservations: "1", operations: "1" });
  });

  it("claims once, fences renewal and recovers an expired lease", async () => {
    await pool.query("DELETE FROM operations.provisioning_operations");
    const created = await database.tenantProfiles.create({
      name: "Lease Provisioning",
      slug: "lease-provisioning",
      adminContactName: "Lia",
      adminContactEmail: "lia@example.test",
      status: "PENDING",
    });
    const requested = await database.provisioningOperations.request({
      tenantProfileId: created.id,
      serverId,
      releaseId: "01995f7e-7b52-7000-8000-000000000402",
      requestedCapacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10240 },
      requestedByOperatorId: operatorId,
      idempotencyKey: "provisioning-integration-lease",
      correlationId: "integration-request-lease",
      expectedTenantVersion: created.version,
    });

    const claims = await Promise.all([
      database.provisioningOperations.claimNext({
        workerId: "executor-01",
        leaseDurationSeconds: 60,
      }),
      database.provisioningOperations.claimNext({
        workerId: "executor-02",
        leaseDurationSeconds: 60,
      }),
    ]);
    const claimed = claims.find((operation) => operation !== null);
    expect(claims.filter((operation) => operation !== null)).toHaveLength(1);
    expect(claimed).toMatchObject({
      id: requested.operation.id,
      status: "RUNNING",
      attempt: 1,
    });
    if (!claimed?.lease) throw new Error("Expected a claimed lease");

    await expect(
      database.provisioningOperations.renewLease({
        operationId: claimed.id,
        workerId: claimed.lease.owner === "executor-01" ? "executor-02" : "executor-01",
        leaseDurationSeconds: 60,
        expectedVersion: claimed.version,
      }),
    ).resolves.toBeNull();
    const renewed = await database.provisioningOperations.renewLease({
      operationId: claimed.id,
      workerId: claimed.lease.owner,
      leaseDurationSeconds: 60,
      expectedVersion: claimed.version,
    });
    expect(renewed).toMatchObject({ id: claimed.id, status: "RUNNING" });
    expect(renewed?.version).toBe(claimed.version + 1n);

    await pool.query(
      `
        UPDATE operations.provisioning_operations
        SET
          last_heartbeat_at = CURRENT_TIMESTAMP - INTERVAL '2 seconds',
          lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
        WHERE id = $1::uuid
      `,
      [claimed.id],
    );
    const recovered = await database.provisioningOperations.claimNext({
      workerId: "executor-recovery",
      leaseDurationSeconds: 60,
    });
    expect(recovered).toMatchObject({
      id: claimed.id,
      status: "RUNNING",
      attempt: 2,
      lease: { owner: "executor-recovery" },
    });
  });
});
