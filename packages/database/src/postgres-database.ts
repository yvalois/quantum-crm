import type { DatabaseConfig } from "@quantum-crm/config";
import {
  hydrateTenantProfile,
  TenantProfileConflictError,
  tenantProfileStatuses,
  type TenantProfile,
  type TenantProfileDraft,
  type TenantProfileListCriteria,
  type TenantProfileRepository,
  type TenantProfileStatus,
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
  readonly tenantProfiles: TenantProfileRepository;
}

export interface PlatformMembershipRepository {
  readonly findByOidcSubject: (oidcSubject: string) => Promise<PlatformMembershipRecord | null>;
}

export interface PlatformMembershipRecord {
  readonly id: string;
  readonly oidcSubject: string;
  readonly status: "PENDING" | "ACTIVE" | "SUSPENDED";
  readonly permissions: readonly string[];
  readonly authorizationRevision: bigint;
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
}

interface TenantProfileRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly admin_contact_name: string;
  readonly admin_contact_email: string;
  readonly status: string;
  readonly server_id: string | null;
  readonly release_id: string | null;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const tenantProfileSelection = `
  id::text,
  name,
  slug::text,
  admin_contact_name,
  admin_contact_email::text,
  status::text,
  server_id::text,
  release_id::text,
  version::text,
  created_at,
  updated_at
`;

function tenantStatus(value: string): TenantProfileStatus {
  const normalized = value.toUpperCase();
  if (tenantProfileStatuses.includes(normalized as TenantProfileStatus)) {
    return normalized as TenantProfileStatus;
  }
  throw new DatabaseUnavailableError();
}

