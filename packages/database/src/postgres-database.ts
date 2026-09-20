import type { DatabaseConfig } from "@quantum-crm/config";
import { Pool, type PoolClient, type PoolConfig } from "pg";

interface PostgresPool {
  readonly connect: () => Promise<PoolClient>;
  readonly end: () => Promise<void>;
  readonly on: (event: "error", listener: (error: Error) => void) => unknown;
  readonly query: (text: string) => Promise<unknown>;
}

export type PostgresPoolFactory = (config: PoolConfig) => PostgresPool;

export interface PostgresDatabase {
  readonly connect: () => Promise<void>;
  readonly isReady: () => Promise<boolean>;
  readonly close: () => Promise<void>;
  readonly onApplicationShutdown: () => Promise<void>;
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

export function createPostgresDatabase(
  config: DatabaseConfig,
  serviceName: string,
  poolFactory: PostgresPoolFactory = defaultPoolFactory,
): PostgresDatabase {
  const pool = poolFactory({
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
