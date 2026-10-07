import {
  TenantDecommissioningConflictError,
  TenantDecommissioningValidationError,
  type ClaimTenantDecommissioningCommand,
  type AdvanceTenantDecommissioningCommand,
  type CompleteTenantDecommissioningCommand,
  type RequestTenantDecommissioningCommand,
  type TenantDecommissioningOperation,
  type TenantDecommissioningRepository,
  type TenantDecommissioningRequestResult,
} from "@quantum-crm/platform-domain";
import type { PoolClient } from "pg";

import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

interface Row {
  readonly id: string;
  readonly tenant_profile_id: string;
  readonly requested_by_operator_id: string;
  readonly idempotency_key: string;
  readonly correlation_id: string;
  readonly confirmation_slug: string;
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

const selection = `
  id::text, tenant_profile_id::text, requested_by_operator_id::text, idempotency_key,
  correlation_id, confirmation_slug::text, status::text, current_step::text, attempt,
  version::text, failure_code::text, lease_owner, lease_expires_at, created_at, updated_at
`;

function operation(row: Row): TenantDecommissioningOperation {
  return Object.freeze({
    id: row.id,
    tenantProfileId: row.tenant_profile_id,
    requestedByOperatorId: row.requested_by_operator_id,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    confirmationSlug: row.confirmation_slug,
    status: row.status.toUpperCase() as TenantDecommissioningOperation["status"],
    currentStep: row.current_step.toUpperCase() as TenantDecommissioningOperation["currentStep"],
    attempt: row.attempt,
    version: BigInt(row.version),
    failureCode: row.failure_code
      ? (row.failure_code.toUpperCase() as TenantDecommissioningOperation["failureCode"])
      : null,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function databaseError(error: unknown): Error {
  if (
    error instanceof TenantDecommissioningConflictError ||
    error instanceof TenantDecommissioningValidationError ||
    error instanceof DatabaseUnavailableError
  ) {
    return error;
  }
  return new DatabaseUnavailableError();
}

export function createTenantDecommissioningRepository(
  pool: PostgresPool,
): TenantDecommissioningRepository {
  return Object.freeze({
    request: async (
      command: RequestTenantDecommissioningCommand,
    ): Promise<TenantDecommissioningRequestResult> => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${command.requestedByOperatorId}:${command.idempotencyKey}`,
        ]);
        const replay = await client.query<Row>(
          `SELECT ${selection} FROM operations.tenant_decommissioning_operations
           WHERE requested_by_operator_id = $1::uuid AND idempotency_key = $2 FOR UPDATE`,
          [command.requestedByOperatorId, command.idempotencyKey],
        );
        if (replay.rows[0]) {
          const version = await client.query<{ readonly version: string }>(
            "SELECT version::text FROM tenants.tenant_profiles WHERE id = $1::uuid",
            [command.tenantProfileId],
          );
          await client.query("COMMIT");
          if (!version.rows[0]) throw new TenantDecommissioningConflictError();
          return Object.freeze({
            operation: operation(replay.rows[0]),
            tenantVersion: BigInt(version.rows[0].version),
            idempotentReplay: true,
          });
        }
        const profile = await client.query<{
          readonly slug: string;
          readonly status: string;
          readonly version: string;
        }>(
          `SELECT slug::text, status::text, version::text FROM tenants.tenant_profiles
           WHERE id = $1::uuid FOR UPDATE`,
          [command.tenantProfileId],
        );
        const current = profile.rows[0];
        if (
          !current ||
          current.version !== command.expectedTenantVersion.toString() ||
          current.slug !== command.confirmationSlug ||
          !["provisioning", "active", "suspended", "error"].includes(current.status)
        ) {
          throw new TenantDecommissioningConflictError();
        }
        const openProvisioning = await client.query<{ readonly id: string }>(
          `SELECT id::text FROM operations.provisioning_operations
           WHERE tenant_profile_id = $1::uuid AND status IN ('pending', 'running') LIMIT 1`,
          [command.tenantProfileId],
        );
        if (openProvisioning.rows[0]) throw new TenantDecommissioningConflictError();
        const created = await client.query<Row>(
          `INSERT INTO operations.tenant_decommissioning_operations (
             tenant_profile_id, requested_by_operator_id, idempotency_key, correlation_id, confirmation_slug
           ) VALUES ($1::uuid, $2::uuid, $3, $4, $5)
           RETURNING ${selection}`,
          [
            command.tenantProfileId,
            command.requestedByOperatorId,
            command.idempotencyKey,
            command.correlationId,
            command.confirmationSlug,
          ],
        );
        const update = await client.query<{ readonly version: string }>(
          `UPDATE tenants.tenant_profiles SET status = 'decommissioning', version = version + 1,
            updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid RETURNING version::text`,
          [command.tenantProfileId],
        );
        if (!created.rows[0] || !update.rows[0]) throw new DatabaseUnavailableError();
        await client.query("COMMIT");
        return Object.freeze({
          operation: operation(created.rows[0]),
          tenantVersion: BigInt(update.rows[0].version),
          idempotentReplay: false,
        });
      } catch (error) {
        if (client) await client.query("ROLLBACK").catch(() => undefined);
        throw databaseError(error);
      } finally {
        client?.release();
      }
    },
    claimNext: async (command: ClaimTenantDecommissioningCommand) => {
      try {
        const result = (await pool.query(
          `WITH candidate AS (
             SELECT id FROM operations.tenant_decommissioning_operations
             WHERE status = 'pending' OR (status = 'running' AND lease_expires_at < CURRENT_TIMESTAMP)
             ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
           )
           UPDATE operations.tenant_decommissioning_operations AS operation
           SET status = 'running', attempt = operation.attempt + 1, lease_owner = $1,
             lease_expires_at = CURRENT_TIMESTAMP + ($2::text || ' seconds')::interval,
             version = operation.version + 1, updated_at = CURRENT_TIMESTAMP
           FROM candidate WHERE operation.id = candidate.id RETURNING ${selection}`,
          [command.workerId, command.leaseDurationSeconds.toString()],
        )) as { readonly rows: Row[] };
        return result.rows[0] ? operation(result.rows[0]) : null;
      } catch (error) {
        throw databaseError(error);
      }
    },
    resolveRuntimeContext: async (command: {
      readonly id: string;
      readonly workerId: string;
      readonly expectedVersion: bigint;
      readonly attempt: number;
    }) => {
      try {
        const result = (await pool.query(
          `SELECT profile.server_id::text, profile.release_id::text,
             configuration.configuration_revision::text AS configuration_revision
           FROM operations.tenant_decommissioning_operations AS operation
           JOIN tenants.tenant_profiles AS profile ON profile.id = operation.tenant_profile_id
           JOIN tenants.tenant_configurations AS configuration ON configuration.tenant_profile_id = profile.id
           WHERE operation.id = $1::uuid AND operation.status = 'running'
             AND operation.lease_owner = $2 AND operation.version = $3::bigint
             AND operation.attempt = $4 AND operation.lease_expires_at > CURRENT_TIMESTAMP
             AND profile.status = 'decommissioning' AND profile.server_id IS NOT NULL
             AND profile.release_id IS NOT NULL`,
          [command.id, command.workerId, command.expectedVersion.toString(), command.attempt],
        )) as { readonly rows: readonly { readonly server_id: string; readonly release_id: string; readonly configuration_revision: string }[] };
        const row = result.rows[0];
        return row
          ? Object.freeze({
              serverId: row.server_id,
              releaseId: row.release_id,
              configurationRevision: BigInt(row.configuration_revision),
            })
          : null;
      } catch (error) {
        throw databaseError(error);
      }
    },
    advance: async (command: AdvanceTenantDecommissioningCommand) => {
      try {
        const result = (await pool.query(
          `UPDATE operations.tenant_decommissioning_operations SET status = 'pending',
             current_step = $5::operations.tenant_decommissioning_step, lease_owner = NULL,
             lease_expires_at = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1::uuid AND status = 'running' AND current_step = $2::operations.tenant_decommissioning_step
             AND lease_owner = $3 AND version = $4::bigint AND attempt = $6
           RETURNING ${selection}`,
          [command.id, command.currentStep.toLowerCase(), command.workerId, command.expectedVersion.toString(), command.nextStep.toLowerCase(), command.attempt],
        )) as { readonly rows: Row[] };
        return result.rows[0] ? operation(result.rows[0]) : null;
      } catch (error) {
        throw databaseError(error);
      }
    },
    complete: async (command: CompleteTenantDecommissioningCommand) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const result = await client.query<Row>(
          `UPDATE operations.tenant_decommissioning_operations SET status = $5::operations.tenant_decommissioning_status,
             failure_code = $6::operations.tenant_decommissioning_failure_code, lease_owner = NULL,
             lease_expires_at = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1::uuid AND status = 'running' AND lease_owner = $2 AND version = $3::bigint AND attempt = $4
           RETURNING ${selection}`,
          [command.id, command.workerId, command.expectedVersion.toString(), command.attempt,
            command.failureCode ? "failed" : "succeeded", command.failureCode?.toLowerCase() ?? null],
        );
        const done = result.rows[0];
        if (!done) {
          await client.query("COMMIT");
          return null;
        }
        if (!command.failureCode) {
          const reservation = await client.query<{
            readonly id: string;
            readonly server_id: string;
            readonly cpu_millicores: number;
            readonly memory_mib: number;
            readonly storage_mib: number;
          }>(
            `UPDATE infrastructure.capacity_reservations
             SET status = 'released', updated_at = CURRENT_TIMESTAMP
             WHERE tenant_profile_id = $1::uuid AND status IN ('reserved', 'active')
             RETURNING id::text, server_id::text, cpu_millicores, memory_mib, storage_mib`,
            [done.tenant_profile_id],
          );
          for (const item of reservation.rows) {
            const released = await client.query<{ readonly id: string }>(
              `UPDATE infrastructure.servers SET
                 reserved_cpu_millicores = reserved_cpu_millicores - $2,
                 reserved_memory_mib = reserved_memory_mib - $3,
                 reserved_storage_mib = reserved_storage_mib - $4,
                 version = version + 1, updated_at = CURRENT_TIMESTAMP
               WHERE id = $1::uuid AND reserved_cpu_millicores >= $2
                 AND reserved_memory_mib >= $3 AND reserved_storage_mib >= $4 RETURNING id::text`,
              [item.server_id, item.cpu_millicores, item.memory_mib, item.storage_mib],
            );
            if (!released.rows[0]) throw new DatabaseUnavailableError();
          }
          await client.query(
            `UPDATE tenants.tenant_profiles SET status = 'deleted', version = version + 1,
              updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid AND status = 'decommissioning'`,
            [done.tenant_profile_id],
          );
        }
        await client.query("COMMIT");
        return operation(done);
      } catch (error) {
        if (client) await client.query("ROLLBACK").catch(() => undefined);
        throw databaseError(error);
      } finally {
        client?.release();
      }
    },
  });
}
