import { parseDatabaseConfig } from "@quantum-crm/config";
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

beforeAll(async () => {
  await pool.query("DELETE FROM tenants.tenant_profiles");
});

afterAll(async () => {
  await pool.query("DELETE FROM tenants.tenant_profiles");
  await pool.end();
});

describe("platform tenant profile migration", () => {
  it("creates a UUIDv7 profile with normalized constraints and filter indexes", async () => {
    const inserted = await pool.query<{
      id: string;
      id_version: number;
      status: string;
      version: string;
    }>(`
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
        '01995f7e-7b52-7000-8000-000000000010',
        '01995f7e-7b52-7000-8000-000000000020'
      )
      RETURNING
        id::text,
        uuid_extract_version(id) AS id_version,
        status::text,
        version::text
    `);

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

  it("rejects a case-insensitive duplicate slug and invalid data", async () => {
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
          ('Second', 'UNIQUE-SLUG', 'Bea', 'bea@example.test')
      `),
    ).rejects.toMatchObject({ code: "23505" });

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
});
