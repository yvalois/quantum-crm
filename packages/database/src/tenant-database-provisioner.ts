import { Pool, type PoolClient } from "pg";

import {
  tenantDatabaseIdentity,
  type TenantDatabaseProvisionCommand,
  type TenantDatabaseProvisioner,
} from "@quantum-crm/platform-domain";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const identifierPattern = /^qcrm_[tmr]_[0-9a-f]{32}$/u;
const roleIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u;

export class TenantDatabaseProvisioningError extends Error {
  public constructor(
    public readonly reason:
      | "UNAVAILABLE"
      | "PERMISSION_DENIED"
      | "IDENTITY_MISMATCH"
      | "TARGET_CONFLICT",
  ) {
    super(`Tenant database provisioning failed: ${reason}`);
    this.name = "TenantDatabaseProvisioningError";
  }
}

function quoteIdentifier(value: string): string {
  if (!identifierPattern.test(value)) {
    throw new TenantDatabaseProvisioningError("IDENTITY_MISMATCH");
  }
  return `"${value}"`;
}

function quoteRoleIdentifier(value: string): string {
  if (!roleIdentifierPattern.test(value)) {
    throw new TenantDatabaseProvisioningError("IDENTITY_MISMATCH");
  }
  return `"${value}"`;
}

function databaseIdentity(command: TenantDatabaseProvisionCommand) {
  if (
    !uuidPattern.test(command.tenantProfileId) ||
    !uuidPattern.test(command.serverId)
  ) {
    throw new TenantDatabaseProvisioningError("IDENTITY_MISMATCH");
  }
  return tenantDatabaseIdentity(command.tenantProfileId);
}

interface RoleRow {
  readonly rolname: string;
  readonly rolsuper: boolean;
  readonly rolcreaterole: boolean;
  readonly rolcreatedb: boolean;
  readonly rolinherit: boolean;
  readonly rolcanlogin: boolean;
}

interface DatabaseRow {
  readonly datname: string;
  readonly owner_name: string;
  readonly datallowconn: boolean;
  readonly public_connect: boolean;
  readonly runtime_connect: boolean;
}

export function createTenantDatabaseProvisioner(
  connectionUrl: string,
): TenantDatabaseProvisioner & {
  readonly close: () => Promise<void>;
} {
  const pool = new Pool({
    connectionString: connectionUrl,
    max: 2,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 10_000,
  });

  const verifyRole = async (
    client: PoolClient,
    roleName: string,
  ): Promise<void> => {
    const result = await client.query<RoleRow>(
      `
        SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolinherit, rolcanlogin
        FROM pg_roles
        WHERE rolname = $1
      `,
      [roleName],
    );
    const role = result.rows[0];
    if (
      !role ||
      role.rolsuper ||
      role.rolcreaterole ||
      role.rolcreatedb ||
      !role.rolinherit ||
      role.rolcanlogin
    ) {
      throw new TenantDatabaseProvisioningError("IDENTITY_MISMATCH");
    }
  };

  const verifyDatabase = async (
    client: PoolClient,
    databaseName: string,
    migratorRoleName: string,
    runtimeRoleName: string,
  ): Promise<void> => {
    const result = await client.query<DatabaseRow>(
      `
        SELECT
          database.datname,
          owner.rolname AS owner_name,
          database.datallowconn,
          has_database_privilege('public', database.datname, 'CONNECT') AS public_connect,
          has_database_privilege($2, database.datname, 'CONNECT') AS runtime_connect
        FROM pg_database AS database
        JOIN pg_roles AS owner ON owner.oid = database.datdba
        WHERE database.datname = $1
      `,
      [databaseName, runtimeRoleName],
    );
    const database = result.rows[0];
    if (
      !database ||
      database.owner_name !== migratorRoleName ||
      !database.datallowconn ||
      database.public_connect ||
      !database.runtime_connect
    ) {
      throw new TenantDatabaseProvisioningError("IDENTITY_MISMATCH");
    }
  };

  const provision = async (command: TenantDatabaseProvisionCommand) => {
    const identity = databaseIdentity(command);
    const databaseName = quoteIdentifier(identity.databaseName);
    const migratorRoleName = quoteIdentifier(identity.migratorRoleName);
    const runtimeRoleName = quoteIdentifier(identity.runtimeRoleName);
    let client: PoolClient | undefined;
    let currentUser: string | undefined;
    let membershipGranted = false;
    try {
      client = await pool.connect();
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
        `${command.serverId}:${identity.databaseName}`,
      ]);
      await client.query("BEGIN");
      for (const roleName of [
        identity.migratorRoleName,
        identity.runtimeRoleName,
      ]) {
        const roleResult = await client.query<{ readonly rolname: string }>(
          "SELECT rolname FROM pg_roles WHERE rolname = $1",
          [roleName],
        );
        if (!roleResult.rows[0]) {
          await client.query(
            `CREATE ROLE ${quoteIdentifier(roleName)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT`,
          );
        }
        await verifyRole(client, roleName);
      }
      await client.query("COMMIT");

      const databaseResult = await client.query<{ readonly datname: string }>(
        "SELECT datname FROM pg_database WHERE datname = $1",
        [identity.databaseName],
      );
      const currentUserResult = await client.query<{
        readonly current_user: string;
      }>("SELECT current_user");
      currentUser = currentUserResult.rows[0]?.current_user;
      if (!currentUser)
        throw new TenantDatabaseProvisioningError("UNAVAILABLE");
      const quotedCurrentUser = quoteRoleIdentifier(currentUser);
      await client.query(`GRANT ${migratorRoleName} TO ${quotedCurrentUser}`);
      membershipGranted = true;
      if (!databaseResult.rows[0]) {
        try {
          await client.query(
            `CREATE DATABASE ${databaseName} OWNER ${migratorRoleName}`,
          );
        } catch (error) {
          if ((error as { readonly code?: string }).code !== "42P04")
            throw error;
        }
      }
      await client.query(`SET ROLE ${migratorRoleName}`);
      await client.query(
        `REVOKE CONNECT ON DATABASE ${databaseName} FROM PUBLIC`,
      );
      await client.query(
        `GRANT CONNECT ON DATABASE ${databaseName} TO ${runtimeRoleName}`,
      );
      await client.query("RESET ROLE");
      await client.query(
        `REVOKE ${migratorRoleName} FROM ${quotedCurrentUser}`,
      );
      membershipGranted = false;
      await verifyDatabase(
        client,
        identity.databaseName,
        identity.migratorRoleName,
        identity.runtimeRoleName,
      );
      return Object.freeze({
        ...identity,
        reconciled: Boolean(databaseResult.rows[0]),
      });
    } catch (error) {
      await client?.query("ROLLBACK").catch(() => undefined);
      if (error instanceof TenantDatabaseProvisioningError) throw error;
      const code = (error as { readonly code?: string }).code;
      if (code === "42501")
        throw new TenantDatabaseProvisioningError("PERMISSION_DENIED");
      throw new TenantDatabaseProvisioningError("UNAVAILABLE");
    } finally {
      if (client) {
        if (membershipGranted && currentUser) {
          await client.query("RESET ROLE").catch(() => undefined);
          await client
            .query(
              `REVOKE ${migratorRoleName} FROM ${quoteRoleIdentifier(currentUser)}`,
            )
            .catch(() => undefined);
        }
        await client
          .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
            `${command.serverId}:${identity.databaseName}`,
          ])
          .catch(() => undefined);
        client.release();
      }
    }
  };

  return Object.freeze({
    provision,
    close: () => pool.end(),
  });
}
