import { parseDatabaseConfig } from "@quantum-crm/config";
import {
  createPlatformPostgresDatabase,
  type PlatformPostgresDatabase,
} from "@quantum-crm/database";
import {
  InfrastructureCapacityExceededError,
  InfrastructureServerNotAdmissibleError,
  PlatformReleaseNotDeployableError,
  platformReleaseArtifactNames,
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

const releaseIds = [
  "01995f7e-7b52-7000-8000-000000000020",
  "01995f7e-7b52-7000-8000-000000000302",
  "01995f7e-7b52-7000-8000-000000000303",
  "01995f7e-7b52-7000-8000-000000000402",
  "01995f7e-7b52-7000-8000-000000000500",
  "01995f7e-7b52-7000-8000-000000000501",
  "01995f7e-7b52-7000-8000-000000000520",
] as const;

const releaseArtifacts = platformReleaseArtifactNames.map((name, index) => ({
  name,
  digest: `sha256:${index.toString(16).padStart(64, "0")}`,
}));

beforeAll(async () => {
  await pool.query("DELETE FROM operations.activation_delivery_intents");
  await pool.query("DELETE FROM tenants.tenant_initial_administrators");
  await pool.query("DELETE FROM operations.provisioning_step_results");
  await pool.query("DELETE FROM operations.provisioning_operations");
  await pool.query("DELETE FROM infrastructure.capacity_reservations");
  await pool.query("DELETE FROM tenants.tenant_profiles");
  await pool.query("DELETE FROM infrastructure.servers");
  await pool.query("BEGIN");
  await pool.query("DELETE FROM releases.release_artifacts");
  await pool.query("DELETE FROM releases.releases");
  await pool.query("COMMIT");
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
  await pool.query("BEGIN");
  for (const [index, releaseId] of releaseIds.entries()) {
    await pool.query(
      `
        INSERT INTO releases.releases (
          id, semantic_version, commit_sha, status, release_notes,
          configuration_schema_version, agent_contract_version,
          database_migration_required
        ) VALUES ($1::uuid, $2, $3, 'validated', 'Integration fixture', 1, 'agent/v1', false)
      `,
      [releaseId, `0.0.${index + 1}`, (index + 1).toString(16).padStart(40, "0")],
    );
    for (const artifact of releaseArtifacts) {
      await pool.query(
        `
          INSERT INTO releases.release_artifacts (release_id, name, digest)
          VALUES ($1::uuid, $2::releases.release_artifact_name, $3)
        `,
        [releaseId, artifact.name.toLowerCase().replaceAll("_", "-"), artifact.digest],
      );
    }
  }
  await pool.query("COMMIT");
  database = createPlatformPostgresDatabase(config, "tenant-profile-integration");
  await database.connect();
});

afterAll(async () => {
  await pool.query("DELETE FROM operations.activation_delivery_intents");
  await pool.query("DELETE FROM tenants.tenant_initial_administrators");
  await pool.query("DELETE FROM operations.provisioning_step_results");
  await pool.query("DELETE FROM operations.provisioning_operations");
  await pool.query("DELETE FROM infrastructure.capacity_reservations");
  await pool.query("DELETE FROM tenants.tenant_profiles");
  await pool.query("DELETE FROM infrastructure.servers");
  await pool.query("BEGIN");
  await pool.query("DELETE FROM releases.release_artifacts");
  await pool.query("DELETE FROM releases.releases");
  await pool.query("COMMIT");
  await pool.query("DELETE FROM platform_iam.operator_permissions");
  await pool.query("DELETE FROM platform_iam.operator_memberships");
  await database.close();
  await pool.end();
});

describe("platform tenant profile migration", () => {
  it("persists and transitions an exact release catalog entry", async () => {
    const candidate = await database.releases.create({
      id: "01995f7e-7b52-7000-8000-000000000601",
      semanticVersion: "1.0.0-candidate.1",
      commitSha: "a".repeat(40),
      releaseNotes: "Integration candidate.",
      compatibility: {
        configurationSchemaVersion: 1,
        agentContractVersion: "agent/v1",
        databaseMigrationRequired: false,
      },
      artifacts: releaseArtifacts,
    });
    expect(candidate).toMatchObject({ status: "CANDIDATE", version: 1n });
    expect(candidate.artifacts).toHaveLength(platformReleaseArtifactNames.length);

    const validated = await database.releases.updateStatus(candidate.id, 1n, "VALIDATED");
    expect(validated).toMatchObject({ status: "VALIDATED", version: 2n });
    await expect(database.releases.list({ status: "VALIDATED", limit: 20 })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: candidate.id })]),
    );
    await expect(database.releases.updateStatus(candidate.id, 1n, "RETIRED")).resolves.toBeNull();
  });

  it("rejects an incomplete artifact set at transaction commit", async () => {
    await pool.query("BEGIN");
    try {
      await pool.query(`
        INSERT INTO releases.releases (
          id, semantic_version, commit_sha, release_notes,
          configuration_schema_version, agent_contract_version,
          database_migration_required
        ) VALUES (
          '01995f7e-7b52-7000-8000-000000000603',
          '1.0.0-incomplete.1',
          'cccccccccccccccccccccccccccccccccccccccc',
          'Incomplete fixture', 1, 'agent/v1', false
        )
      `);
      await pool.query(`
        INSERT INTO releases.release_artifacts (release_id, name, digest)
        VALUES (
          '01995f7e-7b52-7000-8000-000000000603',
          'api',
          'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
        )
      `);
      await expect(pool.query("COMMIT")).rejects.toMatchObject({ code: "23514" });
    } finally {
      await pool.query("ROLLBACK");
    }
  });

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
        "tenant_profiles_live_slug_uq",
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

  it("releases the slug only after deletion and preserves the tombstone", async () => {
    const deleted = await pool.query<{ id: string }>(`
      INSERT INTO tenants.tenant_profiles
        (name, slug, admin_contact_name, admin_contact_email, status)
      VALUES
        ('Previous InterAmerican', 'interamerican-recreated', 'Gabriela', 'old@example.test', 'deleted')
      RETURNING id::text
    `);

    const recreated = await pool.query<{ id: string; slug: string; status: string }>(`
      INSERT INTO tenants.tenant_profiles
        (name, slug, admin_contact_name, admin_contact_email)
      VALUES
        ('InterAmerican', 'interamerican-recreated', 'Gabriela', 'new@example.test')
      RETURNING id::text, slug::text, status::text
    `);

    expect(recreated.rows[0]).toMatchObject({
      slug: "interamerican-recreated",
      status: "pending",
    });
    expect(recreated.rows[0]?.id).not.toBe(deleted.rows[0]?.id);
    await expect(
      pool.query(`
        INSERT INTO tenants.tenant_profiles
          (name, slug, admin_contact_name, admin_contact_email)
        VALUES
          ('Conflicting live profile', 'interamerican-recreated', 'Ada', 'ada@example.test')
      `),
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      pool.query(`SELECT count(*)::int AS count FROM tenants.tenant_profiles WHERE slug = $1`, [
        "interamerican-recreated",
      ]),
    ).resolves.toMatchObject({ rows: [{ count: 2 }] });
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

  it("rejects missing and unavailable servers without partial effects", async () => {
    const unavailableServer = await database.infrastructureServers.create({
      code: "unavailable-capacity",
      displayName: "Unavailable capacity",
      provider: "Test provider",
      region: "test-region",
      publicIpv4: "192.0.2.32",
      operatingSystem: "Test Linux 1",
      architecture: "X86_64",
      status: "UNAVAILABLE",
      totalCapacity: { cpuMillicores: 1000, memoryMiB: 2048, storageMiB: 20000 },
      reservedCapacity: { cpuMillicores: 0, memoryMiB: 0, storageMiB: 0 },
      operationCredentialRef: "secret://test/servers/unavailable/ssh-key",
      confirmedAt: new Date("2026-09-20T12:00:00.000Z"),
    });
    const profile = await database.tenantProfiles.create({
      name: "Rejected Capacity",
      slug: "rejected-capacity",
      adminContactName: "Rafa",
      adminContactEmail: "rafa@example.test",
      status: "PENDING",
    });
    const baseCommand = {
      tenantProfileId: profile.id,
      releaseId: "01995f7e-7b52-7000-8000-000000000520",
      requestedCapacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10000 },
      requestedByOperatorId: operatorId,
      correlationId: "reject-01",
      expectedTenantVersion: profile.version,
    } as const;

    await expect(
      database.provisioningOperations.request({
        ...baseCommand,
        serverId: unavailableServer.id,
        idempotencyKey: "blocked-01",
      }),
    ).rejects.toBeInstanceOf(InfrastructureServerNotAdmissibleError);
    await expect(
      database.provisioningOperations.request({
        ...baseCommand,
        serverId: "01995f7e-7b52-7000-8000-000000000599",
        idempotencyKey: "missing-01",
      }),
    ).rejects.toBeInstanceOf(InfrastructureServerNotAdmissibleError);

    const effects = await pool.query<{ reservations: string; operations: string }>(
      `
        SELECT
          (SELECT count(*)::text FROM infrastructure.capacity_reservations WHERE tenant_profile_id = $1::uuid) AS reservations,
          (SELECT count(*)::text FROM operations.provisioning_operations WHERE tenant_profile_id = $1::uuid) AS operations
      `,
      [profile.id],
    );
    expect(effects.rows[0]).toEqual({ reservations: "0", operations: "0" });
    const unchanged = await database.tenantProfiles.findById(profile.id);
    expect(unchanged).toMatchObject({
      status: "PENDING",
      version: 1n,
    });
    expect(unchanged?.serverId).toBeUndefined();
  });

  it("rejects a nonvalidated release without partial effects", async () => {
    const candidate = await database.releases.create({
      id: "01995f7e-7b52-7000-8000-000000000602",
      semanticVersion: "1.0.0-candidate.2",
      commitSha: "b".repeat(40),
      releaseNotes: "Candidate not approved.",
      compatibility: {
        configurationSchemaVersion: 1,
        agentContractVersion: "agent/v1",
        databaseMigrationRequired: false,
      },
      artifacts: releaseArtifacts,
    });
    const profile = await database.tenantProfiles.create({
      name: "Release Rejected",
      slug: "release-rejected",
      adminContactName: "Rita",
      adminContactEmail: "rita@example.test",
      status: "PENDING",
    });

    await expect(
      database.provisioningOperations.request({
        tenantProfileId: profile.id,
        serverId,
        releaseId: candidate.id,
        requestedCapacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10000 },
        requestedByOperatorId: operatorId,
        idempotencyKey: "release-rejected-01",
        correlationId: "release-rejected-01",
        expectedTenantVersion: profile.version,
      }),
    ).rejects.toBeInstanceOf(PlatformReleaseNotDeployableError);

    const effects = await pool.query<{ reservations: string; operations: string }>(
      `
        SELECT
          (SELECT count(*)::text FROM infrastructure.capacity_reservations WHERE tenant_profile_id = $1::uuid) AS reservations,
          (SELECT count(*)::text FROM operations.provisioning_operations WHERE tenant_profile_id = $1::uuid) AS operations
      `,
      [profile.id],
    );
    expect(effects.rows[0]).toEqual({ reservations: "0", operations: "0" });
    await expect(database.tenantProfiles.findById(profile.id)).resolves.toMatchObject({
      status: "PENDING",
      version: 1n,
    });
  });

  it("claims once, fences renewal and recovers an expired lease", async () => {
    await pool.query("DELETE FROM operations.provisioning_step_results");
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
        supportedSteps: ["VALIDATE"],
      }),
      database.provisioningOperations.claimNext({
        workerId: "executor-02",
        leaseDurationSeconds: 60,
        supportedSteps: ["VALIDATE"],
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
      supportedSteps: ["VALIDATE"],
    });
    expect(recovered).toMatchObject({
      id: claimed.id,
      status: "RUNNING",
      attempt: 2,
      lease: { owner: "executor-recovery" },
    });
    if (!recovered) throw new Error("Expected an expired lease to be recovered");
    await expect(
      database.provisioningOperations.completeValidation({
        operationId: claimed.id,
        workerId: claimed.lease.owner,
        expectedVersion: claimed.version,
        attempt: claimed.attempt,
      }),
    ).resolves.toBeNull();
    const completed = await database.provisioningOperations.completeValidation({
      operationId: recovered.id,
      workerId: "executor-recovery",
      expectedVersion: recovered.version,
      attempt: recovered.attempt,
    });
    expect(completed).toMatchObject({
      outcome: "ADVANCED",
      failureCode: null,
      operation: {
        id: recovered.id,
        status: "PENDING",
        currentStep: "CREATE_DATABASE",
        lease: null,
      },
    });

    await pool.query(
      `UPDATE operations.provisioning_operations
       SET current_step = 'migrate_database'
       WHERE id = $1::uuid AND status = 'pending'`,
      [recovered.id],
    );
    const migrationClaim = await database.provisioningOperations.claimNext({
      workerId: "executor-migration",
      leaseDurationSeconds: 60,
      supportedSteps: ["MIGRATE_DATABASE"],
    });
    if (!migrationClaim) throw new Error("Expected migration work");
    await expect(
      database.provisioningOperations.completeMigration({
        operationId: migrationClaim.id,
        tenantProfileId: migrationClaim.tenantProfileId,
        workerId: "executor-migration",
        expectedVersion: migrationClaim.version,
        attempt: migrationClaim.attempt,
      }),
    ).resolves.toMatchObject({
      outcome: "ADVANCED",
      operation: {
        status: "PENDING",
        currentStep: "START_CONTAINERS",
        lease: null,
      },
    });
    await expect(
      database.provisioningOperations.claimNext({
        workerId: "executor-unsupported",
        leaseDurationSeconds: 60,
        supportedSteps: ["VALIDATE"],
      }),
    ).resolves.toBeNull();
  });

  it("fails validation atomically and releases reserved capacity once", async () => {
    await pool.query("DELETE FROM operations.provisioning_step_results");
    await pool.query("DELETE FROM operations.provisioning_operations");
    const before = await database.infrastructureServers.findById(serverId);
    if (!before) throw new Error("Expected the integration server");
    const created = await database.tenantProfiles.create({
      name: "Validation Failure",
      slug: "validation-failure",
      adminContactName: "Val",
      adminContactEmail: "val@example.test",
      status: "PENDING",
    });
    const requested = await database.provisioningOperations.request({
      tenantProfileId: created.id,
      serverId,
      releaseId: "01995f7e-7b52-7000-8000-000000000402",
      requestedCapacity: { cpuMillicores: 250, memoryMiB: 512, storageMiB: 5120 },
      requestedByOperatorId: operatorId,
      idempotencyKey: "test-key",
      correlationId: "validation-failure-01",
      expectedTenantVersion: created.version,
    });
    const claimed = await database.provisioningOperations.claimNext({
      workerId: "executor-validation",
      leaseDurationSeconds: 60,
      supportedSteps: ["VALIDATE"],
    });
    if (!claimed) throw new Error("Expected validation work");
    await pool.query("UPDATE infrastructure.servers SET status = 'draining' WHERE id = $1::uuid", [
      serverId,
    ]);

    const failed = await database.provisioningOperations.completeValidation({
      operationId: claimed.id,
      workerId: "executor-validation",
      expectedVersion: claimed.version,
      attempt: claimed.attempt,
    });
    expect(failed).toMatchObject({
      outcome: "FAILED",
      failureCode: "SERVER_UNAVAILABLE",
      operation: { id: requested.operation.id, status: "FAILED", lease: null },
    });
    await expect(
      database.provisioningOperations.completeValidation({
        operationId: claimed.id,
        workerId: "executor-validation",
        expectedVersion: claimed.version,
        attempt: claimed.attempt,
      }),
    ).resolves.toBeNull();
    await expect(database.tenantProfiles.findById(created.id)).resolves.toMatchObject({
      status: "ERROR",
    });
    await expect(database.infrastructureServers.findById(serverId)).resolves.toMatchObject({
      reservedCapacity: before.reservedCapacity,
    });
    const durable = await pool.query<{
      readonly reservation_status: string;
      readonly result_count: string;
    }>(
      `
        SELECT
          reservation.status::text AS reservation_status,
          (
            SELECT count(*)::text
            FROM operations.provisioning_step_results AS result
            WHERE result.operation_id = operation.id
          ) AS result_count
        FROM operations.provisioning_operations AS operation
        JOIN infrastructure.capacity_reservations AS reservation
          ON reservation.id = operation.capacity_reservation_id
        WHERE operation.id = $1::uuid
      `,
      [claimed.id],
    );
    expect(durable.rows[0]).toEqual({ reservation_status: "released", result_count: "1" });
    await pool.query("UPDATE infrastructure.servers SET status = 'available' WHERE id = $1::uuid", [
      serverId,
    ]);
  });

  it("cancels an active lease once, fences late results and releases capacity", async () => {
    const before = await database.infrastructureServers.findById(serverId);
    if (!before) throw new Error("Expected the integration server");
    const created = await database.tenantProfiles.create({
      name: "Recover Provisioning",
      slug: "recover-provisioning",
      adminContactName: "Rene",
      adminContactEmail: "rene@example.test",
      status: "PENDING",
    });
    const requested = await database.provisioningOperations.request({
      tenantProfileId: created.id,
      serverId,
      releaseId: "01995f7e-7b52-7000-8000-000000000500",
      requestedCapacity: { cpuMillicores: 300, memoryMiB: 600, storageMiB: 6000 },
      requestedByOperatorId: operatorId,
      idempotencyKey: "recovery-original-001",
      correlationId: "recovery-original-001",
      expectedTenantVersion: created.version,
    });
    const claimed = await database.provisioningOperations.claimNext({
      workerId: "executor-stalled",
      leaseDurationSeconds: 60,
      supportedSteps: ["VALIDATE"],
    });
    if (!claimed) throw new Error("Expected claimed provisioning work");

    const cancellationCommand = {
      tenantProfileId: created.id,
      operationId: claimed.id,
      requestedByOperatorId: operatorId,
      idempotencyKey: "recovery-cancel-001",
      correlationId: "recovery-cancel-001",
      reason: "  Migrator\n detenido\u0000 por release defectuosa. ",
      expectedVersion: claimed.version,
    } as const;
    const [first, replay] = await Promise.all([
      database.provisioningOperations.cancel(cancellationCommand),
      database.provisioningOperations.cancel(cancellationCommand),
    ]);
    expect([first.idempotentReplay, replay.idempotentReplay].sort()).toEqual([false, true]);
    expect(first.operation).toMatchObject({
      id: requested.operation.id,
      status: "CANCELLED",
      lease: null,
      cancellation: {
        cancelledByOperatorId: operatorId,
        correlationId: "recovery-cancel-001",
        reason: "Migrator detenido por release defectuosa.",
        expectedVersion: claimed.version,
        tenantVersion: 3n,
        result: "CANCELLED",
      },
    });
    await expect(
      database.provisioningOperations.cancel({
        ...cancellationCommand,
        reason: "Un motivo diferente.",
      }),
    ).rejects.toBeInstanceOf(ProvisioningOperationConflictError);
    await expect(
      database.provisioningOperations.completeValidation({
        operationId: claimed.id,
        workerId: "executor-stalled",
        expectedVersion: claimed.version,
        attempt: claimed.attempt,
      }),
    ).resolves.toBeNull();
    await expect(database.tenantProfiles.findById(created.id)).resolves.toMatchObject({
      status: "ERROR",
      version: 3n,
    });
    await expect(database.infrastructureServers.findById(serverId)).resolves.toMatchObject({
      reservedCapacity: before.reservedCapacity,
    });

    const durable = await pool.query<{
      status: string;
      cancellation_reason: string;
      cancellation_result: string;
      cancellation_expected_version: string;
      released_count: string;
    }>(
      `SELECT operation.status::text AS status,
              operation.cancellation_reason,
              operation.cancellation_result::text AS cancellation_result,
              operation.cancellation_expected_version::text AS cancellation_expected_version,
              (SELECT count(*)::text
               FROM infrastructure.capacity_reservations AS reservation
               WHERE reservation.id = operation.capacity_reservation_id
                 AND reservation.status = 'released') AS released_count
       FROM operations.provisioning_operations AS operation
       WHERE operation.id = $1::uuid`,
      [claimed.id],
    );
    expect(durable.rows[0]).toEqual({
      status: "cancelled",
      cancellation_reason: "Migrator detenido por release defectuosa.",
      cancellation_result: "cancelled",
      cancellation_expected_version: claimed.version.toString(),
      released_count: "1",
    });
  });

  it("requests an activation delivery using the joined tenant version", async () => {
    const created = await database.tenantProfiles.create({
      name: "Activation Delivery",
      slug: "activation-delivery",
      adminContactName: "Ada",
      adminContactEmail: "ada@example.test",
      status: "PENDING",
    });
    const subject = "01995f7e-7b52-7000-8000-000000000611";
    await expect(
      database.activationDeliveries.reconcileInitialAdministrator({
        tenantProfileId: created.id,
        subject,
        expectedVersion: 0n,
        now: new Date(),
      }),
    ).resolves.toMatchObject({ subject, status: "PENDING" });

    await expect(
      database.activationDeliveries.request({
        id: "01995f7e-7b52-7000-8000-000000000612",
        tenantProfileId: created.id,
        requestedByOperatorId: operatorId,
        expectedTenantVersion: created.version,
        idempotencyKey: "activation-delivery-joined-version",
        payloadHash: "a".repeat(64),
        correlationId: "activation-delivery-joined-version",
        now: new Date(),
      }),
    ).resolves.toMatchObject({
      idempotentReplay: false,
      intent: {
        tenantProfileId: created.id,
        administratorSubject: subject,
        generation: 1,
        status: "PENDING",
      },
    });
  });
});