function tenantProfileFromRow(row: TenantProfileRow): TenantProfile {
  return hydrateTenantProfile({
    id: row.id,
    name: row.name,
    slug: row.slug,
    adminContactName: row.admin_contact_name,
    adminContactEmail: row.admin_contact_email,
    status: tenantStatus(row.status),
    ...(row.server_id ? { serverId: row.server_id } : {}),
    ...(row.release_id ? { releaseId: row.release_id } : {}),
    version: BigInt(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "23505"
  );
}

function platformStatus(value: string): PlatformMembershipRecord["status"] {
  const normalized = value.toUpperCase();
  if (normalized === "PENDING" || normalized === "ACTIVE" || normalized === "SUSPENDED") {
    return normalized;
  }
  throw new DatabaseUnavailableError();
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
    findByOidcSubject: async (oidcSubject: string): Promise<PlatformMembershipRecord | null> => {
      try {
        const result = (await pool.query(
          `
            SELECT
              membership.id::text,
              membership.oidc_subject,
              membership.status::text,
              membership.authorization_revision::text,
              COALESCE(
                array_agg(permission.permission::text ORDER BY permission.permission::text)
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
        return Object.freeze({
          id: row.id,
          oidcSubject: row.oidc_subject,
          status: platformStatus(row.status),
          permissions: Object.freeze([...row.permissions]),
          authorizationRevision: BigInt(row.authorization_revision),
        });
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
  });

  const tenantProfiles: TenantProfileRepository = Object.freeze({
    create: async (draft: TenantProfileDraft): Promise<TenantProfile> => {
      try {
        const result = (await pool.query(
          `
            INSERT INTO tenants.tenant_profiles (
              name, slug, admin_contact_name, admin_contact_email, status, server_id, release_id
            )
            VALUES ($1, $2, $3, $4, $5::tenants.tenant_status, $6::uuid, $7::uuid)
            RETURNING ${tenantProfileSelection}
          `,
          [
            draft.name,
            draft.slug,
            draft.adminContactName,
            draft.adminContactEmail,
            draft.status.toLowerCase(),
            draft.serverId ?? null,
            draft.releaseId ?? null,
          ],
        )) as { readonly rows: TenantProfileRow[] };
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        return tenantProfileFromRow(row);
      } catch (error) {
        if (isUniqueViolation(error)) throw new TenantProfileConflictError();
        if (error instanceof TenantProfileConflictError) throw error;
        throw new DatabaseUnavailableError();
      }
    },
    findById: async (id: string): Promise<TenantProfile | null> => {
      try {
        const result = (await pool.query(
          `SELECT ${tenantProfileSelection} FROM tenants.tenant_profiles WHERE id = $1::uuid`,
          [id],
        )) as { readonly rows: TenantProfileRow[] };
        return result.rows[0] ? tenantProfileFromRow(result.rows[0]) : null;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    list: async (criteria: TenantProfileListCriteria) => {
      const conditions: string[] = [];
      const values: unknown[] = [];
      const add = (condition: string, value: unknown): void => {
        values.push(value);
        conditions.push(condition.replace("?", `$${values.length}`));
      };

      if (criteria.status) add("status = ?::tenants.tenant_status", criteria.status.toLowerCase());
      if (criteria.serverId) add("server_id = ?::uuid", criteria.serverId);
      if (criteria.releaseId) add("release_id = ?::uuid", criteria.releaseId);
      if (criteria.search) {
        const escaped = criteria.search
          .replaceAll("\\", "\\\\")
          .replaceAll("%", "\\%")
          .replaceAll("_", "\\_");
        values.push(`%${escaped}%`);
        const parameter = `$${values.length}`;
        conditions.push(
          `(name ILIKE ${parameter} ESCAPE '\\\\' OR slug::text ILIKE ${parameter} ESCAPE '\\\\' OR admin_contact_email::text ILIKE ${parameter} ESCAPE '\\\\')`,
        );
      }
      if (criteria.cursor) {
        values.push(criteria.cursor.createdAt, criteria.cursor.id);
        conditions.push(
          `(created_at, id) > ($${values.length - 1}::timestamptz, $${values.length}::uuid)`,
        );
      }
      values.push(criteria.limit + 1);
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      try {
        const result = (await pool.query(
          `
            SELECT ${tenantProfileSelection}
            FROM tenants.tenant_profiles
            ${where}
            ORDER BY created_at ASC, id ASC
            LIMIT $${values.length}
          `,
          values,
        )) as { readonly rows: TenantProfileRow[] };
        const hasMore = result.rows.length > criteria.limit;
        const rows = hasMore ? result.rows.slice(0, criteria.limit) : result.rows;
        const items = rows.map(tenantProfileFromRow);
        const last = hasMore ? items.at(-1) : undefined;
        return Object.freeze({
          items: Object.freeze(items),
          nextCursor: last ? Object.freeze({ createdAt: last.createdAt, id: last.id }) : null,
        });
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    update: async (id: string, expectedVersion: bigint, draft: TenantProfileDraft) => {
      try {
        const result = (await pool.query(
          `
            UPDATE tenants.tenant_profiles
            SET
              name = $3,
              slug = $4,
              admin_contact_name = $5,
              admin_contact_email = $6,
              status = $7::tenants.tenant_status,
              server_id = $8::uuid,
              release_id = $9::uuid,
              version = version + 1,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $1::uuid AND version = $2
            RETURNING ${tenantProfileSelection}
          `,
          [
            id,
            expectedVersion.toString(),
            draft.name,
            draft.slug,
            draft.adminContactName,
            draft.adminContactEmail,
            draft.status.toLowerCase(),
            draft.serverId ?? null,
            draft.releaseId ?? null,
          ],
        )) as { readonly rows: TenantProfileRow[] };
        return result.rows[0] ? tenantProfileFromRow(result.rows[0]) : null;
      } catch (error) {
        if (isUniqueViolation(error)) throw new TenantProfileConflictError();
        if (error instanceof TenantProfileConflictError) throw error;
        throw new DatabaseUnavailableError();
      }
    },
  });

  return Object.freeze({ ...database, memberships, tenantProfiles });
}
