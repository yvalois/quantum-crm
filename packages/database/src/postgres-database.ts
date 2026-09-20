import type { DatabaseConfig } from "@quantum-crm/config";
import {
  hydratePlatformOperatorMembership,
  type PlatformOperatorMembership,
  type PlatformOperatorStatus,
  type PlatformPermission,
} from "@quantum-crm/platform-domain";
import { Pool, type PoolClient, type PoolConfig } from "pg";

interface PostgresPool {
  readonly connect: () => Promise<PoolClient>;
  readonly end: () => Promise<void>;
  readonly on: (event: "error", listener: (error: Error) => void) => unknown;
  readonly query: (text: string, values?: unknown[]) => Promise<unknown>;
}

export type PostgresPoolFactory = (config: PoolConfig) => PostgresPool;

export interface PostgresDatabase {
  readonly connect: () => Promise<void>;
  readonly isReady: () => Promise<boolean>;
  readonly close: () => Promise<void>;
  readonly onApplicationShutdown: () => Promise<void>;
}

export interface PlatformPostgresDatabase extends PostgresDatabase {
  readonly memberships: PlatformMembershipRepository;
}

export interface PlatformMembershipRepository {
  readonly findByOidcSubject: (oidcSubject: string) => Promise<PlatformOperatorMembership | null>;
}

export class DatabaseUnavailableError extends Error {
  public constructor() {
    super("PostgreSQL dependency is unavailable");
    this.name = "DatabaseUnavailableError";
  }
}

interface RuntimePolicyRow {
  readonly server_version_num: number;
  readonly can_create_database_objects: boolean;
  readonly can_create_public_objects: boolean;
}

const defaultPoolFactory: PostgresPoolFactory = (config) => new Pool(config);

interface PlatformMembershipRow {
  readonly id: string;
  readonly oidc_subject: string;
  readonly status: string;
  readonly authorization_revision: string;
  readonly permissions: string[];
  readonly created_at: Date;
  readonly updated_at: Date;
}

function platformStatus(value: string): PlatformOperatorStatus {
  const normalized = value.toUpperCase();
  if (normalized === "PENDING" || normalized === "ACTIVE" || normalized === "SUSPENDED") {
    return normalized;
  }
  throw new DatabaseUnavailableError();
}

function platformPermissions(values: string[]): readonly PlatformPermission[] {
  return values as PlatformPermission[];
}

function createPool(config: DatabaseConfig, serviceName: string, poolFactory: PostgresPoolFactory) {
  return poolFactory({
    connectionString: config.connectionUrl.expose(),
    application_name: `quantum-crm:${serviceName}`,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: 30_000,
    statement_timeout: config.statementTimeoutMs,
    query_timeout: config.statementTimeoutMs + 5_000,
    lock_timeout: config.lockTimeoutMs,
    idle_in_transaction_session_timeout: config.idleInTransactionTimeoutMs,
    keepAlive: true,
  });
}

export function createPostgresDatabase(
  config: DatabaseConfig,
  serviceName: string,
  poolFactory: PostgresPoolFactory = defaultPoolFactory,
): PostgresDatabase {
  const pool = createPool(config, serviceName, poolFactory);
  let initialized = false;
  let closed = false;

  pool.on("error", () => {
    initialized = false;
  });

  async function connect(): Promise<void> {
    if (closed) {
      throw new DatabaseUnavailableError();
    }

    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      const result = await client.query<RuntimePolicyRow>(`
        SELECT
          current_setting('server_version_num')::integer AS server_version_num,
          has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database_objects,
          has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public_objects
      `);
      const policy = result.rows[0];
      if (
        !policy ||
        policy.server_version_num < 180_000 ||
        policy.can_create_database_objects ||
        policy.can_create_public_objects
      ) {
        throw new Error("Runtime database policy is not satisfied");
      }
      initialized = true;
    } catch {
      initialized = false;
      throw new DatabaseUnavailableError();
    } finally {
      client?.release();
    }
  }

  async function isReady(): Promise<boolean> {
    if (!initialized || closed) {
      return false;
    }

    try {
      await pool.query("SELECT 1 AS ready");
      return true;
    } catch {
      return false;
    }
  }

  async function close(): Promise<void> {
    if (closed) {
      return;
    }

    closed = true;
    initialized = false;
    await pool.end();
  }

  return Object.freeze({
    connect,
    isReady,
    close,
    onApplicationShutdown: close,
  });
}

export function createPlatformPostgresDatabase(
  config: DatabaseConfig,
  serviceName: string,
  poolFactory: PostgresPoolFactory = defaultPoolFactory,
): PlatformPostgresDatabase {
  if (config.target !== "platform") {
    throw new DatabaseUnavailableError();
  }

  const pool = createPool(config, serviceName, poolFactory);
  const database = createPostgresDatabase(config, serviceName, () => pool);
  const memberships: PlatformMembershipRepository = Object.freeze({
    findByOidcSubject: async (oidcSubject: string): Promise<PlatformOperatorMembership | null> => {
      try {
        const result = (await pool.query(
          `
            SELECT
              membership.id::text,
              membership.oidc_subject,
              membership.status::text,
              membership.authorization_revision::text,
              membership.created_at,
              membership.updated_at,
              COALESCE(
                array_agg(permission.permission::text ORDER BY permission.permission)
                  FILTER (WHERE permission.permission IS NOT NULL),
                ARRAY[]::text[]
              ) AS permissions
            FROM platform_iam.operator_memberships AS membership
            LEFT JOIN platform_iam.operator_permissions AS permission
              ON permission.operator_id = membership.id
            WHERE membership.oidc_subject = $1
            GROUP BY membership.id
          `,
          [oidcSubject],
        )) as { readonly rows: PlatformMembershipRow[] };
        const row = result.rows[0];
        if (!row) return null;
        return hydratePlatformOperatorMembership({
          id: row.id,
          oidcSubject: row.oidc_subject,
          status: platformStatus(row.status),
          permissions: platformPermissions(row.permissions),
          authorizationRevision: BigInt(row.authorization_revision),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
  });

  return Object.freeze({ ...database, memberships });
}
