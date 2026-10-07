import {
  ProfileOperatorConflictError,
  ProfileOperatorValidationError,
  type ProfileOperatorAssignment,
  type ProfileOperatorRepository,
} from "@quantum-crm/platform-domain";
import type { PoolClient } from "pg";

import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

interface AssignmentRow {
  readonly id: string;
  readonly tenant_profile_id: string;
  readonly requested_by_operator_id: string;
  readonly operator_id: string | null;
  readonly oidc_subject: string | null;
  readonly display_name: string;
  readonly email: string;
  readonly status: string;
  readonly correlation_id: string;
  readonly idempotency_key: string;
  readonly lease_owner: string | null;
  readonly lease_expires_at: Date | null;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const selection =
  "id::text, tenant_profile_id::text, requested_by_operator_id::text, operator_id::text, oidc_subject, display_name, email::text, status::text, correlation_id, idempotency_key, lease_owner, lease_expires_at, version::text, created_at, updated_at";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function assignment(row: AssignmentRow): ProfileOperatorAssignment {
  return Object.freeze({
    id: row.id,
    tenantProfileId: row.tenant_profile_id,
    requestedByOperatorId: row.requested_by_operator_id,
    operatorId: row.operator_id,
    oidcSubject: row.oidc_subject,
    displayName: row.display_name,
    email: row.email,
    status: row.status.toUpperCase() as ProfileOperatorAssignment["status"],
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    version: BigInt(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function validateDate(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ProfileOperatorValidationError();
  }
}

function databaseError(error: unknown): never {
  if (
    error instanceof ProfileOperatorConflictError ||
    error instanceof ProfileOperatorValidationError
  ) {
    throw error;
  }
  throw new DatabaseUnavailableError();
}

export function createProfileOperatorRepository(pool: PostgresPool): ProfileOperatorRepository {
  return Object.freeze<ProfileOperatorRepository>({
    list: async (tenantProfileId) => {
      if (!uuidPattern.test(tenantProfileId)) throw new ProfileOperatorValidationError();
      try {
        const result = (await pool.query(
          `SELECT ${selection} FROM platform_iam.profile_operator_assignments WHERE tenant_profile_id=$1::uuid AND status <> 'failed' ORDER BY created_at,id LIMIT 2`,
          [tenantProfileId],
        )) as { readonly rows: readonly AssignmentRow[] };
        return Object.freeze(result.rows.map(assignment));
      } catch (error) {
        databaseError(error);
      }
    },
    request: async (command) => {
      validateDate(command.now);
      const displayName = command.displayName.trim();
      const email = command.email.trim().toLowerCase();
      if (
        !uuidPattern.test(command.id) ||
        !uuidPattern.test(command.tenantProfileId) ||
        !uuidPattern.test(command.requestedByOperatorId) ||
        displayName.length < 1 ||
        displayName.length > 160 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
        email.length > 320 ||
        !/^[A-Za-z0-9._:-]{8,128}$/u.test(command.idempotencyKey) ||
        command.correlationId.length < 1 ||
        command.correlationId.length > 128
      ) {
        throw new ProfileOperatorValidationError();
      }
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const profile = await client.query<{ readonly id: string }>(
          "SELECT id::text FROM tenants.tenant_profiles WHERE id=$1::uuid AND status <> 'deleted' FOR UPDATE",
          [command.tenantProfileId],
        );
        if (!profile.rows[0]) throw new ProfileOperatorConflictError();
        const replay = await client.query<AssignmentRow>(
          `SELECT ${selection} FROM platform_iam.profile_operator_assignments WHERE requested_by_operator_id=$1::uuid AND idempotency_key=$2 FOR UPDATE`,
          [command.requestedByOperatorId, command.idempotencyKey],
        );
        if (replay.rows[0]) {
          const current = assignment(replay.rows[0]);
          if (
            current.tenantProfileId !== command.tenantProfileId ||
            current.displayName !== displayName ||
            current.email !== email
          ) {
            throw new ProfileOperatorConflictError();
          }
          await client.query("COMMIT");
          client.release();
          client = undefined;
          return Object.freeze({ assignment: current, idempotentReplay: true });
        }
        const count = await client.query<{ readonly count: string }>(
          "SELECT count(*)::text AS count FROM platform_iam.profile_operator_assignments WHERE tenant_profile_id=$1::uuid AND status IN ('pending','active')",
          [command.tenantProfileId],
        );
        if (Number(count.rows[0]?.count ?? "0") >= 2) throw new ProfileOperatorConflictError();
        const result = await client.query<AssignmentRow>(
          `INSERT INTO platform_iam.profile_operator_assignments (id,tenant_profile_id,requested_by_operator_id,display_name,email,correlation_id,idempotency_key,created_at,updated_at) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$8) RETURNING ${selection}`,
          [
            command.id,
            command.tenantProfileId,
            command.requestedByOperatorId,
            displayName,
            email,
            command.correlationId,
            command.idempotencyKey,
            command.now,
          ],
        );
        if (!result.rows[0]) throw new DatabaseUnavailableError();
        await client.query("COMMIT");
        client.release();
        client = undefined;
        return Object.freeze({ assignment: assignment(result.rows[0]), idempotentReplay: false });
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        client?.release();
        client = undefined;
        databaseError(error);
      }
    },
    claimNext: async (command) => {
      validateDate(command.now);
      if (
        !/^[A-Za-z0-9._:-]{1,128}$/u.test(command.workerId) ||
        !Number.isInteger(command.leaseDurationSeconds) ||
        command.leaseDurationSeconds < 1 ||
        command.leaseDurationSeconds > 300
      ) {
        throw new ProfileOperatorValidationError();
      }
      try {
        const result = (await pool.query(
          `WITH candidate AS (SELECT id FROM platform_iam.profile_operator_assignments WHERE status='pending' AND (lease_expires_at IS NULL OR lease_expires_at <= $3) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE platform_iam.profile_operator_assignments assignment SET lease_owner=$1,lease_expires_at=$3 + ($2::integer * INTERVAL '1 second'),version=assignment.version+1,updated_at=$3 FROM candidate WHERE assignment.id=candidate.id RETURNING assignment.${selection.replaceAll(", ", ", assignment.")}`,
          [command.workerId, command.leaseDurationSeconds, command.now],
        )) as { readonly rows: readonly AssignmentRow[] };
        return result.rows[0] ? assignment(result.rows[0]) : null;
      } catch (error) {
        databaseError(error);
      }
    },
    complete: async (command) => {
      validateDate(command.now);
      if (!uuidPattern.test(command.assignmentId) || !uuidPattern.test(command.oidcSubject)) {
        throw new ProfileOperatorValidationError();
      }
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const current = await client.query<AssignmentRow>(
          `SELECT ${selection} FROM platform_iam.profile_operator_assignments WHERE id=$1::uuid AND status='pending' AND lease_owner=$2 AND version=$3 AND lease_expires_at > $4 FOR UPDATE`,
          [command.assignmentId, command.workerId, command.expectedVersion.toString(), command.now],
        );
        if (!current.rows[0]) {
          await client.query("COMMIT");
          client.release();
          client = undefined;
          return null;
        }
        const membership = await client.query<{ readonly id: string }>(
          "INSERT INTO platform_iam.operator_memberships (oidc_subject,status) VALUES ($1,'active') ON CONFLICT (oidc_subject) DO UPDATE SET status='active',authorization_revision=platform_iam.operator_memberships.authorization_revision + CASE WHEN platform_iam.operator_memberships.status='active' THEN 0 ELSE 1 END,updated_at=$2 RETURNING id::text",
          [command.oidcSubject, command.now],
        );
        const operatorId = membership.rows[0]?.id;
        if (!operatorId) throw new DatabaseUnavailableError();
        await client.query(
          `INSERT INTO platform_iam.operator_permissions (operator_id,permission) SELECT $1::uuid,permission::platform_iam.platform_permission FROM unnest(ARRAY['tenants:read','tenants:manage','configuration:read','configuration:manage','deployments:read','deployments:execute','deployments:activate','operators:manage']) permission ON CONFLICT DO NOTHING`,
          [operatorId],
        );
        const result = await client.query<AssignmentRow>(
          `UPDATE platform_iam.profile_operator_assignments SET operator_id=$2::uuid,oidc_subject=$3,status='active',lease_owner=NULL,lease_expires_at=NULL,version=version+1,updated_at=$4 WHERE id=$1::uuid RETURNING ${selection}`,
          [command.assignmentId, operatorId, command.oidcSubject, command.now],
        );
        if (!result.rows[0]) throw new DatabaseUnavailableError();
        await client.query("COMMIT");
        client.release();
        client = undefined;
        return assignment(result.rows[0]);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        client?.release();
        client = undefined;
        databaseError(error);
      }
    },
    fail: async (command) => {
      validateDate(command.now);
      try {
        const result = (await pool.query(
          `UPDATE platform_iam.profile_operator_assignments SET status='failed',lease_owner=NULL,lease_expires_at=NULL,version=version+1,updated_at=$4 WHERE id=$1::uuid AND status='pending' AND lease_owner=$2 AND version=$3 RETURNING ${selection}`,
          [command.assignmentId, command.workerId, command.expectedVersion.toString(), command.now],
        )) as { readonly rows: readonly AssignmentRow[] };
        return result.rows[0] ? assignment(result.rows[0]) : null;
      } catch (error) {
        databaseError(error);
      }
    },
  });
}
