import {
  TenantReleasePromotionConflictError,
  TenantReleasePromotionValidationError,
  validateTenantReleasePromotionClaim,
  validateTenantReleasePromotionAdvance,
  validateTenantReleasePromotionContext,
  validateTenantReleasePromotionCompletion,
  validateTenantReleasePromotionRequest,
  type TenantReleasePromotion,
  type TenantReleasePromotionRepository,
  type AdvanceTenantReleasePromotionCommand,
  type ClaimTenantReleasePromotionCommand,
  type CompleteTenantReleasePromotionCommand,
  type RequestTenantReleasePromotionCommand,
  type ResolveTenantReleasePromotionContextCommand,
} from "@quantum-crm/platform-domain";
import type { PoolClient } from "pg";
import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

interface PromotionRow {
  readonly id: string;
  readonly tenant_profile_id: string;
  readonly previous_release_id: string;
  readonly target_release_id: string;
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
  readonly created_at: Date;
  readonly updated_at: Date;
}
const selection =
  "id::text, tenant_profile_id::text, previous_release_id::text, target_release_id::text, requested_by_operator_id::text, idempotency_key, correlation_id, status::text, current_step::text, attempt, version::text, failure_code::text, lease_owner, lease_expires_at, created_at, updated_at";
const failures = new Set([
  "TENANT_STATE_INVALID",
  "RELEASE_NOT_VALIDATED",
  "TARGET_CONFLICT",
  "MIGRATION_FAILED",
  "RECONCILIATION_FAILED",
  "VERIFICATION_FAILED",
  "PERMISSION_DENIED",
  "UNAVAILABLE",
]);
function fromRow(row: PromotionRow): TenantReleasePromotion {
  const status = row.status.toUpperCase();
  const step = row.current_step.toUpperCase();
  const failure = row.failure_code?.toUpperCase() ?? null;
  if (
    !/[A-Z]+/.test(status) ||
    !["PENDING", "RUNNING", "SUCCEEDED", "FAILED"].includes(status) ||
    !["VALIDATE", "MIGRATE", "RECONCILE", "VERIFY", "ACTIVATE"].includes(step) ||
    (failure && !failures.has(failure))
  )
    throw new DatabaseUnavailableError();
  return Object.freeze({
    id: row.id,
    tenantProfileId: row.tenant_profile_id,
    previousReleaseId: row.previous_release_id,
    targetReleaseId: row.target_release_id,
    requestedByOperatorId: row.requested_by_operator_id,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    status: status as TenantReleasePromotion["status"],
    currentStep: step as TenantReleasePromotion["currentStep"],
    attempt: row.attempt,
    version: BigInt(row.version),
    failureCode: failure as TenantReleasePromotion["failureCode"],
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function createTenantReleasePromotionRepository(
  pool: PostgresPool,
): TenantReleasePromotionRepository {
  return Object.freeze({
    request: async (raw: RequestTenantReleasePromotionCommand) => {
      const command = validateTenantReleasePromotionRequest(raw);
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const profile = (await client.query(
          "SELECT id::text, status::text, release_id::text, version::text FROM tenants.tenant_profiles WHERE id=$1::uuid FOR UPDATE",
          [command.tenantProfileId],
        )) as {
          rows: { id: string; status: string; release_id: string | null; version: string }[];
        };
        const current = profile.rows[0];
        if (!current || current.status !== "active" || !current.release_id)
          throw new TenantReleasePromotionValidationError("tenantProfileId");
        if (BigInt(current.version) !== command.expectedTenantVersion)
          throw new TenantReleasePromotionValidationError("expectedTenantVersion");
        if (current.release_id === command.targetReleaseId)
          throw new TenantReleasePromotionValidationError("targetReleaseId");
        const release = (await client.query(
          "SELECT id::text FROM releases.releases WHERE id=$1::uuid AND status='validated' FOR KEY SHARE",
          [command.targetReleaseId],
        )) as { rows: { id: string }[] };
        if (!release.rows[0]) throw new TenantReleasePromotionValidationError("targetReleaseId");
        const replay = (await client.query(
          `SELECT ${selection} FROM operations.tenant_release_promotions WHERE requested_by_operator_id=$1::uuid AND idempotency_key=$2 FOR UPDATE`,
          [command.requestedByOperatorId, command.idempotencyKey],
        )) as { rows: PromotionRow[] };
        if (replay.rows[0]) {
          if (
            replay.rows[0].tenant_profile_id !== command.tenantProfileId ||
            replay.rows[0].target_release_id !== command.targetReleaseId
          )
            throw new TenantReleasePromotionConflictError();
          await client.query("COMMIT");
          return {
            promotion: fromRow(replay.rows[0]),
            tenantVersion: BigInt(current.version),
            idempotentReplay: true,
          };
        }
        const existing = (await client.query(
          "SELECT id::text FROM operations.tenant_release_promotions WHERE tenant_profile_id=$1::uuid AND status IN ('pending','running') FOR UPDATE",
          [command.tenantProfileId],
        )) as { rows: { id: string }[] };
        if (existing.rows[0]) throw new TenantReleasePromotionConflictError();
        const inserted = (await client.query(
          `INSERT INTO operations.tenant_release_promotions (id, tenant_profile_id, previous_release_id, target_release_id, requested_by_operator_id, idempotency_key, correlation_id) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7) RETURNING ${selection}`,
          [
            command.id,
            command.tenantProfileId,
            current.release_id,
            command.targetReleaseId,
            command.requestedByOperatorId,
            command.idempotencyKey,
            command.correlationId,
          ],
        )) as { rows: PromotionRow[] };
        if (!inserted.rows[0]) throw new DatabaseUnavailableError();
        await client.query("COMMIT");
        return {
          promotion: fromRow(inserted.rows[0]),
          tenantVersion: BigInt(current.version),
          idempotentReplay: false,
        };
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        if (
          error instanceof TenantReleasePromotionValidationError ||
          error instanceof TenantReleasePromotionConflictError
        )
          throw error;
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    claimNext: async (raw: ClaimTenantReleasePromotionCommand) => {
      const command = validateTenantReleasePromotionClaim(raw);
      try {
        const result = (await pool.query(
          `WITH candidate AS (SELECT id FROM operations.tenant_release_promotions WHERE status='pending' OR (status='running' AND lease_expires_at <= CURRENT_TIMESTAMP) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE operations.tenant_release_promotions promotion SET status='running', attempt=attempt+1, lease_owner=$1, lease_expires_at=CURRENT_TIMESTAMP + ($2::integer * INTERVAL '1 second'), version=version+1, updated_at=CURRENT_TIMESTAMP FROM candidate WHERE promotion.id=candidate.id RETURNING ${selection}`,
          [command.workerId, command.leaseDurationSeconds],
        )) as { rows: PromotionRow[] };
        return result.rows[0] ? fromRow(result.rows[0]) : null;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    resolveContext: async (raw: ResolveTenantReleasePromotionContextCommand) => {
      const command = validateTenantReleasePromotionContext(raw);
      try {
        const result = (await pool.query(
          `SELECT configuration.server_id::text AS server_id,
                  storage.quota_mib,
                  configuration.configuration_revision::text AS configuration_revision
             FROM operations.tenant_release_promotions promotion
             JOIN tenants.tenant_profiles profile
               ON profile.id = promotion.tenant_profile_id
             JOIN tenants.tenant_configurations configuration
               ON configuration.tenant_profile_id = profile.id
             JOIN tenants.tenant_storage storage
               ON storage.tenant_profile_id = profile.id
            WHERE promotion.id = $1::uuid
              AND promotion.status = 'running'
              AND promotion.current_step IN ('validate','migrate','reconcile','verify')
              AND promotion.tenant_profile_id = profile.id
              AND profile.status = 'active'
              AND profile.release_id = promotion.previous_release_id
              AND promotion.lease_owner = $2
              AND promotion.version = $3
              AND promotion.attempt = $4
              AND promotion.lease_expires_at > CURRENT_TIMESTAMP`,
          [command.id, command.workerId, command.expectedVersion.toString(), command.attempt],
        )) as { rows: { server_id: string; quota_mib: number; configuration_revision: string }[] };
        const row = result.rows[0];
        if (!row || !Number.isSafeInteger(row.quota_mib) || row.quota_mib < 1) return null;
        const configurationRevision = BigInt(row.configuration_revision);
        if (configurationRevision < 1n) throw new DatabaseUnavailableError();
        return Object.freeze({
          serverId: row.server_id,
          quotaMiB: row.quota_mib,
          configurationRevision,
        });
      } catch (error) {
        if (error instanceof DatabaseUnavailableError) throw error;
        throw new DatabaseUnavailableError();
      }
    },
    advance: async (raw: AdvanceTenantReleasePromotionCommand) => {
      const command = validateTenantReleasePromotionAdvance(raw);
      try {
        const result = (await pool.query(
          `UPDATE operations.tenant_release_promotions
              SET current_step = $5::operations.tenant_release_promotion_step,
                  version = version + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1::uuid
              AND status = 'running'
              AND current_step = $6::operations.tenant_release_promotion_step
              AND lease_owner = $2
              AND version = $3
              AND attempt = $4
              AND lease_expires_at > CURRENT_TIMESTAMP
            RETURNING ${selection}`,
          [
            command.id,
            command.workerId,
            command.expectedVersion.toString(),
            command.attempt,
            command.nextStep.toLowerCase(),
            command.currentStep.toLowerCase(),
          ],
        )) as { rows: PromotionRow[] };
        return result.rows[0] ? fromRow(result.rows[0]) : null;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    complete: async (raw: CompleteTenantReleasePromotionCommand) => {
      const command = validateTenantReleasePromotionCompletion(raw);
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const locked = (await client.query(
          `SELECT ${selection}
             FROM operations.tenant_release_promotions
            WHERE id=$1::uuid AND status='running'
              AND ($5::boolean OR current_step='activate')
              AND lease_owner=$2 AND version=$3 AND attempt=$4
              AND lease_expires_at > CURRENT_TIMESTAMP
            FOR UPDATE`,
          [
            command.id,
            command.workerId,
            command.expectedVersion.toString(),
            command.attempt,
            Boolean(command.failureCode),
          ],
        )) as {
          rows: (PromotionRow & {
            previous_release_id: string;
            tenant_profile_id: string;
            target_release_id: string;
          })[];
        };
        const current = locked.rows[0];
        if (!current) {
          await client.query("COMMIT");
          return null;
        }
        if (!command.failureCode) {
          const activated = await client.query(
            `UPDATE tenants.tenant_profiles
                SET release_id = $2::uuid, version = version + 1, updated_at = CURRENT_TIMESTAMP
              WHERE id = $1::uuid AND status = 'active' AND release_id = $3::uuid`,
            [current.tenant_profile_id, current.target_release_id, current.previous_release_id],
          );
          if (activated.rowCount !== 1) throw new DatabaseUnavailableError();
          const configuration = await client.query(
            `UPDATE tenants.tenant_configurations
                SET release_id = $2::uuid, configuration_revision = configuration_revision + 1,
                    version = version + 1, updated_at = CURRENT_TIMESTAMP
              WHERE tenant_profile_id = $1::uuid`,
            [current.tenant_profile_id, current.target_release_id],
          );
          if (configuration.rowCount !== 1) throw new DatabaseUnavailableError();
          await client.query(
            `UPDATE tenants.tenant_containers
                SET release_id = $2::uuid, configuration_revision = configuration_revision + 1,
                    version = version + 1, updated_at = CURRENT_TIMESTAMP
              WHERE tenant_profile_id = $1::uuid`,
            [current.tenant_profile_id, current.target_release_id],
          );
        }
        const result = (await client.query(
          `UPDATE operations.tenant_release_promotions
              SET status=$6::operations.tenant_release_promotion_status,
                  failure_code=$7::operations.tenant_release_promotion_failure_code,
                  lease_owner=NULL, lease_expires_at=NULL, version=version+1,
                  updated_at=CURRENT_TIMESTAMP
            WHERE id=$1::uuid
              AND ($5::boolean OR current_step='activate')
            RETURNING ${selection}`,
          [
            command.id,
            command.workerId,
            command.expectedVersion.toString(),
            command.attempt,
            Boolean(command.failureCode),
            command.failureCode ? "failed" : "succeeded",
            command.failureCode?.toLowerCase() ?? null,
          ],
        )) as { rows: PromotionRow[] };
        await client.query("COMMIT");
        return result.rows[0] ? fromRow(result.rows[0]) : null;
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        if (error instanceof DatabaseUnavailableError) throw error;
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
  });
}
