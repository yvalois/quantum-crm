import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, lstat, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { Pool, type PoolClient } from "pg";

import {
  tenantDatabaseIdentity,
  tenantDatabaseSecretReference,
  type TenantDatabaseSecretKind,
  type TenantDatabaseSecretsProvisioner,
  type TenantDatabaseSecretsProvisionCommand,
} from "@quantum-crm/platform-domain";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const rolePattern = /^qcrm_[mr]_[0-9a-f]{32}$/u;
const passwordPattern = /^[A-Za-z0-9_-]{43,128}$/u;

export class TenantDatabaseSecretsProvisioningError extends Error {
  public constructor(
    public readonly reason:
      | "UNAVAILABLE"
      | "PERMISSION_DENIED"
      | "IDENTITY_MISMATCH"
      | "TARGET_CONFLICT",
  ) {
    super(`Tenant database secrets provisioning failed: ${reason}`);
    this.name = "TenantDatabaseSecretsProvisioningError";
  }
}

interface TenantDatabaseRow {
  readonly id: string;
  readonly tenant_profile_id: string;
  readonly server_id: string;
  readonly database_name: string;
  readonly migrator_role_name: string;
  readonly runtime_role_name: string;
}

interface RoleRow {
  readonly rolname: string;
  readonly rolsuper: boolean;
  readonly rolcreaterole: boolean;
  readonly rolcreatedb: boolean;
  readonly rolcanlogin: boolean;
}

function quoteIdentifier(value: string): string {
  if (!rolePattern.test(value)) {
    throw new TenantDatabaseSecretsProvisioningError("IDENTITY_MISMATCH");
  }
  return `"${value}"`;
}

function quoteLiteral(value: string): string {
  if (!passwordPattern.test(value)) {
    throw new TenantDatabaseSecretsProvisioningError("TARGET_CONFLICT");
  }
  return `'${value}'`;
}

function expectedFileName(kind: TenantDatabaseSecretKind): string {
  return kind === "MIGRATOR_PASSWORD" ? "migrator-password" : "runtime-password";
}

function secretPath(rootDirectory: string, tenantProfileId: string, kind: TenantDatabaseSecretKind): string {
  if (!uuidPattern.test(tenantProfileId)) {
    throw new TenantDatabaseSecretsProvisioningError("IDENTITY_MISMATCH");
  }
  const root = resolve(rootDirectory);
  const path = resolve(root, tenantProfileId, expectedFileName(kind));
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new TenantDatabaseSecretsProvisioningError("IDENTITY_MISMATCH");
  }
  return path;
}

function normalizeSecret(value: string): string {
  const normalized = value.replace(/\r?\n$/u, "");
  if (!passwordPattern.test(normalized) || /[\0\r\n]/u.test(normalized)) {
    throw new TenantDatabaseSecretsProvisioningError("TARGET_CONFLICT");
  }
  return normalized;
}

async function readExistingSecret(path: string): Promise<string | undefined> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 44 || metadata.size > 129) {
      throw new TenantDatabaseSecretsProvisioningError("TARGET_CONFLICT");
    }
    return normalizeSecret(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof TenantDatabaseSecretsProvisioningError) throw error;
    if ((error as { readonly code?: string }).code === "ENOENT") return undefined;
    if ((error as { readonly code?: string }).code === "EACCES") {
      throw new TenantDatabaseSecretsProvisioningError("PERMISSION_DENIED");
    }
    throw new TenantDatabaseSecretsProvisioningError("UNAVAILABLE");
  }
}

