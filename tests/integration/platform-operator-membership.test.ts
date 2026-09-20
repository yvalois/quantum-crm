import { parseDatabaseConfig } from "@quantum-crm/config";
import { createPlatformPostgresDatabase } from "@quantum-crm/database";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const secretPath = "/run/secrets/platform_runtime_database_url";
const config = parseDatabaseConfig(
  "platform-operator-membership-integration",
  { target: "platform", requiresTenant: false },
  "test",
  { QCRM_DATABASE_URL_FILE: secretPath },
);
const pool = new Pool({ connectionString: config.connectionUrl.expose(), max: 1 });
const database = createPlatformPostgresDatabase(config, "platform-membership-integration");

beforeAll(async () => {
  await database.connect();
  await pool.query("DELETE FROM platform_iam.operator_permissions");
  await pool.query("DELETE FROM platform_iam.operator_memberships");
});

afterAll(async () => {
  await pool.query("DELETE FROM platform_iam.operator_permissions");
  await pool.query("DELETE FROM platform_iam.operator_memberships");
  await pool.end();
  await database.close();
});

describe("platform operator membership migration", () => {
  it("persists an active operator with UUIDv7 and closed permissions", async () => {
    const inserted = await pool.query<{
      id: string;
      id_version: number;
      status: string;
      authorization_revision: string;
    }>(`
      INSERT INTO platform_iam.operator_memberships (oidc_subject, status)
      VALUES ('keycloak-platform-operator', 'active')
      RETURNING
        id::text,
        uuid_extract_version(id) AS id_version,
        status::text,
        authorization_revision::text
    `);
    const operatorId = inserted.rows[0]?.id;
    expect(operatorId).toBeDefined();

    await pool.query(
      `
        INSERT INTO platform_iam.operator_permissions (operator_id, permission)
        VALUES ($1, 'tenants:read'), ($1, 'deployments:execute')
      `,
      [operatorId],
    );

    const permissions = await pool.query<{ permission: string }>(
      `
        SELECT permission::text
        FROM platform_iam.operator_permissions
        WHERE operator_id = $1
        ORDER BY permission
      `,
      [operatorId],
    );

    expect(inserted.rows[0]).toMatchObject({
      id_version: 7,
      status: "active",
      authorization_revision: "1",
    });
    expect(permissions.rows).toEqual([
      { permission: "deployments:execute" },
      { permission: "tenants:read" },
    ]);
    await expect(
      database.memberships.findByOidcSubject("keycloak-platform-operator"),
    ).resolves.toMatchObject({
      id: operatorId,
      status: "ACTIVE",
      permissions: ["deployments:execute", "tenants:read"],
      authorizationRevision: 1n,
    });
  });

  it("rejects duplicate subjects, invalid revisions and unknown permissions", async () => {
    await expect(
      pool.query(`
        INSERT INTO platform_iam.operator_memberships (oidc_subject)
        VALUES ('keycloak-platform-operator')
      `),
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      pool.query(`
        INSERT INTO platform_iam.operator_memberships (oidc_subject)
        VALUES ('subject with spaces')
      `),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      pool.query(`
        INSERT INTO platform_iam.operator_memberships (oidc_subject, authorization_revision)
        VALUES ('invalid-revision', 0)
      `),
    ).rejects.toMatchObject({ code: "23514" });

    const operator = await pool.query<{ id: string }>(`
      SELECT id::text
      FROM platform_iam.operator_memberships
      WHERE oidc_subject = 'keycloak-platform-operator'
    `);
    await expect(
      pool.query(
        `
          INSERT INTO platform_iam.operator_permissions (operator_id, permission)
          VALUES ($1, 'root:anything')
        `,
        [operator.rows[0]?.id],
      ),
    ).rejects.toMatchObject({ code: "22P02" });
  });

  it("allows runtime DML and cascade cleanup but denies runtime DDL", async () => {
    const updated = await pool.query(`
      UPDATE platform_iam.operator_memberships
      SET authorization_revision = authorization_revision + 1,
          updated_at = transaction_timestamp()
      WHERE oidc_subject = 'keycloak-platform-operator'
    `);
    expect(updated.rowCount).toBe(1);

    await expect(
      pool.query("CREATE TABLE platform_iam.runtime_forbidden(id bigint PRIMARY KEY)"),
    ).rejects.toMatchObject({ code: "42501" });

    await pool.query(`
      DELETE FROM platform_iam.operator_memberships
      WHERE oidc_subject = 'keycloak-platform-operator'
    `);
    const remaining = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM platform_iam.operator_permissions
    `);
    expect(remaining.rows[0]?.count).toBe("0");
  });
});
