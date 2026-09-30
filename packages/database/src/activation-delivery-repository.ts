import {
  activationDeliveryTtlMilliseconds,
  ActivationDeliveryValidationError,
  completeActivationDelivery,
  type ActivationDeliveryIntent,
  type ActivationDeliveryRepository,
  type TenantInitialAdministrator,
} from "@quantum-crm/platform-domain";
import type { PoolClient } from "pg";

import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

interface IntentRow {
  readonly id: string;
  readonly tenant_profile_id: string;
  readonly requested_by_operator_id: string;
  readonly administrator_subject: string;
  readonly generation: number;
  readonly expires_at: Date;
  readonly correlation_id: string;
  readonly idempotency_key: string;
  readonly payload_hash: string;
  readonly status: string;
  readonly lease_owner: string | null;
  readonly lease_expires_at: Date | null;
  readonly result_code: string | null;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}
interface AdministratorRow {
  readonly tenant_profile_id: string;
  readonly keycloak_subject: string | null;
  readonly generation: number;
  readonly status: string;
  readonly expires_at: Date | null;
  readonly consumed_at: Date | null;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}
const intentSelection =
  "id::text, tenant_profile_id::text, requested_by_operator_id::text, administrator_subject, generation, expires_at, correlation_id, idempotency_key, payload_hash, status::text, lease_owner, lease_expires_at, result_code, version::text, created_at, updated_at";
const administratorSelection =
  "tenant_profile_id::text, keycloak_subject, generation, status::text, expires_at, consumed_at, version::text, created_at, updated_at";
const qualifiedAdministratorSelection =
  "administrator.tenant_profile_id::text, administrator.keycloak_subject, administrator.generation, administrator.status::text, administrator.expires_at, administrator.consumed_at, administrator.version::text, administrator.created_at, administrator.updated_at";
