import {
  PlatformFoundationPromotionValidationError,
  validatePlatformFoundationPromotionClaim,
  validatePlatformFoundationPromotionCompletion,
  validatePlatformFoundationPromotionRequest,
  type PlatformFoundationPromotion,
  type PlatformFoundationPromotionRepository,
} from "@quantum-crm/platform-domain";

import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";
import type { PoolClient } from "pg";

interface PromotionRow {
  readonly id: string;
  readonly release_id: string;
  readonly requested_by_operator_id: string;
  readonly idempotency_key: string;
  readonly correlation_id: string;
  readonly status: string;
  readonly attempt: number;
  readonly version: string;
  readonly lease_owner: string | null;
  readonly lease_expires_at: Date | null;
  readonly failure_code: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}
const selection =
  "id::text, release_id::text, requested_by_operator_id::text, idempotency_key, correlation_id, status::text, attempt, version::text, lease_owner, lease_expires_at, failure_code::text, created_at, updated_at";
function promote(row: PromotionRow): PlatformFoundationPromotion {
  const status = row.status.toUpperCase();
  const failure = row.failure_code?.toUpperCase() ?? null;
  if (
    !["PENDING", "RUNNING", "SUCCEEDED", "FAILED"].includes(status) ||
    (failure &&
      !["UNAVAILABLE", "IDENTITY_MISMATCH", "TARGET_CONFLICT", "PERMISSION_DENIED"].includes(
        failure,
      ))
  )
    throw new DatabaseUnavailableError();
  return Object.freeze({
    id: row.id,
    releaseId: row.release_id,
    requestedByOperatorId: row.requested_by_operator_id,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    status: status as PlatformFoundationPromotion["status"],
    attempt: row.attempt,
    version: BigInt(row.version),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    failureCode: failure as PlatformFoundationPromotion["failureCode"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
export function createPlatformFoundationPromotionRepository(
  pool: PostgresPool,
): PlatformFoundationPromotionRepository {
  return Object.freeze<PlatformFoundationPromotionRepository>({
    request: async (raw) => {
      const command = validatePlatformFoundationPromotionRequest(raw);
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const release = await client.query<{ readonly id: string }>(
          "SELECT id::text FROM releases.releases WHERE id=$1::uuid AND status='validated' FOR KEY SHARE",
          [command.releaseId],
        );
        if (!release.rows[0]) throw new PlatformFoundationPromotionValidationError("releaseId");
        const replay = await client.query<PromotionRow>(
          `SELECT ${selection} FROM operations.platform_foundation_promotions WHERE requested_by_operator_id=$1::uuid AND idempotency_key=$2 FOR UPDATE`,
          [command.requestedByOperatorId, command.idempotencyKey],
        );
        if (replay.rows[0]) {
          if (replay.rows[0].release_id !== command.releaseId)
            throw new PlatformFoundationPromotionValidationError("idempotencyKey");
          await client.query("COMMIT");
          return Object.freeze({ promotion: promote(replay.rows[0]), idempotentReplay: true });
        }
        const existing = await client.query<PromotionRow>(
          `SELECT ${selection} FROM operations.platform_foundation_promotions WHERE release_id=$1::uuid FOR UPDATE`,
          [command.releaseId],
        );
        if (existing.rows[0]) throw new PlatformFoundationPromotionValidationError("releaseId");
        const inserted = await client.query<PromotionRow>(
          `INSERT INTO operations.platform_foundation_promotions (id, release_id, requested_by_operator_id, idempotency_key, correlation_id) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5) RETURNING ${selection}`,
          [
            command.id,
            command.releaseId,
            command.requestedByOperatorId,
            command.idempotencyKey,
            command.correlationId,
          ],
        );
        if (!inserted.rows[0]) throw new DatabaseUnavailableError();
        await client.query("COMMIT");
        return Object.freeze({ promotion: promote(inserted.rows[0]), idempotentReplay: false });
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        if (error instanceof PlatformFoundationPromotionValidationError) throw error;
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    claimNext: async (raw) => {
      const command = validatePlatformFoundationPromotionClaim(raw);
      try {
        const result = (await pool.query(
          `WITH candidate AS (SELECT id FROM operations.platform_foundation_promotions WHERE status='pending' OR (status='running' AND lease_expires_at <= CURRENT_TIMESTAMP) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE operations.platform_foundation_promotions promotion SET status='running', attempt=attempt+1, lease_owner=$1, lease_expires_at=CURRENT_TIMESTAMP + ($2::integer * INTERVAL '1 second'), failure_code=NULL, version=version+1, updated_at=CURRENT_TIMESTAMP FROM candidate WHERE promotion.id=candidate.id RETURNING promotion.id, promotion.release_id, promotion.requested_by_operator_id, promotion.idempotency_key, promotion.correlation_id, promotion.status, promotion.attempt, promotion.version, promotion.lease_owner, promotion.lease_expires_at, promotion.failure_code, promotion.created_at, promotion.updated_at`,
          [command.workerId, command.leaseDurationSeconds],
        )) as { readonly rows: readonly PromotionRow[] };
        return result.rows[0] ? promote(result.rows[0]) : null;
      } catch (error) {
        if (error instanceof PlatformFoundationPromotionValidationError) throw error;
        throw new DatabaseUnavailableError();
      }
    },
    complete: async (raw) => {
      const command = validatePlatformFoundationPromotionCompletion(raw);
      try {
        const result = (await pool.query(
          `UPDATE operations.platform_foundation_promotions SET status=$5::operations.platform_foundation_promotion_status, failure_code=$6::operations.platform_foundation_promotion_failure_code, lease_owner=NULL, lease_expires_at=NULL, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND status='running' AND lease_owner=$2 AND version=$3 AND attempt=$4 AND lease_expires_at > CURRENT_TIMESTAMP RETURNING ${selection}`,
          [
            command.id,
            command.workerId,
            command.expectedVersion.toString(),
            command.attempt,
            command.failureCode ? "failed" : "succeeded",
            command.failureCode?.toLowerCase() ?? null,
          ],
        )) as { readonly rows: readonly PromotionRow[] };
        return result.rows[0] ? promote(result.rows[0]) : null;
      } catch (error) {
        if (error instanceof PlatformFoundationPromotionValidationError) throw error;
        throw new DatabaseUnavailableError();
      }
    },
  });
}