async function writeSecretIfMissing(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const existing = await readExistingSecret(path);
  if (existing !== undefined) {
    if (existing !== value) throw new TenantDatabaseSecretsProvisioningError("TARGET_CONFLICT");
    await chmod(path, 0o400);
    return;
  }

  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o400);
    await handle.writeFile(`${value}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await chmod(path, 0o400);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    if ((error as { readonly code?: string }).code === "EACCES") {
      throw new TenantDatabaseSecretsProvisioningError("PERMISSION_DENIED");
    }
    if ((error as { readonly code?: string }).code === "EEXIST") {
      const current = await readExistingSecret(path);
      if (current === value) return;
      throw new TenantDatabaseSecretsProvisioningError("TARGET_CONFLICT");
    }
    throw new TenantDatabaseSecretsProvisioningError("UNAVAILABLE");
  }
}

export function createTenantDatabaseSecretsProvisioner(
  connectionUrl: string,
  rootDirectory: string,
): TenantDatabaseSecretsProvisioner & { readonly close: () => Promise<void> } {
  const pool = new Pool({
    connectionString: connectionUrl,
    max: 2,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 10_000,
  });

  const provision = async (command: TenantDatabaseSecretsProvisionCommand) => {
    if (!uuidPattern.test(command.tenantProfileId) || !uuidPattern.test(command.serverId)) {
      throw new TenantDatabaseSecretsProvisioningError("IDENTITY_MISMATCH");
    }
    const identity = tenantDatabaseIdentity(command.tenantProfileId);
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
        `${command.serverId}:${command.tenantProfileId}:secrets`,
      ]);
      const targetResult = await client.query<TenantDatabaseRow>(
        `
          SELECT id::text, tenant_profile_id::text, server_id::text, database_name,
                 migrator_role_name, runtime_role_name
          FROM tenants.tenant_databases
          WHERE tenant_profile_id = $1::uuid AND server_id = $2::uuid AND status = 'created'
        `,
        [command.tenantProfileId, command.serverId],
      );
      const target = targetResult.rows[0];
      if (
        !target ||
        target.database_name !== identity.databaseName ||
        target.migrator_role_name !== identity.migratorRoleName ||
        target.runtime_role_name !== identity.runtimeRoleName
      ) {
        throw new TenantDatabaseSecretsProvisioningError("IDENTITY_MISMATCH");
      }

      const entries = [
        { kind: "MIGRATOR_PASSWORD" as const, roleName: identity.migratorRoleName },
        { kind: "RUNTIME_PASSWORD" as const, roleName: identity.runtimeRoleName },
      ];
      const values = await Promise.all(
        entries.map(async ({ kind }) => {
          const path = secretPath(rootDirectory, command.tenantProfileId, kind);
          const existing = await readExistingSecret(path);
          return { kind, path, value: existing ?? randomBytes(48).toString("base64url"), existing };
        }),
      );
      for (const value of values) {
        await writeSecretIfMissing(value.path, value.value);
      }

      await client.query("BEGIN");
      for (const { roleName } of entries) {
        const roleResult = await client.query<RoleRow>(
          `
            SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin
            FROM pg_roles WHERE rolname = $1
          `,
          [roleName],
        );
        const role = roleResult.rows[0];
        if (!role || role.rolsuper || role.rolcreaterole || role.rolcreatedb) {
          throw new TenantDatabaseSecretsProvisioningError("IDENTITY_MISMATCH");
        }
        const value = values.find((entry) => entry.kind === (roleName === identity.migratorRoleName ? "MIGRATOR_PASSWORD" : "RUNTIME_PASSWORD"));
        if (!value) throw new TenantDatabaseSecretsProvisioningError("IDENTITY_MISMATCH");
        await client.query(
          `ALTER ROLE ${quoteIdentifier(roleName)} LOGIN PASSWORD ${quoteLiteral(value.value)}`,
        );
      }
      await client.query("COMMIT");

      const roleCheck = await client.query<RoleRow>(
        `
          SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin
          FROM pg_roles WHERE rolname = ANY($1::text[])
        `,
        [[identity.migratorRoleName, identity.runtimeRoleName]],
      );
      if (
        roleCheck.rows.length !== 2 ||
        roleCheck.rows.some((role) => role.rolsuper || role.rolcreaterole || role.rolcreatedb || !role.rolcanlogin)
      ) {
        throw new TenantDatabaseSecretsProvisioningError("IDENTITY_MISMATCH");
      }
      return Object.freeze({
        secrets: Object.freeze(
          entries.map(({ kind }) => ({
            ...tenantDatabaseSecretReference(command.tenantProfileId, kind),
          })),
        ),
        reconciled: values.every((entry) => entry.existing !== undefined),
      });
    } catch (error) {
      await client?.query("ROLLBACK").catch(() => undefined);
      if (error instanceof TenantDatabaseSecretsProvisioningError) throw error;
      const code = (error as { readonly code?: string }).code;
      if (code === "42501") throw new TenantDatabaseSecretsProvisioningError("PERMISSION_DENIED");
      if (code === "EACCES") throw new TenantDatabaseSecretsProvisioningError("PERMISSION_DENIED");
      throw new TenantDatabaseSecretsProvisioningError("UNAVAILABLE");
    } finally {
      if (client) {
        await client
          .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
            `${command.serverId}:${command.tenantProfileId}:secrets`,
          ])
          .catch(() => undefined);
        client.release();
      }
    }
  };

  return Object.freeze({ provision, close: () => pool.end() });
}
