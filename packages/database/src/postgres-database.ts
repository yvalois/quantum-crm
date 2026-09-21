import type { DatabaseConfig } from "@quantum-crm/config";
import {
  createProvisioningOperationDraft,
  evaluateProvisioningValidation,
  hydrateInfrastructureServer,
  hydrateProvisioningOperation,
  InfrastructureServerConflictError,
  InfrastructureCapacityExceededError,
  InfrastructureServerNotAdmissibleError,
  infrastructureServerArchitectures,
  infrastructureServerStatuses,
  hydratePlatformRelease,
  PlatformReleaseConflictError,
  PlatformReleaseNotDeployableError,
  platformReleaseArtifactNames,
  platformReleaseStatuses,
  ProvisioningOperationConflictError,
  provisioningOperationStatuses,
  provisioningOperationSteps,
  provisioningValidationFailureCodes,
  hydrateTenantProfile,
  TenantProfileConflictError,
  TenantProfileLifecycleTransitionError,
  TenantProfileNotFoundError,
  TenantProfileVersionConflictError,
  tenantProfileStatuses,
  transitionTenantProfileStatus,
  validateProvisioningLeaseClaim,
  validateProvisioningLeaseRenewal,
  validateCompleteProvisioningValidation,
  validateCompleteProvisioningDatabase,
  validateCompleteProvisioningSecrets,
  type ClaimProvisioningOperationCommand,
  type CompleteProvisioningValidationCommand,
  type CompleteProvisioningDatabaseCommand,
  type CompleteProvisioningSecretsCommand,
  type InfrastructureServer,
  type InfrastructureServerArchitecture,
  type InfrastructureServerDraft,
  type InfrastructureServerListCriteria,
  type InfrastructureServerRepository,
  type InfrastructureServerStatus,
  type PlatformRelease,
  type PlatformReleaseArtifactName,
  type PlatformReleaseDraft,
  type PlatformReleaseListCriteria,
  type PlatformReleaseRepository,
  type PlatformReleaseStatus,
  type ProvisioningOperation,
  type ProvisioningOperationRepository,
  type ProvisioningOperationStatus,
  type ProvisioningOperationStep,
  type ProvisioningValidationFailureCode,
  type ProvisioningValidationSnapshot,
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
  readonly infrastructureServers: InfrastructureServerRepository;
  readonly tenantProfiles: TenantProfileRepository;
  readonly provisioningOperations: ProvisioningOperationRepository;
  readonly releases: PlatformReleaseRepository;
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

interface InfrastructureServerRow {
  readonly id: string;
  readonly code: string;
  readonly display_name: string;
  readonly provider: string;
  readonly region: string;
  readonly public_ipv4: string;
  readonly operating_system: string;
  readonly architecture: string;
  readonly status: string;
  readonly total_cpu_millicores: number;
  readonly total_memory_mib: number;
  readonly total_storage_mib: number;
  readonly reserved_cpu_millicores: number;
  readonly reserved_memory_mib: number;
  readonly reserved_storage_mib: number;
  readonly operation_credential_ref: string;
  readonly confirmed_at: Date;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface PlatformReleaseRow {
  readonly id: string;
  readonly semantic_version: string;
  readonly commit_sha: string;
  readonly status: string;
  readonly release_notes: string;
  readonly configuration_schema_version: number;
  readonly agent_contract_version: string;
  readonly database_migration_required: boolean;
  readonly minimum_source_version: string | null;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly artifacts: readonly { readonly name: string; readonly digest: string }[];
}

const platformReleaseSelection = `
  release.id::text,
  release.semantic_version,
  release.commit_sha,
  release.status::text,
  release.release_notes,
  release.configuration_schema_version,
  release.agent_contract_version,
  release.database_migration_required,
  release.minimum_source_version,
  release.version::text,
  release.created_at,
  release.updated_at,
  COALESCE(
    jsonb_agg(
      jsonb_build_object('name', artifact.name::text, 'digest', artifact.digest)
      ORDER BY artifact.name::text
    ) FILTER (WHERE artifact.name IS NOT NULL),
    '[]'::jsonb
  ) AS artifacts
`;

function platformReleaseStatus(value: string): PlatformReleaseStatus {
  const normalized = value.toUpperCase();
  if (platformReleaseStatuses.includes(normalized as PlatformReleaseStatus)) {
    return normalized as PlatformReleaseStatus;
  }
  throw new DatabaseUnavailableError();
}

function platformReleaseArtifactName(value: string): PlatformReleaseArtifactName {
  const normalized = value.toUpperCase().replaceAll("-", "_");
  if (platformReleaseArtifactNames.includes(normalized as PlatformReleaseArtifactName)) {
    return normalized as PlatformReleaseArtifactName;
  }
  throw new DatabaseUnavailableError();
}

function platformReleaseFromRow(row: PlatformReleaseRow): PlatformRelease {
  return hydratePlatformRelease({
    id: row.id,
    semanticVersion: row.semantic_version,
    commitSha: row.commit_sha,
    releaseNotes: row.release_notes,
    compatibility: {
      configurationSchemaVersion: row.configuration_schema_version,
      agentContractVersion: row.agent_contract_version,
      databaseMigrationRequired: row.database_migration_required,
      ...(row.minimum_source_version ? { minimumSourceVersion: row.minimum_source_version } : {}),
    },
    artifacts: row.artifacts.map((artifact) => ({
      name: platformReleaseArtifactName(artifact.name),
      digest: artifact.digest,
    })),
    status: platformReleaseStatus(row.status),
    version: BigInt(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

const infrastructureServerSelection = `
  id::text,
  code::text,
  display_name,
  provider,
  region,
  host(public_ipv4) AS public_ipv4,
  operating_system,
  architecture::text,
  status::text,
  total_cpu_millicores,
  total_memory_mib,
  total_storage_mib,
  reserved_cpu_millicores,
  reserved_memory_mib,
  reserved_storage_mib,
  operation_credential_ref,
  confirmed_at,
  version::text,
  created_at,
  updated_at
`;

function infrastructureServerStatus(value: string): InfrastructureServerStatus {
  const normalized = value.toUpperCase();
  if (infrastructureServerStatuses.includes(normalized as InfrastructureServerStatus)) {
    return normalized as InfrastructureServerStatus;
  }
  throw new DatabaseUnavailableError();
}

function infrastructureServerArchitecture(value: string): InfrastructureServerArchitecture {
  const normalized = value.toUpperCase();
  if (infrastructureServerArchitectures.includes(normalized as InfrastructureServerArchitecture)) {
    return normalized as InfrastructureServerArchitecture;
  }
  throw new DatabaseUnavailableError();
}

function infrastructureServerFromRow(row: InfrastructureServerRow): InfrastructureServer {
  return hydrateInfrastructureServer({
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    provider: row.provider,
    region: row.region,
    publicIpv4: row.public_ipv4,
    operatingSystem: row.operating_system,
    architecture: infrastructureServerArchitecture(row.architecture),
    status: infrastructureServerStatus(row.status),
    totalCapacity: {
      cpuMillicores: row.total_cpu_millicores,
      memoryMiB: row.total_memory_mib,
      storageMiB: row.total_storage_mib,
    },
    reservedCapacity: {
      cpuMillicores: row.reserved_cpu_millicores,
      memoryMiB: row.reserved_memory_mib,
      storageMiB: row.reserved_storage_mib,
    },
    operationCredentialRef: row.operation_credential_ref,
    confirmedAt: row.confirmed_at,
    version: BigInt(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

interface ProvisioningOperationRow {
  readonly id: string;
  readonly tenant_profile_id: string;
  readonly server_id: string;
  readonly release_id: string;
  readonly capacity_reservation_id: string | null;
  readonly requested_cpu_millicores: number | null;
  readonly requested_memory_mib: number | null;
  readonly requested_storage_mib: number | null;
  readonly requested_by_operator_id: string;
  readonly idempotency_key: string;
  readonly correlation_id: string;
  readonly status: string;
  readonly current_step: string;
  readonly attempt: number;
  readonly version: string;
  readonly failure_code: string | null;
  readonly lease_owner: string | null;
  readonly lease_expires_at: Date | null;
  readonly last_heartbeat_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly tenant_version?: string;
}

interface ProvisioningValidationRow extends ProvisioningOperationRow {
  readonly tenant_status: string;
  readonly tenant_server_id: string | null;
  readonly tenant_release_id: string | null;
  readonly server_status: string;
  readonly server_reserved_cpu_millicores: number;
  readonly server_reserved_memory_mib: number;
  readonly server_reserved_storage_mib: number;
  readonly release_status: string;
  readonly reservation_tenant_profile_id: string;
  readonly reservation_server_id: string;
  readonly reservation_release_id: string;
  readonly reservation_status: string;
  readonly reservation_cpu_millicores: number;
  readonly reservation_memory_mib: number;
  readonly reservation_storage_mib: number;
}

const provisioningOperationSelection = `
  operation.id::text,
  operation.tenant_profile_id::text,
  operation.server_id::text,
  operation.release_id::text,
  operation.capacity_reservation_id::text,
  operation.requested_cpu_millicores,
  operation.requested_memory_mib,
  operation.requested_storage_mib,
  operation.requested_by_operator_id::text,
  operation.idempotency_key,
  operation.correlation_id,
  operation.status::text,
  operation.current_step::text,
  operation.attempt,
  operation.version::text,
  operation.failure_code::text,
  operation.lease_owner,
  operation.lease_expires_at,
  operation.last_heartbeat_at,
  operation.created_at,
  operation.updated_at
`;

function provisioningOperationFromRow(row: ProvisioningOperationRow): ProvisioningOperation {
  if (
    !row.capacity_reservation_id ||
    row.requested_cpu_millicores === null ||
    row.requested_memory_mib === null ||
    row.requested_storage_mib === null
  ) {
    throw new DatabaseUnavailableError();
  }
  return hydrateProvisioningOperation({
    id: row.id,
    tenantProfileId: row.tenant_profile_id,
    serverId: row.server_id,
    releaseId: row.release_id,
    requestedByOperatorId: row.requested_by_operator_id,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    requestedCapacity: {
      cpuMillicores: row.requested_cpu_millicores,
      memoryMiB: row.requested_memory_mib,
      storageMiB: row.requested_storage_mib,
    },
    status: provisioningOperationStatus(row.status),
    currentStep: provisioningOperationStep(row.current_step),
    attempt: row.attempt,
    version: BigInt(row.version),
    failureCode: provisioningValidationFailureCode(row.failure_code),
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
    capacityReservation: {
      id: row.capacity_reservation_id,
      capacity: {
        cpuMillicores: row.requested_cpu_millicores,
        memoryMiB: row.requested_memory_mib,
        storageMiB: row.requested_storage_mib,
      },
    },
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

function provisioningValidationFailureCode(
  value: string | null,
): ProvisioningValidationFailureCode | null {
  if (value === null) return null;
  const normalized = value.toUpperCase();
  if (
    provisioningValidationFailureCodes.includes(normalized as ProvisioningValidationFailureCode)
  ) {
    return normalized as ProvisioningValidationFailureCode;
  }
  throw new DatabaseUnavailableError();
}

function provisioningValidationSnapshot(
  row: ProvisioningValidationRow,
): ProvisioningValidationSnapshot {
  return {
    tenant: {
      status: tenantStatus(row.tenant_status),
      serverId: row.tenant_server_id,
      releaseId: row.tenant_release_id,
    },
    server: {
      status: infrastructureServerStatus(row.server_status),
      reservedCapacity: {
        cpuMillicores: row.server_reserved_cpu_millicores,
        memoryMiB: row.server_reserved_memory_mib,
        storageMiB: row.server_reserved_storage_mib,
      },
    },
    release: { status: platformReleaseStatus(row.release_status) },
    reservation: {
      tenantProfileId: row.reservation_tenant_profile_id,
      serverId: row.reservation_server_id,
      releaseId: row.reservation_release_id,
      status: capacityReservationStatus(row.reservation_status),
      capacity: {
        cpuMillicores: row.reservation_cpu_millicores,
        memoryMiB: row.reservation_memory_mib,
        storageMiB: row.reservation_storage_mib,
      },
    },
  };
}

function capacityReservationStatus(
  value: string,
): ProvisioningValidationSnapshot["reservation"]["status"] {
  const normalized = value.toUpperCase();
  if (normalized === "RESERVED" || normalized === "ACTIVE" || normalized === "RELEASED") {
    return normalized;
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

async function completeProvisioningSecrets(
  pool: PostgresPool,
  command: CompleteProvisioningSecretsCommand,
): Promise<ReturnType<ProvisioningOperationRepository["completeSecrets"]> extends Promise<infer Result> ? Result : never> {
  const completion = validateCompleteProvisioningSecrets(command);
  const failureCode = completion.failureCode?.toLowerCase() ?? null;
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query<ProvisioningOperationRow & { readonly tenant_version: string }>(
      `
        SELECT ${provisioningOperationSelection}, profile.version::text AS tenant_version
        FROM operations.provisioning_operations AS operation
        JOIN tenants.tenant_profiles AS profile ON profile.id = operation.tenant_profile_id
        WHERE operation.id = $1::uuid AND operation.tenant_profile_id = $2::uuid
          AND operation.status = 'running' AND operation.current_step = 'create_secrets'
          AND operation.lease_owner = $3 AND operation.version = $4 AND operation.attempt = $5
          AND operation.lease_expires_at > CURRENT_TIMESTAMP
        FOR UPDATE OF operation, profile
      `,
      [
        completion.operationId,
        completion.tenantProfileId,
        completion.workerId,
        completion.expectedVersion.toString(),
        completion.attempt,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }
    if (
      !row.capacity_reservation_id ||
      row.requested_cpu_millicores === null ||
      row.requested_memory_mib === null ||
      row.requested_storage_mib === null
    ) {
      throw new DatabaseUnavailableError();
    }
    await client.query(
      `
        INSERT INTO operations.provisioning_step_results
          (operation_id, step, attempt, outcome, worker_id, operation_version, failure_code)
        VALUES ($1::uuid, 'create_secrets', $2, $3::operations.provisioning_step_outcome,
                $4, $5, $6::operations.provisioning_validation_failure_code)
      `,
      [
        completion.operationId,
        completion.attempt,
        failureCode ? "failed" : "succeeded",
        completion.workerId,
        completion.expectedVersion.toString(),
        failureCode,
      ],
    );
    if (!failureCode) {
      const targetResult = await client.query<{ readonly id: string; readonly server_id: string }>(
        `
          SELECT id::text, server_id::text FROM tenants.tenant_databases
          WHERE tenant_profile_id = $1::uuid AND status = 'created' FOR UPDATE
        `,
        [completion.tenantProfileId],
      );
      const target = targetResult.rows[0];
      if (!target || target.server_id !== row.server_id) throw new DatabaseUnavailableError();
      for (const secret of completion.secrets) {
        const existingResult = await client.query<{ readonly secret_ref: string; readonly version: string }>(
          `
            SELECT secret_ref, version::text FROM tenants.tenant_database_secrets
            WHERE tenant_database_id = $1::uuid AND kind = $2::tenants.tenant_database_secret_kind
            FOR UPDATE
          `,
          [target.id, secret.kind.toLowerCase()],
        );
        const existing = existingResult.rows[0];
        if (existing && (existing.secret_ref !== secret.secretRef || BigInt(existing.version) !== secret.version)) {
          throw new DatabaseUnavailableError();
        }
        if (existing) {
          await client.query(
            `
              UPDATE tenants.tenant_database_secrets
              SET status = 'ready', updated_at = CURRENT_TIMESTAMP
              WHERE tenant_database_id = $1::uuid AND kind = $2::tenants.tenant_database_secret_kind
            `,
            [target.id, secret.kind.toLowerCase()],
          );
        } else {
          await client.query(
            `
              INSERT INTO tenants.tenant_database_secrets
                (tenant_database_id, kind, secret_ref, status, version)
              VALUES ($1::uuid, $2::tenants.tenant_database_secret_kind, $3, 'ready', $4)
            `,
            [target.id, secret.kind.toLowerCase(), secret.secretRef, secret.version.toString()],
          );
        }
      }
      const updatedResult = await client.query<ProvisioningOperationRow>(
        `
          UPDATE operations.provisioning_operations AS operation
          SET status = 'pending', current_step = 'create_storage', failure_code = NULL,
              lease_owner = NULL, lease_expires_at = NULL, last_heartbeat_at = NULL,
              version = operation.version + 1, updated_at = CURRENT_TIMESTAMP
          WHERE operation.id = $1::uuid
          RETURNING ${provisioningOperationSelection}
        `,
        [completion.operationId],
      );
      const updatedOperation = updatedResult.rows[0];
      if (!updatedOperation) throw new DatabaseUnavailableError();
      await client.query("COMMIT");
      return Object.freeze({
        operation: provisioningOperationFromRow(updatedOperation),
        tenantVersion: BigInt(row.tenant_version),
        outcome: "ADVANCED" as const,
        failureCode: null,
      });
    }
    await client.query(
      `
        UPDATE infrastructure.capacity_reservations
        SET status = 'released', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::uuid AND status = 'reserved'
      `,
      [row.capacity_reservation_id],
    );
    await client.query(
      `
        UPDATE infrastructure.servers
        SET reserved_cpu_millicores = reserved_cpu_millicores - $2,
            reserved_memory_mib = reserved_memory_mib - $3,
            reserved_storage_mib = reserved_storage_mib - $4,
            version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::uuid
          AND reserved_cpu_millicores >= $2
          AND reserved_memory_mib >= $3
          AND reserved_storage_mib >= $4
      `,
      [row.server_id, row.requested_cpu_millicores, row.requested_memory_mib, row.requested_storage_mib],
    );
    const tenantUpdate = await client.query<{ readonly version: string }>(
      `
        UPDATE tenants.tenant_profiles
        SET status = 'error', version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::uuid AND status = 'provisioning'
        RETURNING version::text
      `,
      [completion.tenantProfileId],
    );
    const updatedResult = await client.query<ProvisioningOperationRow>(
      `
        UPDATE operations.provisioning_operations AS operation
        SET status = 'failed', failure_code = $2::operations.provisioning_validation_failure_code,
            lease_owner = NULL, lease_expires_at = NULL, last_heartbeat_at = NULL,
            version = operation.version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE operation.id = $1::uuid
        RETURNING ${provisioningOperationSelection}
      `,
      [completion.operationId, failureCode],
    );
    const updatedOperation = updatedResult.rows[0];
    if (!updatedOperation) throw new DatabaseUnavailableError();
    await client.query("COMMIT");
    return Object.freeze({
      operation: provisioningOperationFromRow(updatedOperation),
      tenantVersion: tenantUpdate.rows[0] ? BigInt(tenantUpdate.rows[0].version) : BigInt(row.tenant_version),
      outcome: "FAILED" as const,
      failureCode: completion.failureCode ?? null,
    });
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => undefined);
    if (error instanceof DatabaseUnavailableError) throw error;
    throw new DatabaseUnavailableError();
  } finally {
    client?.release();
  }
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

  const releases: PlatformReleaseRepository = Object.freeze({
    create: async (draft: PlatformReleaseDraft): Promise<PlatformRelease> => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await client.query(
          `
            INSERT INTO releases.releases (
              id, semantic_version, commit_sha, release_notes,
              configuration_schema_version, agent_contract_version,
              database_migration_required, minimum_source_version
            ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            draft.id,
            draft.semanticVersion,
            draft.commitSha,
            draft.releaseNotes,
            draft.compatibility.configurationSchemaVersion,
            draft.compatibility.agentContractVersion,
            draft.compatibility.databaseMigrationRequired,
            draft.compatibility.minimumSourceVersion ?? null,
          ],
        );
        for (const artifact of draft.artifacts) {
          await client.query(
            `
              INSERT INTO releases.release_artifacts (release_id, name, digest)
              VALUES ($1::uuid, $2::releases.release_artifact_name, $3)
            `,
            [draft.id, artifact.name.toLowerCase().replaceAll("_", "-"), artifact.digest],
          );
        }
        const result = await client.query<PlatformReleaseRow>(
          `
            SELECT ${platformReleaseSelection}
            FROM releases.releases AS release
            LEFT JOIN releases.release_artifacts AS artifact ON artifact.release_id = release.id
            WHERE release.id = $1::uuid
            GROUP BY release.id
          `,
          [draft.id],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await client.query("COMMIT");
        return platformReleaseFromRow(row);
      } catch (error) {
        if (client) await client.query("ROLLBACK").catch(() => undefined);
        if (isUniqueViolation(error)) throw new PlatformReleaseConflictError();
        if (error instanceof PlatformReleaseConflictError) throw error;
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    findById: async (id: string): Promise<PlatformRelease | null> => {
      try {
        const result = (await pool.query(
          `
            SELECT ${platformReleaseSelection}
            FROM releases.releases AS release
            LEFT JOIN releases.release_artifacts AS artifact ON artifact.release_id = release.id
            WHERE release.id = $1::uuid
            GROUP BY release.id
          `,
          [id],
        )) as { readonly rows: PlatformReleaseRow[] };
        return result.rows[0] ? platformReleaseFromRow(result.rows[0]) : null;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    list: async (criteria: PlatformReleaseListCriteria) => {
      try {
        const values: unknown[] = [];
        const where = criteria.status ? "WHERE release.status = $1::releases.release_status" : "";
        if (criteria.status) values.push(criteria.status.toLowerCase());
        values.push(criteria.limit);
        const result = (await pool.query(
          `
            SELECT ${platformReleaseSelection}
            FROM releases.releases AS release
            LEFT JOIN releases.release_artifacts AS artifact ON artifact.release_id = release.id
            ${where}
            GROUP BY release.id
            ORDER BY release.created_at DESC, release.id DESC
            LIMIT $${values.length}
          `,
          values,
        )) as { readonly rows: PlatformReleaseRow[] };
        return Object.freeze(result.rows.map(platformReleaseFromRow));
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    updateStatus: async (id: string, expectedVersion: bigint, status: PlatformReleaseStatus) => {
      try {
        const updated = (await pool.query(
          `
            UPDATE releases.releases
            SET status = $3::releases.release_status,
                version = version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1::uuid AND version = $2
            RETURNING id::text
          `,
          [id, expectedVersion.toString(), status.toLowerCase()],
        )) as { readonly rows: readonly { readonly id: string }[] };
        if (!updated.rows[0]) return null;
        const result = (await pool.query(
          `
            SELECT ${platformReleaseSelection}
            FROM releases.releases AS release
            LEFT JOIN releases.release_artifacts AS artifact ON artifact.release_id = release.id
            WHERE release.id = $1::uuid
            GROUP BY release.id
          `,
          [id],
        )) as { readonly rows: PlatformReleaseRow[] };
        return result.rows[0] ? platformReleaseFromRow(result.rows[0]) : null;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
  });

  const infrastructureServers: InfrastructureServerRepository = Object.freeze({
    create: async (draft: InfrastructureServerDraft): Promise<InfrastructureServer> => {
      try {
        const result = (await pool.query(
          `
            INSERT INTO infrastructure.servers (
              code, display_name, provider, region, public_ipv4, operating_system,
              architecture, status, total_cpu_millicores, total_memory_mib,
              total_storage_mib, reserved_cpu_millicores, reserved_memory_mib,
              reserved_storage_mib, operation_credential_ref, confirmed_at
            ) VALUES (
              $1, $2, $3, $4, $5::inet, $6, $7::infrastructure.server_architecture,
              $8::infrastructure.server_status, $9, $10, $11, $12, $13, $14, $15, $16
            )
            RETURNING ${infrastructureServerSelection}
          `,
          [
            draft.code,
            draft.displayName,
            draft.provider,
            draft.region,
            draft.publicIpv4,
            draft.operatingSystem,
            draft.architecture.toLowerCase(),
            draft.status.toLowerCase(),
            draft.totalCapacity.cpuMillicores,
            draft.totalCapacity.memoryMiB,
            draft.totalCapacity.storageMiB,
            draft.reservedCapacity.cpuMillicores,
            draft.reservedCapacity.memoryMiB,
            draft.reservedCapacity.storageMiB,
            draft.operationCredentialRef,
            draft.confirmedAt,
          ],
        )) as { readonly rows: InfrastructureServerRow[] };
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        return infrastructureServerFromRow(row);
      } catch (error) {
        if (isUniqueViolation(error)) throw new InfrastructureServerConflictError();
        if (error instanceof InfrastructureServerConflictError) throw error;
        throw new DatabaseUnavailableError();
      }
    },
    findById: async (id: string): Promise<InfrastructureServer | null> => {
      try {
        const result = (await pool.query(
          `SELECT ${infrastructureServerSelection} FROM infrastructure.servers WHERE id = $1::uuid`,
          [id],
        )) as { readonly rows: InfrastructureServerRow[] };
        return result.rows[0] ? infrastructureServerFromRow(result.rows[0]) : null;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    list: async (criteria: InfrastructureServerListCriteria) => {
      try {
        const values: unknown[] = [];
        const where = criteria.status ? "WHERE status = $1::infrastructure.server_status" : "";
        if (criteria.status) values.push(criteria.status.toLowerCase());
        values.push(criteria.limit);
        const result = (await pool.query(
          `
            SELECT ${infrastructureServerSelection}
            FROM infrastructure.servers
            ${where}
            ORDER BY created_at ASC, id ASC
            LIMIT $${values.length}
          `,
          values,
        )) as { readonly rows: InfrastructureServerRow[] };
        return Object.freeze(result.rows.map(infrastructureServerFromRow));
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    update: async (
      id: string,
      expectedVersion: bigint,
      draft: InfrastructureServerDraft,
    ): Promise<InfrastructureServer | null> => {
      try {
        const result = (await pool.query(
          `
            UPDATE infrastructure.servers
            SET
              code = $3,
              display_name = $4,
              provider = $5,
              region = $6,
              public_ipv4 = $7::inet,
              operating_system = $8,
              architecture = $9::infrastructure.server_architecture,
              status = $10::infrastructure.server_status,
              total_cpu_millicores = $11,
              total_memory_mib = $12,
              total_storage_mib = $13,
              reserved_cpu_millicores = $14,
              reserved_memory_mib = $15,
              reserved_storage_mib = $16,
              operation_credential_ref = $17,
              confirmed_at = $18,
              version = version + 1,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $1::uuid AND version = $2
            RETURNING ${infrastructureServerSelection}
          `,
          [
            id,
            expectedVersion.toString(),
            draft.code,
            draft.displayName,
            draft.provider,
            draft.region,
            draft.publicIpv4,
            draft.operatingSystem,
            draft.architecture.toLowerCase(),
            draft.status.toLowerCase(),
            draft.totalCapacity.cpuMillicores,
            draft.totalCapacity.memoryMiB,
            draft.totalCapacity.storageMiB,
            draft.reservedCapacity.cpuMillicores,
            draft.reservedCapacity.memoryMiB,
            draft.reservedCapacity.storageMiB,
            draft.operationCredentialRef,
            draft.confirmedAt,
          ],
        )) as { readonly rows: InfrastructureServerRow[] };
        return result.rows[0] ? infrastructureServerFromRow(result.rows[0]) : null;
      } catch (error) {
        if (isUniqueViolation(error)) throw new InfrastructureServerConflictError();
        if (error instanceof InfrastructureServerConflictError) throw error;
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

  const provisioningOperations = Object.freeze({
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
            existing.release_id !== draft.releaseId ||
            existing.requested_cpu_millicores !== draft.requestedCapacity.cpuMillicores ||
            existing.requested_memory_mib !== draft.requestedCapacity.memoryMiB ||
            existing.requested_storage_mib !== draft.requestedCapacity.storageMiB
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

        const releaseResult = await client.query<{ readonly status: string }>(
          `
            SELECT status::text
            FROM releases.releases
            WHERE id = $1::uuid
            FOR KEY SHARE
          `,
          [draft.releaseId],
        );
        if (releaseResult.rows[0]?.status !== "validated") {
          throw new PlatformReleaseNotDeployableError();
        }

        const serverResult = await client.query<{
          readonly status: string;
          readonly total_cpu_millicores: number;
          readonly total_memory_mib: number;
          readonly total_storage_mib: number;
          readonly reserved_cpu_millicores: number;
          readonly reserved_memory_mib: number;
          readonly reserved_storage_mib: number;
        }>(
          `
            SELECT
              status::text,
              total_cpu_millicores,
              total_memory_mib,
              total_storage_mib,
              reserved_cpu_millicores,
              reserved_memory_mib,
              reserved_storage_mib
            FROM infrastructure.servers
            WHERE id = $1::uuid
            FOR UPDATE
          `,
          [draft.serverId],
        );
        const server = serverResult.rows[0];
        if (!server || server.status !== "available") {
          throw new InfrastructureServerNotAdmissibleError();
        }
        if (
          server.reserved_cpu_millicores + draft.requestedCapacity.cpuMillicores >
            server.total_cpu_millicores ||
          server.reserved_memory_mib + draft.requestedCapacity.memoryMiB >
            server.total_memory_mib ||
          server.reserved_storage_mib + draft.requestedCapacity.storageMiB >
            server.total_storage_mib
        ) {
          throw new InfrastructureCapacityExceededError();
        }

        const reservationResult = await client.query<{ readonly id: string }>(
          `
            INSERT INTO infrastructure.capacity_reservations (
              tenant_profile_id,
              server_id,
              release_id,
              cpu_millicores,
              memory_mib,
              storage_mib
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)
            RETURNING id::text
          `,
          [
            draft.tenantProfileId,
            draft.serverId,
            draft.releaseId,
            draft.requestedCapacity.cpuMillicores,
            draft.requestedCapacity.memoryMiB,
            draft.requestedCapacity.storageMiB,
          ],
        );
        const capacityReservationId = reservationResult.rows[0]?.id;
        if (!capacityReservationId) throw new DatabaseUnavailableError();

        await client.query(
          `
            UPDATE infrastructure.servers
            SET
              reserved_cpu_millicores = reserved_cpu_millicores + $2,
              reserved_memory_mib = reserved_memory_mib + $3,
              reserved_storage_mib = reserved_storage_mib + $4,
              version = version + 1,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $1::uuid
          `,
          [
            draft.serverId,
            draft.requestedCapacity.cpuMillicores,
            draft.requestedCapacity.memoryMiB,
            draft.requestedCapacity.storageMiB,
          ],
        );

        const operationResult = await client.query<ProvisioningOperationRow>(
          `
            INSERT INTO operations.provisioning_operations (
              tenant_profile_id,
              server_id,
              release_id,
              capacity_reservation_id,
              requested_cpu_millicores,
              requested_memory_mib,
              requested_storage_mib,
              requested_by_operator_id,
              idempotency_key,
              correlation_id
            ) VALUES (
              $1::uuid, $2::uuid, $3::uuid, $7::uuid, $8, $9, $10,
              $4::uuid, $5, $6
            )
            RETURNING ${provisioningOperationSelection.replaceAll("operation.", "")}
          `,
          [
            draft.tenantProfileId,
            draft.serverId,
            draft.releaseId,
            draft.requestedByOperatorId,
            draft.idempotencyKey,
            draft.correlationId,
            capacityReservationId,
            draft.requestedCapacity.cpuMillicores,
            draft.requestedCapacity.memoryMiB,
            draft.requestedCapacity.storageMiB,
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
          error instanceof TenantProfileVersionConflictError ||
          error instanceof InfrastructureServerNotAdmissibleError ||
          error instanceof InfrastructureCapacityExceededError ||
          error instanceof PlatformReleaseNotDeployableError
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
              WHERE (
                   operation.status = 'pending'
                   OR (
                   operation.status = 'running'
                   AND operation.lease_expires_at <= CURRENT_TIMESTAMP
                 )
                )
                AND operation.capacity_reservation_id IS NOT NULL
                AND operation.current_step = ANY(
                  $3::operations.provisioning_operation_step[]
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
          [
            claim.workerId,
            claim.leaseDurationSeconds,
            claim.supportedSteps.map((step) => step.toLowerCase()),
          ],
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
    completeValidation: async (command: CompleteProvisioningValidationCommand) => {
      const completion = validateCompleteProvisioningValidation(command);
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const validationResult = await client.query<ProvisioningValidationRow>(
          `
            SELECT
              ${provisioningOperationSelection},
              profile.status::text AS tenant_status,
              profile.server_id::text AS tenant_server_id,
              profile.release_id::text AS tenant_release_id,
              profile.version::text AS tenant_version,
              server.status::text AS server_status,
              server.reserved_cpu_millicores AS server_reserved_cpu_millicores,
              server.reserved_memory_mib AS server_reserved_memory_mib,
              server.reserved_storage_mib AS server_reserved_storage_mib,
              release.status::text AS release_status,
              reservation.tenant_profile_id::text AS reservation_tenant_profile_id,
              reservation.server_id::text AS reservation_server_id,
              reservation.release_id::text AS reservation_release_id,
              reservation.status::text AS reservation_status,
              reservation.cpu_millicores AS reservation_cpu_millicores,
              reservation.memory_mib AS reservation_memory_mib,
              reservation.storage_mib AS reservation_storage_mib
            FROM operations.provisioning_operations AS operation
            JOIN tenants.tenant_profiles AS profile
              ON profile.id = operation.tenant_profile_id
            JOIN infrastructure.servers AS server
              ON server.id = operation.server_id
            JOIN releases.releases AS release
              ON release.id = operation.release_id
            JOIN infrastructure.capacity_reservations AS reservation
              ON reservation.id = operation.capacity_reservation_id
            WHERE operation.id = $1::uuid
              AND operation.status = 'running'
              AND operation.current_step = 'validate'
              AND operation.lease_owner = $2
              AND operation.version = $3
              AND operation.attempt = $4
              AND operation.lease_expires_at > CURRENT_TIMESTAMP
            FOR UPDATE OF operation, profile, server, release, reservation
          `,
          [
            completion.operationId,
            completion.workerId,
            completion.expectedVersion.toString(),
            completion.attempt,
          ],
        );
        const validationRow = validationResult.rows[0];
        if (!validationRow) {
          await client.query("COMMIT");
          return null;
        }

        const operation = provisioningOperationFromRow(validationRow);
        const snapshot = provisioningValidationSnapshot(validationRow);
        const failureCode = evaluateProvisioningValidation(operation, snapshot);
        const databaseFailureCode = failureCode?.toLowerCase() ?? null;

        await client.query(
          `
            INSERT INTO operations.provisioning_step_results (
              operation_id,
              step,
              attempt,
              outcome,
              worker_id,
              operation_version,
              failure_code
            ) VALUES (
              $1::uuid,
              'validate',
              $2,
              $3::operations.provisioning_step_outcome,
              $4,
              $5,
              $6::operations.provisioning_validation_failure_code
            )
          `,
          [
            operation.id,
            completion.attempt,
            failureCode ? "failed" : "succeeded",
            completion.workerId,
            completion.expectedVersion.toString(),
            databaseFailureCode,
          ],
        );

        let updatedOperation: ProvisioningOperationRow | undefined;
        let tenantVersion = BigInt(validationRow.tenant_version ?? "0");
        if (!failureCode) {
          const updatedResult = await client.query<ProvisioningOperationRow>(
            `
              UPDATE operations.provisioning_operations AS operation
              SET
                status = 'pending',
                current_step = 'create_database',
                failure_code = NULL,
                lease_owner = NULL,
                lease_expires_at = NULL,
                last_heartbeat_at = NULL,
                version = operation.version + 1,
                updated_at = CURRENT_TIMESTAMP
              WHERE operation.id = $1::uuid
              RETURNING ${provisioningOperationSelection}
            `,
            [operation.id],
          );
          updatedOperation = updatedResult.rows[0];
        } else {
          const reservationMatches =
            snapshot.reservation.tenantProfileId === operation.tenantProfileId &&
            snapshot.reservation.serverId === operation.serverId &&
            snapshot.reservation.releaseId === operation.releaseId &&
            snapshot.reservation.capacity.cpuMillicores ===
              operation.requestedCapacity.cpuMillicores &&
            snapshot.reservation.capacity.memoryMiB === operation.requestedCapacity.memoryMiB &&
            snapshot.reservation.capacity.storageMiB === operation.requestedCapacity.storageMiB;
          if (snapshot.reservation.status === "RESERVED" && reservationMatches) {
            const released = await client.query<{ readonly id: string }>(
              `
                UPDATE infrastructure.capacity_reservations
                SET status = 'released', updated_at = CURRENT_TIMESTAMP
                WHERE id = $1::uuid AND status = 'reserved'
                RETURNING id::text
              `,
              [operation.capacityReservation.id],
            );
            if (released.rows[0]) {
              const capacityUpdate = await client.query<{ readonly id: string }>(
                `
                  UPDATE infrastructure.servers
                  SET
                    reserved_cpu_millicores = reserved_cpu_millicores - $2,
                    reserved_memory_mib = reserved_memory_mib - $3,
                    reserved_storage_mib = reserved_storage_mib - $4,
                    version = version + 1,
                    updated_at = CURRENT_TIMESTAMP
                  WHERE id = $1::uuid
                    AND reserved_cpu_millicores >= $2
                    AND reserved_memory_mib >= $3
                    AND reserved_storage_mib >= $4
                  RETURNING id::text
                `,
                [
                  operation.serverId,
                  operation.requestedCapacity.cpuMillicores,
                  operation.requestedCapacity.memoryMiB,
                  operation.requestedCapacity.storageMiB,
                ],
              );
              if (!capacityUpdate.rows[0]) throw new DatabaseUnavailableError();
            }
          }

          const tenantUpdate = await client.query<{ readonly version: string }>(
            `
              UPDATE tenants.tenant_profiles
              SET status = 'error', version = version + 1, updated_at = CURRENT_TIMESTAMP
              WHERE id = $1::uuid AND status = 'provisioning'
              RETURNING version::text
            `,
            [operation.tenantProfileId],
          );
          if (tenantUpdate.rows[0]) tenantVersion = BigInt(tenantUpdate.rows[0].version);

          const updatedResult = await client.query<ProvisioningOperationRow>(
            `
              UPDATE operations.provisioning_operations AS operation
              SET
                status = 'failed',
                failure_code = $2::operations.provisioning_validation_failure_code,
                lease_owner = NULL,
                lease_expires_at = NULL,
                last_heartbeat_at = NULL,
                version = operation.version + 1,
                updated_at = CURRENT_TIMESTAMP
              WHERE operation.id = $1::uuid
              RETURNING ${provisioningOperationSelection}
            `,
            [operation.id, databaseFailureCode],
          );
          updatedOperation = updatedResult.rows[0];
        }
        if (!updatedOperation) throw new DatabaseUnavailableError();
        await client.query("COMMIT");
        return Object.freeze({
          operation: provisioningOperationFromRow(updatedOperation),
          tenantVersion,
          outcome: failureCode ? "FAILED" : "ADVANCED",
          failureCode,
        });
      } catch (error) {
        if (client) await client.query("ROLLBACK").catch(() => undefined);
        if (error instanceof DatabaseUnavailableError) throw error;
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    completeDatabase: async (command: CompleteProvisioningDatabaseCommand) => {
      const completion = validateCompleteProvisioningDatabase(command);
      const databaseFailureCode = completion.failureCode?.toLowerCase() ?? null;
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const operationResult = await client.query<
          ProvisioningOperationRow & {
            readonly tenant_status: string;
            readonly tenant_version: string;
          }
        >(
          `
            SELECT
              ${provisioningOperationSelection},
              profile.status::text AS tenant_status,
              profile.version::text AS tenant_version
            FROM operations.provisioning_operations AS operation
            JOIN tenants.tenant_profiles AS profile
              ON profile.id = operation.tenant_profile_id
            WHERE operation.id = $1::uuid
              AND operation.tenant_profile_id = $2::uuid
              AND operation.status = 'running'
              AND operation.current_step = 'create_database'
              AND operation.lease_owner = $3
              AND operation.version = $4
              AND operation.attempt = $5
              AND operation.lease_expires_at > CURRENT_TIMESTAMP
            FOR UPDATE OF operation, profile
          `,
          [
            completion.operationId,
            completion.tenantProfileId,
            completion.workerId,
            completion.expectedVersion.toString(),
            completion.attempt,
          ],
        );
        const row = operationResult.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        if (
          !row.capacity_reservation_id ||
          row.requested_cpu_millicores === null ||
          row.requested_memory_mib === null ||
          row.requested_storage_mib === null
        ) {
          throw new DatabaseUnavailableError();
        }

        await client.query(
          `
            INSERT INTO operations.provisioning_step_results (
              operation_id, step, attempt, outcome, worker_id, operation_version, failure_code
            ) VALUES (
              $1::uuid, 'create_database', $2, $3::operations.provisioning_step_outcome,
              $4, $5, $6::operations.provisioning_validation_failure_code
            )
          `,
          [
            completion.operationId,
            completion.attempt,
            databaseFailureCode ? "failed" : "succeeded",
            completion.workerId,
            completion.expectedVersion.toString(),
            databaseFailureCode,
          ],
        );

        let updatedOperation: ProvisioningOperationRow | undefined;
        let tenantVersion = BigInt(row.tenant_version);
        if (!databaseFailureCode) {
          const targetResult = await client.query<{
            readonly tenant_profile_id: string;
            readonly server_id: string;
            readonly database_name: string;
            readonly migrator_role_name: string;
            readonly runtime_role_name: string;
          }>(
            `
              SELECT tenant_profile_id::text, server_id::text, database_name,
                     migrator_role_name, runtime_role_name
              FROM tenants.tenant_databases
              WHERE tenant_profile_id = $1::uuid
              FOR UPDATE
            `,
            [completion.tenantProfileId],
          );
          const existingTarget = targetResult.rows[0];
          if (
            existingTarget &&
            (existingTarget.server_id !== row.server_id ||
              existingTarget.database_name !== completion.databaseName ||
              existingTarget.migrator_role_name !== completion.migratorRoleName ||
              existingTarget.runtime_role_name !== completion.runtimeRoleName)
          ) {
            throw new DatabaseUnavailableError();
          }
          if (existingTarget) {
            await client.query(
              `
                UPDATE tenants.tenant_databases
                SET status = 'created', version = version + 1, updated_at = CURRENT_TIMESTAMP
                WHERE tenant_profile_id = $1::uuid
              `,
              [completion.tenantProfileId],
            );
          } else {
            await client.query(
              `
                INSERT INTO tenants.tenant_databases (
                  tenant_profile_id, server_id, database_name,
                  migrator_role_name, runtime_role_name, status
                ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'created')
              `,
              [
                completion.tenantProfileId,
                row.server_id,
                completion.databaseName,
                completion.migratorRoleName,
                completion.runtimeRoleName,
              ],
            );
          }
          const updatedResult = await client.query<ProvisioningOperationRow>(
            `
              UPDATE operations.provisioning_operations AS operation
              SET status = 'pending', current_step = 'create_secrets',
                  failure_code = NULL, lease_owner = NULL, lease_expires_at = NULL,
                  last_heartbeat_at = NULL, version = operation.version + 1,
                  updated_at = CURRENT_TIMESTAMP
              WHERE operation.id = $1::uuid
              RETURNING ${provisioningOperationSelection}
            `,
            [completion.operationId],
          );
          updatedOperation = updatedResult.rows[0];
        } else {
          const released = await client.query<{ readonly id: string }>(
            `
              UPDATE infrastructure.capacity_reservations
              SET status = 'released', updated_at = CURRENT_TIMESTAMP
              WHERE id = $1::uuid AND status = 'reserved'
              RETURNING id::text
            `,
            [row.capacity_reservation_id],
          );
          if (released.rows[0]) {
            const capacityUpdate = await client.query<{ readonly id: string }>(
              `
                UPDATE infrastructure.servers
                SET reserved_cpu_millicores = reserved_cpu_millicores - $2,
                    reserved_memory_mib = reserved_memory_mib - $3,
                    reserved_storage_mib = reserved_storage_mib - $4,
                    version = version + 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = $1::uuid
                  AND reserved_cpu_millicores >= $2
                  AND reserved_memory_mib >= $3
                  AND reserved_storage_mib >= $4
                RETURNING id::text
              `,
              [
                row.server_id,
                row.requested_cpu_millicores,
                row.requested_memory_mib,
                row.requested_storage_mib,
              ],
            );
            if (!capacityUpdate.rows[0]) throw new DatabaseUnavailableError();
          }
          const tenantUpdate = await client.query<{ readonly version: string }>(
            `
              UPDATE tenants.tenant_profiles
              SET status = 'error', version = version + 1, updated_at = CURRENT_TIMESTAMP
              WHERE id = $1::uuid AND status = 'provisioning'
              RETURNING version::text
            `,
            [completion.tenantProfileId],
          );
          if (tenantUpdate.rows[0]) tenantVersion = BigInt(tenantUpdate.rows[0].version);
          const updatedResult = await client.query<ProvisioningOperationRow>(
            `
              UPDATE operations.provisioning_operations AS operation
              SET status = 'failed', failure_code = $2::operations.provisioning_validation_failure_code,
                  lease_owner = NULL, lease_expires_at = NULL, last_heartbeat_at = NULL,
                  version = operation.version + 1, updated_at = CURRENT_TIMESTAMP
              WHERE operation.id = $1::uuid
              RETURNING ${provisioningOperationSelection}
            `,
            [completion.operationId, databaseFailureCode],
          );
          updatedOperation = updatedResult.rows[0];
        }
        if (!updatedOperation) throw new DatabaseUnavailableError();
        await client.query("COMMIT");
        return Object.freeze({
          operation: provisioningOperationFromRow(updatedOperation),
          tenantVersion,
          outcome: databaseFailureCode ? "FAILED" : "ADVANCED",
          failureCode: completion.failureCode ?? null,
        });
      } catch (error) {
        if (client) await client.query("ROLLBACK").catch(() => undefined);
        if (error instanceof DatabaseUnavailableError) throw error;
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
  });

  return Object.freeze({
    ...database,
    memberships,
    infrastructureServers,
    releases,
    tenantProfiles,
    provisioningOperations: Object.freeze({
      ...provisioningOperations,
      completeSecrets: (command: CompleteProvisioningSecretsCommand) =>
        completeProvisioningSecrets(pool, command),
    }),
  });
}
