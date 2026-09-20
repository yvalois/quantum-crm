import type { DatabaseConfig } from "@quantum-crm/config";
import {
  createProvisioningOperationDraft,
  hydrateProvisioningOperation,
  ProvisioningOperationConflictError,
  provisioningOperationStatuses,
  provisioningOperationSteps,
  hydrateTenantProfile,
  TenantProfileConflictError,
  TenantProfileLifecycleTransitionError,
  TenantProfileNotFoundError,
  TenantProfileVersionConflictError,
  tenantProfileStatuses,
  transitionTenantProfileStatus,
  validateProvisioningLeaseClaim,
  validateProvisioningLeaseRenewal,
  type ClaimProvisioningOperationCommand,
  type ProvisioningOperation,
  type ProvisioningOperationRepository,
  type ProvisioningOperationStatus,
  type ProvisioningOperationStep,
  type RenewProvisioningOperationLeaseCommand,
  type RequestProvisioningCommand,
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
  readonly provisioningOperations: ProvisioningOperationRepository;
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

interface ProvisioningOperationRow {
  readonly id: string;
  readonly tenant_profile_id: string;
  readonly server_id: string;
  readonly release_id: string;
  readonly requested_by_operator_id: string;
  readonly idempotency_key: string;
  readonly correlation_id: string;
  readonly status: string;
  readonly current_step: string;
  readonly attempt: number;
  readonly version: string;
  readonly lease_owner: string | null;
  readonly lease_expires_at: Date | null;
  readonly last_heartbeat_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly tenant_version?: string;
}

const provisioningOperationSelection = `
  operation.id::text,
  operation.tenant_profile_id::text,
  operation.server_id::text,
  operation.release_id::text,
  operation.requested_by_operator_id::text,
  operation.idempotency_key,
  operation.correlation_id,
  operation.status::text,
  operation.current_step::text,
  operation.attempt,
  operation.version::text,
  operation.lease_owner,
  operation.lease_expires_at,
  operation.last_heartbeat_at,
  operation.created_at,
  operation.updated_at
`;

function provisioningOperationFromRow(row: ProvisioningOperationRow): ProvisioningOperation {
  return hydrateProvisioningOperation({
    id: row.id,
    tenantProfileId: row.tenant_profile_id,
    serverId: row.server_id,
    releaseId: row.release_id,
    requestedByOperatorId: row.requested_by_operator_id,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    status: provisioningOperationStatus(row.status),
    currentStep: provisioningOperationStep(row.current_step),
    attempt: row.attempt,
    version: BigInt(row.version),
    lease:
      row.lease_owner && row.lease_expires_at && row.last_heartbeat_at
        ? {
            owner: row.lease_owner,
            expiresAt: row.lease_expires_at,
            lastHeartbeatAt: row.last_heartbeat_at,
          }
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function provisioningOperationStatus(value: string): ProvisioningOperationStatus {
  const normalized = value.toUpperCase();
  if (provisioningOperationStatuses.includes(normalized as ProvisioningOperationStatus)) {
    return normalized as ProvisioningOperationStatus;
  }
  throw new DatabaseUnavailableError();
}

function provisioningOperationStep(value: string): ProvisioningOperationStep {
  const normalized = value.toUpperCase();
  if (provisioningOperationSteps.includes(normalized as ProvisioningOperationStep)) {
    return normalized as ProvisioningOperationStep;
  }
  throw new DatabaseUnavailableError();
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
          `(name ILIKE ${parameter} ESCAPE '\\' OR slug::text ILIKE ${parameter} ESCAPE '\\' OR admin_contact_email::text ILIKE ${parameter} ESCAPE '\\')`,
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

  const provisioningOperations: ProvisioningOperationRepository = Object.freeze({
    request: async (command: RequestProvisioningCommand) => {
      const draft = createProvisioningOperationDraft(command);
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${draft.requestedByOperatorId}:${draft.idempotencyKey}`,
        ]);

        const existingResult = await client.query<ProvisioningOperationRow>(
          `
            SELECT ${provisioningOperationSelection}, profile.version::text AS tenant_version
            FROM operations.provisioning_operations AS operation
            JOIN tenants.tenant_profiles AS profile ON profile.id = operation.tenant_profile_id
            WHERE operation.requested_by_operator_id = $1::uuid
              AND operation.idempotency_key = $2
            FOR UPDATE OF operation
          `,
          [draft.requestedByOperatorId, draft.idempotencyKey],
        );
        const existing = existingResult.rows[0];
        if (existing) {
          if (
            existing.tenant_profile_id !== draft.tenantProfileId ||
            existing.server_id !== draft.serverId ||
            existing.release_id !== draft.releaseId
          ) {
            throw new ProvisioningOperationConflictError();
          }
          await client.query("COMMIT");
          return Object.freeze({
            operation: provisioningOperationFromRow(existing),
            tenantVersion: BigInt(existing.tenant_version ?? "0"),
            idempotentReplay: true,
          });
        }

        const profileResult = await client.query<{
          readonly status: string;
          readonly version: string;
        }>(
          `
            SELECT status::text, version::text
            FROM tenants.tenant_profiles
            WHERE id = $1::uuid
            FOR UPDATE
          `,
          [draft.tenantProfileId],
        );
        const profile = profileResult.rows[0];
        if (!profile) throw new TenantProfileNotFoundError();
        if (BigInt(profile.version) !== command.expectedTenantVersion) {
          throw new TenantProfileVersionConflictError();
        }
        const nextStatus = transitionTenantProfileStatus(
          tenantStatus(profile.status),
          "START_PROVISIONING",
        );

        const operationResult = await client.query<ProvisioningOperationRow>(
          `
            INSERT INTO operations.provisioning_operations (
              tenant_profile_id,
              server_id,
              release_id,
              requested_by_operator_id,
              idempotency_key,
              correlation_id
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6)
            RETURNING ${provisioningOperationSelection.replaceAll("operation.", "")}
          `,
          [
            draft.tenantProfileId,
            draft.serverId,
            draft.releaseId,
            draft.requestedByOperatorId,
            draft.idempotencyKey,
            draft.correlationId,
          ],
        );
        const operationRow = operationResult.rows[0];
        if (!operationRow) throw new DatabaseUnavailableError();

        const updated = await client.query<{ readonly version: string }>(
          `
            UPDATE tenants.tenant_profiles
            SET
              status = $3::tenants.tenant_status,
              server_id = $4::uuid,
              release_id = $5::uuid,
              version = version + 1,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $1::uuid AND version = $2
            RETURNING version::text
          `,
          [
            draft.tenantProfileId,
            command.expectedTenantVersion.toString(),
            nextStatus.toLowerCase(),
            draft.serverId,
            draft.releaseId,
          ],
        );
        const tenantVersion = updated.rows[0]?.version;
        if (!tenantVersion) throw new TenantProfileVersionConflictError();
        await client.query("COMMIT");
        return Object.freeze({
          operation: provisioningOperationFromRow(operationRow),
          tenantVersion: BigInt(tenantVersion),
          idempotentReplay: false,
        });
      } catch (error) {
        if (client) await client.query("ROLLBACK").catch(() => undefined);
        if (
          error instanceof ProvisioningOperationConflictError ||
          error instanceof TenantProfileLifecycleTransitionError ||
          error instanceof TenantProfileNotFoundError ||
          error instanceof TenantProfileVersionConflictError
        ) {
          throw error;
        }
        if (isUniqueViolation(error)) throw new ProvisioningOperationConflictError();
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    claimNext: async (command: ClaimProvisioningOperationCommand) => {
      const claim = validateProvisioningLeaseClaim(command);
      try {
        const result = (await pool.query(
          `
            WITH candidate AS (
              SELECT operation.id
              FROM operations.provisioning_operations AS operation
              WHERE operation.status = 'pending'
                 OR (
                   operation.status = 'running'
                   AND operation.lease_expires_at <= CURRENT_TIMESTAMP
                 )
              ORDER BY
                CASE WHEN operation.status = 'pending' THEN 0 ELSE 1 END,
                operation.created_at ASC,
                operation.id ASC
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            )
            UPDATE operations.provisioning_operations AS operation
            SET
              status = 'running',
              attempt = operation.attempt + 1,
              lease_owner = $1,
              lease_expires_at = CURRENT_TIMESTAMP + ($2::integer * INTERVAL '1 second'),
              last_heartbeat_at = CURRENT_TIMESTAMP,
              version = operation.version + 1,
              updated_at = CURRENT_TIMESTAMP
            FROM candidate
            WHERE operation.id = candidate.id
            RETURNING ${provisioningOperationSelection}
          `,
          [claim.workerId, claim.leaseDurationSeconds],
        )) as { readonly rows: ProvisioningOperationRow[] };
        return result.rows[0] ? provisioningOperationFromRow(result.rows[0]) : null;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    renewLease: async (command: RenewProvisioningOperationLeaseCommand) => {
      const renewal = validateProvisioningLeaseRenewal(command);
      try {
        const result = (await pool.query(
          `
            UPDATE operations.provisioning_operations AS operation
            SET
              lease_expires_at = CURRENT_TIMESTAMP + ($4::integer * INTERVAL '1 second'),
              last_heartbeat_at = CURRENT_TIMESTAMP,
              version = operation.version + 1,
              updated_at = CURRENT_TIMESTAMP
            WHERE operation.id = $1::uuid
              AND operation.status = 'running'
              AND operation.lease_owner = $2
              AND operation.version = $3
              AND operation.lease_expires_at > CURRENT_TIMESTAMP
            RETURNING ${provisioningOperationSelection}
          `,
          [
            renewal.operationId,
            renewal.workerId,
            renewal.expectedVersion.toString(),
            renewal.leaseDurationSeconds,
          ],
        )) as { readonly rows: ProvisioningOperationRow[] };
        return result.rows[0] ? provisioningOperationFromRow(result.rows[0]) : null;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
  });

  return Object.freeze({ ...database, memberships, tenantProfiles, provisioningOperations });
}