const time = (value: Date): void => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    throw new ActivationDeliveryValidationError();
};
function toIntent(row: IntentRow): ActivationDeliveryIntent {
  return Object.freeze({
    id: row.id,
    tenantProfileId: row.tenant_profile_id,
    requestedByOperatorId: row.requested_by_operator_id,
    administratorSubject: row.administrator_subject,
    generation: row.generation,
    expiresAt: row.expires_at,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    payloadHash: row.payload_hash,
    status: row.status.toUpperCase() as ActivationDeliveryIntent["status"],
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    resultCode: row.result_code as ActivationDeliveryIntent["resultCode"],
    version: BigInt(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
function toAdministrator(row: AdministratorRow): TenantInitialAdministrator {
  return Object.freeze({
    tenantProfileId: row.tenant_profile_id,
    subject: row.keycloak_subject,
    generation: row.generation,
    status: row.status.toUpperCase() as TenantInitialAdministrator["status"],
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    version: BigInt(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function createActivationDeliveryRepository(
  pool: PostgresPool,
): ActivationDeliveryRepository {
  return Object.freeze<ActivationDeliveryRepository>({
    request: async (command) => {
      time(command.now);
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${command.requestedByOperatorId}:${command.idempotencyKey}`,
        ]);
        await client.query(
          `UPDATE operations.activation_delivery_intents SET status='expired', result_code='EXPIRED', lease_owner=NULL, lease_expires_at=NULL, version=version+1, updated_at=$2 WHERE tenant_profile_id=$1::uuid AND status IN ('pending', 'claimed') AND expires_at <= $2`,
          [command.tenantProfileId, command.now],
        );
        const replay = await client.query<IntentRow>(
          `SELECT ${intentSelection} FROM operations.activation_delivery_intents WHERE requested_by_operator_id=$1::uuid AND idempotency_key=$2 FOR UPDATE`,
          [command.requestedByOperatorId, command.idempotencyKey],
        );
        if (replay.rows[0]) {
          if (
            replay.rows[0].payload_hash !== command.payloadHash ||
            replay.rows[0].tenant_profile_id !== command.tenantProfileId
          )
            throw new ActivationDeliveryValidationError();
          await client.query("COMMIT");
          return Object.freeze({ intent: toIntent(replay.rows[0]), idempotentReplay: true });
        }
        const initial = await client.query<AdministratorRow & { readonly tenant_version: string }>(
          `SELECT ${qualifiedAdministratorSelection}, profile.version::text AS tenant_version FROM tenants.tenant_initial_administrators administrator JOIN tenants.tenant_profiles profile ON profile.id=administrator.tenant_profile_id WHERE administrator.tenant_profile_id=$1::uuid FOR UPDATE`,
          [command.tenantProfileId],
        );
        const row = initial.rows[0];
        if (
          !row ||
          BigInt(row.tenant_version) !== command.expectedTenantVersion ||
          !row.keycloak_subject ||
          row.status === "consumed"
        )
          throw new ActivationDeliveryValidationError();
        const result = await client.query<IntentRow>(
          `INSERT INTO operations.activation_delivery_intents (id, tenant_profile_id, requested_by_operator_id, administrator_subject, generation, expires_at, correlation_id, idempotency_key, payload_hash) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9) RETURNING ${intentSelection}`,
          [
            command.id,
            command.tenantProfileId,
            command.requestedByOperatorId,
            row.keycloak_subject,
            row.generation + 1,
            new Date(command.now.getTime() + activationDeliveryTtlMilliseconds),
            command.correlationId,
            command.idempotencyKey,
            command.payloadHash,
          ],
        );
        if (!result.rows[0]) throw new DatabaseUnavailableError();
        await client.query("COMMIT");
        return Object.freeze({ intent: toIntent(result.rows[0]), idempotentReplay: false });
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        if (error instanceof ActivationDeliveryValidationError) throw error;
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    claimNext: async (command) => {
      time(command.now);
      if (
        !/^[A-Za-z0-9._:-]{1,128}$/u.test(command.workerId) ||
        !Number.isInteger(command.leaseDurationSeconds) ||
        command.leaseDurationSeconds < 1 ||
        command.leaseDurationSeconds > 300
      )
        throw new ActivationDeliveryValidationError();
      try {
        const result = (await pool.query(
          `WITH expired AS (UPDATE operations.activation_delivery_intents SET status='expired', result_code='EXPIRED', lease_owner=NULL, lease_expires_at=NULL, version=version+1, updated_at=$3 WHERE status IN ('pending', 'claimed') AND expires_at <= $3), candidate AS (SELECT id FROM operations.activation_delivery_intents WHERE (status='pending' OR (status='claimed' AND lease_expires_at <= $3)) AND expires_at > $3 ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE operations.activation_delivery_intents intent SET status='claimed', lease_owner=$1, lease_expires_at=$3 + ($2::integer * INTERVAL '1 second'), version=intent.version+1, updated_at=$3 FROM candidate WHERE intent.id=candidate.id RETURNING intent.id, intent.tenant_profile_id, intent.requested_by_operator_id, intent.administrator_subject, intent.generation, intent.expires_at, intent.correlation_id, intent.idempotency_key, intent.payload_hash, intent.status, intent.lease_owner, intent.lease_expires_at, intent.result_code, intent.version, intent.created_at, intent.updated_at`,
          [command.workerId, command.leaseDurationSeconds, command.now],
        )) as { readonly rows: readonly IntentRow[] };
        return result.rows[0] ? toIntent(result.rows[0]) : null;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    complete: async (command) => {
      time(command.now);
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const current = await client.query<IntentRow>(
          `SELECT ${intentSelection} FROM operations.activation_delivery_intents WHERE id=$1::uuid AND status='claimed' AND lease_owner=$2 AND version=$3 AND lease_expires_at > $4 FOR UPDATE`,
          [command.intentId, command.workerId, command.expectedVersion.toString(), command.now],
        );
        const row = current.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        const completion = completeActivationDelivery(toIntent(row), command, command.now);
        const updated = await client.query<IntentRow>(
          `UPDATE operations.activation_delivery_intents SET status=$2::operations.activation_delivery_status, result_code=$3, lease_owner=NULL, lease_expires_at=NULL, version=version+1, updated_at=$4 WHERE id=$1::uuid RETURNING ${intentSelection}`,
          [command.intentId, completion.status.toLowerCase(), command.resultCode, command.now],
        );
        if (!updated.rows[0]) throw new DatabaseUnavailableError();
        if (completion.status === "DELIVERED")
          await client.query(
            `UPDATE tenants.tenant_initial_administrators SET generation=$3, status='activation_issued', expires_at=$4, consumed_at=NULL, version=version+1, updated_at=$5 WHERE tenant_profile_id=$1::uuid AND keycloak_subject=$2 AND status <> 'consumed'`,
            [
              row.tenant_profile_id,
              row.administrator_subject,
              row.generation,
              row.expires_at,
              command.now,
            ],
          );
        await client.query("COMMIT");
        return toIntent(updated.rows[0]);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        if (error instanceof ActivationDeliveryValidationError) throw error;
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    reconcileInitialAdministrator: async (command) => {
      time(command.now);
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const result = await client.query<AdministratorRow>(
          `INSERT INTO tenants.tenant_initial_administrators (tenant_profile_id, keycloak_subject) VALUES ($1::uuid,$2) ON CONFLICT (tenant_profile_id) DO UPDATE SET keycloak_subject=CASE WHEN tenants.tenant_initial_administrators.keycloak_subject IS NULL THEN EXCLUDED.keycloak_subject ELSE tenants.tenant_initial_administrators.keycloak_subject END, version=tenants.tenant_initial_administrators.version+1, updated_at=$3 WHERE tenants.tenant_initial_administrators.version=$4 AND (tenants.tenant_initial_administrators.keycloak_subject IS NULL OR tenants.tenant_initial_administrators.keycloak_subject=$2) RETURNING ${administratorSelection}`,
          [
            command.tenantProfileId,
            command.subject,
            command.now,
            command.expectedVersion.toString(),
          ],
        );
        await client.query("COMMIT");
        return result.rows[0] ? toAdministrator(result.rows[0]) : null;
      } catch {
        await client?.query("ROLLBACK").catch(() => undefined);
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    findInitialAdministrator: async (tenantProfileId) => {
      try {
        const result = (await pool.query(
          `SELECT ${administratorSelection} FROM tenants.tenant_initial_administrators WHERE tenant_profile_id=$1::uuid`,
          [tenantProfileId],
        )) as { readonly rows: readonly AdministratorRow[] };
        return result.rows[0] ? toAdministrator(result.rows[0]) : null;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    consumeInitialAdministrator: async (command) => {
      time(command.now);
      if (
        !/^[0-9a-f-]{36}$/u.test(command.tenantProfileId) ||
        command.subject.length < 1 ||
        command.subject.length > 255 ||
        !Number.isInteger(command.generation) ||
        command.generation < 1
      )
        throw new ActivationDeliveryValidationError();
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const delivered = await client.query<IntentRow>(
          `SELECT ${intentSelection} FROM operations.activation_delivery_intents WHERE tenant_profile_id=$1::uuid AND administrator_subject=$2 AND generation=$3 AND status='delivered' FOR UPDATE`,
          [command.tenantProfileId, command.subject, command.generation],
        );
        if (!delivered.rows[0]) {
          await client.query("COMMIT");
          return null;
        }
        const result = await client.query<AdministratorRow>(
          `UPDATE tenants.tenant_initial_administrators SET status='consumed', consumed_at=$4, version=version+1, updated_at=$4 WHERE tenant_profile_id=$1::uuid AND keycloak_subject=$2 AND generation=$3 AND status='activation_issued' RETURNING ${administratorSelection}`,
          [command.tenantProfileId, command.subject, command.generation, command.now],
        );
        if (!result.rows[0]) {
          await client.query("COMMIT");
          return null;
        }
        const consumed = await client.query<IntentRow>(
          `UPDATE operations.activation_delivery_intents SET status='consumed', result_code='CONSUMED', version=version+1, updated_at=$2 WHERE id=$1::uuid AND status='delivered' RETURNING ${intentSelection}`,
          [delivered.rows[0].id, command.now],
        );
        if (!consumed.rows[0]) throw new DatabaseUnavailableError();
        await client.query("COMMIT");
        return toAdministrator(result.rows[0]);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        if (error instanceof ActivationDeliveryValidationError) throw error;
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
  });
}
