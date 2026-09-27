import type { DatabaseConfig } from "@quantum-crm/config";
import type {
  IamInvitationActivation,
  IamInvitationActivationRepository,
  IamInvitation,
  IamMember,
  IamMemberPage,
  IamMemberRepository,
  IamRoleRepository,
  IamRole,
} from "@quantum-crm/domain";
import type { PoolClient } from "pg";

import {
  createPostgresDatabaseFromPool,
  createPostgresPool,
  DatabaseUnavailableError,
  type PostgresDatabase,
  type PostgresPool,
  type PostgresPoolFactory,
} from "./postgres-database.js";
import {
  createCommercialPostgresRepositories,
  type CommercialPostgresRepositories,
} from "./commercial-postgres-database.js";

export interface CrmPostgresDatabase extends PostgresDatabase {
  readonly members: IamMemberRepository;
  readonly roles: IamRoleRepository;
  readonly invitationActivations: IamInvitationActivationRepository;
  readonly memberships: CrmMembershipRepository;
  readonly commercial: CommercialPostgresRepositories;
}

export interface CrmMembershipAuthorization {
  readonly id: string;
  readonly oidcSubject: string;
  readonly status: "INVITED" | "ACTIVE" | "DEACTIVATED";
  readonly permissions: readonly string[];
  readonly authorizationRevision: bigint;
  readonly commercialScope: "PROFILE" | "OWN";
}

export interface CrmMembershipRepository {
  findAuthorizationByOidcSubject(oidcSubject: string): Promise<CrmMembershipAuthorization | null>;
}

export class IamMemberConflictError extends Error {
  public constructor() {
    super("IAM member operation conflicts with current state");
    this.name = "IamMemberConflictError";
  }
}

interface IamMemberRow {
  readonly id: string;
  readonly oidc_subject: string | null;
  readonly display_name: string;
  readonly email: string;
  readonly status: string;
  readonly authorization_revision: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly deactivated_at: Date | null;
}

interface IamInvitationRow {
  readonly id: string;
  readonly member_id: string;
  readonly status: string;
  readonly expires_at: Date;
  readonly accepted_at: Date | null;
  readonly created_at: Date;
  readonly activation_subject?: string | null;
  readonly activation_generation?: number;
  readonly activation_issued_at?: Date | null;
  readonly activation_expires_at?: Date | null;
}

interface IamRoleRow {
  readonly id: string;
  readonly code: string;
  readonly display_name: string;
  readonly system: boolean;
  readonly authorization_revision: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly permissions: readonly string[];
}

const memberSelection = `
  id::text,
  oidc_subject,
  display_name,
  email::text,
  status::text,
  authorization_revision::text,
  created_at,
  updated_at,
  deactivated_at
`;

const roleSelection = `
  role.id::text,
  role.code,
  role.display_name,
  role.system,
  role.authorization_revision::text,
  role.created_at,
  role.updated_at,
  COALESCE(
    array_agg(permission.permission ORDER BY permission.permission)
      FILTER (WHERE permission.permission IS NOT NULL),
    ARRAY[]::text[]
  ) AS permissions
`;

function memberStatus(value: string): IamMember["status"] {
  const status = value.toUpperCase();
  if (status === "INVITED" || status === "ACTIVE" || status === "DEACTIVATED") return status;
  throw new DatabaseUnavailableError();
}

function invitationStatus(value: string): IamInvitation["status"] {
  const status = value.toUpperCase();
  if (
    status === "PENDING" ||
    status === "ACCEPTED" ||
    status === "REVOKED" ||
    status === "EXPIRED"
  ) {
    return status;
  }
  throw new DatabaseUnavailableError();
}

function memberFromRow(row: IamMemberRow): IamMember {
  return Object.freeze({
    id: row.id,
    oidcSubject: row.oidc_subject,
    displayName: row.display_name,
    email: row.email,
    status: memberStatus(row.status),
    authorizationRevision: BigInt(row.authorization_revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deactivatedAt: row.deactivated_at,
  });
}

function roleFromRow(row: IamRoleRow): IamRole {
  if (!/^CUSTOM_[A-Z0-9_]{1,71}$|^(ADMINISTRATOR|SUPERVISOR|ADVISOR)$/u.test(row.code)) {
    throw new DatabaseUnavailableError();
  }
  return Object.freeze({
    id: row.id,
    code: row.code as IamRole["code"],
    displayName: row.display_name,
    system: row.system,
    authorizationRevision: BigInt(row.authorization_revision),
    permissions: Object.freeze([...row.permissions] as IamRole["permissions"]),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function invitationFromRow(row: IamInvitationRow): IamInvitation {
  return Object.freeze({
    id: row.id,
    memberId: row.member_id,
    status: invitationStatus(row.status),
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
  });
}

function invitationActivationFromRow(row: IamInvitationRow): IamInvitationActivation {
  const generation = row.activation_generation;
  if (
    !row.activation_subject ||
    typeof generation !== "number" ||
    !Number.isInteger(generation) ||
    generation < 1 ||
    !row.activation_issued_at ||
    !row.activation_expires_at
  ) {
    throw new DatabaseUnavailableError();
  }
  return Object.freeze({
    invitationId: row.id,
    oidcSubject: row.activation_subject,
    generation,
    issuedAt: row.activation_issued_at,
    expiresAt: row.activation_expires_at,
  });
}

function encodeCursor(member: IamMember): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: member.createdAt.toISOString(),
      id: member.id,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(value: string): {
  readonly createdAt: Date;
  readonly id: string;
} {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as { readonly createdAt?: unknown }).createdAt !== "string" ||
      typeof (parsed as { readonly id?: unknown }).id !== "string"
    ) {
      throw new Error("Invalid cursor");
    }
    const createdAt = new Date((parsed as { readonly createdAt: string }).createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error("Invalid cursor");
    return Object.freeze({
      createdAt,
      id: (parsed as { readonly id: string }).id,
    });
  } catch {
    throw new IamMemberConflictError();
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { readonly code?: unknown }).code === "23505";
}

function validInvitationActivationInput(
  input: Parameters<IamInvitationActivationRepository["recordIssued"]>[0],
): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      input.invitationId,
    ) &&
    /^[!-~]{1,255}$/u.test(input.oidcSubject) &&
    Number.isInteger(input.generation) &&
    input.generation > 0 &&
    input.expiresAt instanceof Date &&
    !Number.isNaN(input.expiresAt.getTime()) &&
    input.now instanceof Date &&
    !Number.isNaN(input.now.getTime())
  );
}

function createIamMemberRepository(pool: PostgresPool): IamMemberRepository {
  return Object.freeze<IamMemberRepository>({
    list: async ({
      cursor,
      limit,
      status,
    }: Parameters<IamMemberRepository["list"]>[0]): Promise<IamMemberPage> => {
      const after = cursor ? decodeCursor(cursor) : undefined;
      try {
        const result = (await pool.query(
          `
            SELECT ${memberSelection}
            FROM iam.members
            WHERE ($1::text IS NULL OR status::text = lower($1::text))
              AND ($2::timestamptz IS NULL OR (created_at, id) > ($2::timestamptz, $3::uuid))
            ORDER BY created_at ASC, id ASC
            LIMIT $4
          `,
          [status ?? null, after?.createdAt ?? null, after?.id ?? null, limit + 1],
        )) as { readonly rows: readonly IamMemberRow[] };
        const rows = result.rows.slice(0, limit).map(memberFromRow);
        const overflow = result.rows[limit];
        return Object.freeze({
          members: Object.freeze(rows),
          nextCursor: overflow && rows.length > 0 ? encodeCursor(rows[rows.length - 1]!) : null,
        });
      } catch (error) {
        if (error instanceof IamMemberConflictError) throw error;
        throw new DatabaseUnavailableError();
      }
    },
    findById: async (memberId: string): Promise<IamMember | null> => {
      try {
        const result = (await pool.query(
          `SELECT ${memberSelection} FROM iam.members WHERE id = $1::uuid`,
          [memberId],
        )) as { readonly rows: readonly IamMemberRow[] };
        const row = result.rows[0];
        return row ? memberFromRow(row) : null;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    findByOidcSubject: async (oidcSubject: string): Promise<IamMember | null> => {
      try {
        const result = (await pool.query(
          `SELECT ${memberSelection} FROM iam.members WHERE oidc_subject = $1`,
          [oidcSubject],
        )) as { readonly rows: readonly IamMemberRow[] };
        const row = result.rows[0];
        return row ? memberFromRow(row) : null;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    createInvitation: async (input: Parameters<IamMemberRepository["createInvitation"]>[0]) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const existing = (await client.query(
          `
            SELECT
              member.id::text, member.oidc_subject, member.display_name, member.email::text,
              member.status::text, member.authorization_revision::text, member.created_at,
              member.updated_at, member.deactivated_at,
              invitation.id::text AS invitation_id, invitation.member_id::text,
              invitation.status::text AS invitation_status, invitation.expires_at,
              invitation.accepted_at, invitation.created_at AS invitation_created_at
            FROM iam.invitations AS invitation
            JOIN iam.members AS member ON member.id = invitation.member_id
            WHERE invitation.created_by_member_id = $1::uuid AND invitation.idempotency_key = $2
            FOR UPDATE
          `,
          [input.createdByMemberId, input.idempotencyKey],
        )) as {
          readonly rows: readonly (IamMemberRow & {
            readonly invitation_id: string;
            readonly member_id: string;
            readonly invitation_status: string;
            readonly expires_at: Date;
            readonly accepted_at: Date | null;
            readonly invitation_created_at: Date;
          })[];
        };
        const previous = existing.rows[0];
        if (previous) {
          await client.query("COMMIT");
          return Object.freeze({
            member: memberFromRow(previous),
            invitation: invitationFromRow({
              id: previous.invitation_id,
              member_id: previous.member_id,
              status: previous.invitation_status,
              expires_at: previous.expires_at,
              accepted_at: previous.accepted_at,
              created_at: previous.invitation_created_at,
            }),
            replayed: true,
          });
        }
        await client.query(
          `
            INSERT INTO iam.members (
              id, display_name, email, status, authorization_revision, created_at, updated_at
            ) VALUES ($1::uuid, $2, $3, 'invited', $4::bigint, $5, $5)
          `,
          [
            input.member.id,
            input.member.displayName,
            input.member.email,
            input.member.authorizationRevision.toString(),
            input.member.createdAt,
          ],
        );
        const roleAssignment = (await client.query(
          `
            INSERT INTO iam.member_roles (member_id, role_id)
            SELECT $1::uuid, role.id
            FROM iam.roles AS role
            WHERE role.code = $2
          `,
          [input.member.id, input.roleCode],
        )) as { readonly rowCount: number | null };
        if (roleAssignment.rowCount !== 1) throw new IamMemberConflictError();
        const invitationInsert = (await client.query(
          `
            INSERT INTO iam.invitations (
              id, member_id, created_by_member_id, role_id, token_hash, idempotency_key,
              status, expires_at, created_at
            ) SELECT $1::uuid, $2::uuid, $3::uuid, role.id, $4, $5, 'pending', $6, $7
              FROM iam.roles AS role WHERE role.code = $8
          `,
          [
            input.invitation.id,
            input.member.id,
            input.createdByMemberId,
            input.invitationTokenHash,
            input.idempotencyKey,
            input.invitation.expiresAt,
            input.invitation.createdAt,
            input.roleCode,
          ],
        )) as { readonly rowCount: number | null };
        if (invitationInsert.rowCount !== 1) throw new IamMemberConflictError();
        await client.query("COMMIT");
        return Object.freeze({
          member: input.member,
          invitation: input.invitation,
          replayed: false,
        });
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        if (isUniqueViolation(error)) throw new IamMemberConflictError();
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    update: async (member: IamMember): Promise<IamMember> => {
      try {
        const result = (await pool.query(
          `
            UPDATE iam.members
            SET display_name = $2, email = $3, status = $4::iam.member_status,
                authorization_revision = $5::bigint, updated_at = $6, deactivated_at = $7
            WHERE id = $1::uuid
            RETURNING ${memberSelection}
          `,
          [
            member.id,
            member.displayName,
            member.email,
            member.status.toLowerCase(),
            member.authorizationRevision.toString(),
            member.updatedAt,
            member.deactivatedAt,
          ],
        )) as { readonly rows: readonly IamMemberRow[] };
        const row = result.rows[0];
        if (!row) throw new IamMemberConflictError();
        return memberFromRow(row);
      } catch (error) {
        if (error instanceof IamMemberConflictError || isUniqueViolation(error)) {
          throw new IamMemberConflictError();
        }
        throw new DatabaseUnavailableError();
      }
    },
    assignRole: async (input): Promise<IamMember | null> => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const current = (await client.query(
          `SELECT ${memberSelection} FROM iam.members WHERE id = $1::uuid FOR UPDATE`,
          [input.memberId],
        )) as { readonly rows: readonly IamMemberRow[] };
        if (!current.rows[0]) {
          await client.query("ROLLBACK");
          return null;
        }
        const role = await client.query(`SELECT id FROM iam.roles WHERE code = $1`, [
          input.roleCode,
        ]);
        if (role.rowCount !== 1) throw new IamMemberConflictError();
        await client.query(`DELETE FROM iam.member_roles WHERE member_id = $1::uuid`, [
          input.memberId,
        ]);
        await client.query(
          `INSERT INTO iam.member_roles (member_id, role_id) VALUES ($1::uuid, $2::uuid)`,
          [input.memberId, (role.rows[0] as { readonly id: string }).id],
        );
        const updated = (await client.query(
          `
            UPDATE iam.members
            SET authorization_revision = authorization_revision + 1, updated_at = $2
            WHERE id = $1::uuid
            RETURNING ${memberSelection}
          `,
          [input.memberId, input.now],
        )) as { readonly rows: readonly IamMemberRow[] };
        const row = updated.rows[0];
        if (!row) throw new IamMemberConflictError();
        await client.query("COMMIT");
        return memberFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        if (error instanceof IamMemberConflictError || isUniqueViolation(error)) {
          throw new IamMemberConflictError();
        }
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    acceptInvitation: async (
      input: Parameters<IamMemberRepository["acceptInvitation"]>[0],
    ): Promise<IamMember | null> => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const found = (await client.query(
          `
            SELECT invitation.id::text, invitation.member_id::text, invitation.status::text,
                   invitation.expires_at, invitation.accepted_at, invitation.created_at
            FROM iam.invitations AS invitation
            WHERE invitation.id = $1::uuid
            FOR UPDATE
          `,
          [input.invitationId],
        )) as { readonly rows: readonly IamInvitationRow[] };
        const invitation = found.rows[0];
        if (!invitation || invitationStatus(invitation.status) !== "PENDING") {
          await client.query("ROLLBACK");
          return null;
        }
        if (invitation.expires_at <= input.now) {
          await client.query(`UPDATE iam.invitations SET status = 'expired' WHERE id = $1::uuid`, [
            input.invitationId,
          ]);
          await client.query("COMMIT");
          return null;
        }
        const memberUpdate = (await client.query(
          `
            UPDATE iam.members
            SET oidc_subject = $2, status = 'active',
                authorization_revision = authorization_revision + 1,
                updated_at = $3
            WHERE id = $1::uuid AND status = 'invited' AND oidc_subject IS NULL
            RETURNING ${memberSelection}
          `,
          [invitation.member_id, input.oidcSubject, input.now],
        )) as { readonly rows: readonly IamMemberRow[] };
        const member = memberUpdate.rows[0];
        if (!member) throw new IamMemberConflictError();
        await client.query(
          `UPDATE iam.invitations SET status = 'accepted', accepted_at = $2 WHERE id = $1::uuid`,
          [invitation.id, input.now],
        );
        await client.query("COMMIT");
        return memberFromRow(member);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        if (error instanceof IamMemberConflictError || isUniqueViolation(error)) {
          throw new IamMemberConflictError();
        }
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    bootstrapInitialAdministrator: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const existing = (await client.query(
          `SELECT member.id::text, member.oidc_subject, member.display_name, member.email::text,
                  member.status::text, member.authorization_revision::text, member.created_at,
                  member.updated_at, member.deactivated_at, bootstrap.idempotency_key
             FROM iam.bootstrap_initial_administrator AS bootstrap
             JOIN iam.members AS member ON member.id = bootstrap.member_id
            WHERE bootstrap.singleton = true FOR UPDATE`,
        )) as { readonly rows: readonly (IamMemberRow & { readonly idempotency_key: string })[] };
        const prior = existing.rows[0];
        if (prior) {
          if (prior.oidc_subject !== input.member.oidcSubject) throw new IamMemberConflictError();
          await client.query("COMMIT");
          return Object.freeze({ member: memberFromRow(prior), replayed: true });
        }
        const preexisting = await client.query(`SELECT id FROM iam.members LIMIT 1 FOR UPDATE`);
        if ((preexisting.rowCount ?? 0) !== 0) throw new IamMemberConflictError();
        const inserted = (await client.query(
          `INSERT INTO iam.members (id, oidc_subject, display_name, email, status, authorization_revision, created_at, updated_at)
           VALUES ($1::uuid, $2, $3, $4, 'active', $5::bigint, $6, $6)
           RETURNING ${memberSelection}`,
          [
            input.member.id,
            input.member.oidcSubject,
            input.member.displayName,
            input.member.email,
            input.member.authorizationRevision.toString(),
            input.member.createdAt,
          ],
        )) as { readonly rows: readonly IamMemberRow[] };
        const member = inserted.rows[0];
        if (!member) throw new IamMemberConflictError();
        const role = await client.query(
          `INSERT INTO iam.member_roles (member_id, role_id)
             SELECT $1::uuid, id FROM iam.roles WHERE code = 'ADMINISTRATOR'`,
          [input.member.id],
        );
        if (role.rowCount !== 1) throw new IamMemberConflictError();
        await client.query(
          `INSERT INTO iam.bootstrap_initial_administrator (singleton, member_id, oidc_subject, idempotency_key, created_at)
           VALUES (true, $1::uuid, $2, $3, $4)`,
          [input.member.id, input.member.oidcSubject, input.idempotencyKey, input.member.createdAt],
        );
        await client.query("COMMIT");
        return Object.freeze({ member: memberFromRow(member), replayed: false });
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        if (error instanceof IamMemberConflictError || isUniqueViolation(error))
          throw new IamMemberConflictError();
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
  });
}

function createIamRoleRepository(pool: PostgresPool): IamRoleRepository {
  return Object.freeze({
    list: async (): Promise<readonly IamRole[]> => {
      try {
        const result = (await pool.query(
          `SELECT ${roleSelection}
             FROM iam.roles AS role
             LEFT JOIN iam.role_permissions AS permission ON permission.role_id = role.id
            GROUP BY role.id
            ORDER BY role.system DESC, role.display_name ASC, role.id ASC`,
        )) as { readonly rows: readonly IamRoleRow[] };
        return Object.freeze(result.rows.map(roleFromRow));
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    findById: async (roleId: string): Promise<IamRole | null> => {
      try {
        const result = (await pool.query(
          `SELECT ${roleSelection}
             FROM iam.roles AS role
             LEFT JOIN iam.role_permissions AS permission ON permission.role_id = role.id
            WHERE role.id = $1::uuid
            GROUP BY role.id`,
          [roleId],
        )) as { readonly rows: readonly IamRoleRow[] };
        return result.rows[0] ? roleFromRow(result.rows[0]) : null;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    create: async (role: IamRole): Promise<IamRole> => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO iam.roles (id, code, display_name, system, authorization_revision, created_at, updated_at)
           VALUES ($1::uuid, $2, $3, false, $4::bigint, $5, $5)`,
          [role.id, role.code, role.displayName, role.authorizationRevision.toString(), role.createdAt],
        );
        for (const permission of role.permissions) {
          await client.query(
            `INSERT INTO iam.role_permissions (role_id, permission) VALUES ($1::uuid, $2)`,
            [role.id, permission],
          );
        }
        await client.query("COMMIT");
        return role;
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        if (isUniqueViolation(error)) throw new IamMemberConflictError();
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
    update: async (role: IamRole): Promise<IamRole | null> => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const current = (await client.query(
          `SELECT id::text, system FROM iam.roles WHERE id = $1::uuid FOR UPDATE`,
          [role.id],
        )) as { readonly rows: readonly { readonly id: string; readonly system: boolean }[] };
        if (!current.rows[0]) {
          await client.query("ROLLBACK");
          return null;
        }
        if (current.rows[0].system) throw new IamMemberConflictError();
        const updated = (await client.query(
          `UPDATE iam.roles
              SET display_name = $2, authorization_revision = $3::bigint, updated_at = $4
            WHERE id = $1::uuid AND system = false AND authorization_revision < $3::bigint
            RETURNING id::text`,
          [role.id, role.displayName, role.authorizationRevision.toString(), role.updatedAt],
        )) as { readonly rowCount: number | null };
        if (updated.rowCount !== 1) throw new IamMemberConflictError();
        await client.query(`DELETE FROM iam.role_permissions WHERE role_id = $1::uuid`, [role.id]);
        for (const permission of role.permissions) {
          await client.query(
            `INSERT INTO iam.role_permissions (role_id, permission) VALUES ($1::uuid, $2)`,
            [role.id, permission],
          );
        }
        await client.query(
          `UPDATE iam.members
              SET authorization_revision = authorization_revision + 1, updated_at = $2
            WHERE id IN (SELECT member_id FROM iam.member_roles WHERE role_id = $1::uuid)`,
          [role.id, role.updatedAt],
        );
        await client.query("COMMIT");
        return role;
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        if (error instanceof IamMemberConflictError || isUniqueViolation(error)) {
          throw new IamMemberConflictError();
        }
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
  });
}

function createIamInvitationActivationRepository(
  pool: PostgresPool,
): IamInvitationActivationRepository {
  return Object.freeze<IamInvitationActivationRepository>({
    recordIssued: async (input) => {
      if (!validInvitationActivationInput(input)) throw new IamMemberConflictError();
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        const found = (await client.query(
          `
            SELECT invitation.id::text, invitation.member_id::text, invitation.status::text,
                   invitation.expires_at, invitation.accepted_at, invitation.created_at,
                   invitation.activation_subject, invitation.activation_generation,
                   invitation.activation_issued_at, invitation.activation_expires_at
            FROM iam.invitations AS invitation
            WHERE invitation.id = $1::uuid
            FOR UPDATE
          `,
          [input.invitationId],
        )) as { readonly rows: readonly IamInvitationRow[] };
        const invitation = found.rows[0];
        if (!invitation || invitationStatus(invitation.status) !== "PENDING") {
          await client.query("ROLLBACK");
          return null;
        }
        if (invitation.expires_at <= input.now) {
          await client.query(`UPDATE iam.invitations SET status = 'expired' WHERE id = $1::uuid`, [
            input.invitationId,
          ]);
          await client.query("COMMIT");
          return null;
        }
        if (input.expiresAt <= input.now || input.expiresAt > invitation.expires_at) {
          throw new IamMemberConflictError();
        }
        const currentGeneration = invitation.activation_generation ?? 0;
        if (currentGeneration === input.generation) {
          if (invitation.activation_subject !== input.oidcSubject) {
            throw new IamMemberConflictError();
          }
          await client.query("COMMIT");
          return Object.freeze({
            activation: invitationActivationFromRow(invitation),
            replayed: true,
          });
        }
        if (
          input.generation !== currentGeneration + 1 ||
          (invitation.activation_subject !== null &&
            invitation.activation_subject !== input.oidcSubject)
        ) {
          throw new IamMemberConflictError();
        }
        const recorded = (await client.query(
          `
            UPDATE iam.invitations
            SET activation_subject = $2, activation_generation = $3,
                activation_issued_at = $4, activation_expires_at = $5
            WHERE id = $1::uuid
            RETURNING id::text, member_id::text, status::text, expires_at, accepted_at, created_at,
                      activation_subject, activation_generation, activation_issued_at,
                      activation_expires_at
          `,
          [input.invitationId, input.oidcSubject, input.generation, input.now, input.expiresAt],
        )) as { readonly rows: readonly IamInvitationRow[] };
        const row = recorded.rows[0];
        if (!row) throw new IamMemberConflictError();
        await client.query("COMMIT");
        return Object.freeze({ activation: invitationActivationFromRow(row), replayed: false });
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        if (error instanceof IamMemberConflictError || isUniqueViolation(error)) {
          throw new IamMemberConflictError();
        }
        throw new DatabaseUnavailableError();
      } finally {
        client?.release();
      }
    },
  });
}

function createCrmMembershipRepository(pool: PostgresPool): CrmMembershipRepository {
  return Object.freeze({
    findAuthorizationByOidcSubject: async (
      oidcSubject: string,
    ): Promise<CrmMembershipAuthorization | null> => {
      try {
        const result = (await pool.query(
          `
            SELECT
              member.id::text,
              member.oidc_subject,
              member.status::text,
              member.authorization_revision::text,
              COALESCE(
                array_agg(permission.permission ORDER BY permission.permission)
                  FILTER (WHERE permission.permission IS NOT NULL),
                ARRAY[]::text[]
              ) AS permissions,
              CASE WHEN bool_or(role.code IN ('ADMINISTRATOR', 'SUPERVISOR'))
                THEN 'PROFILE' ELSE 'OWN' END AS commercial_scope
            FROM iam.members AS member
            LEFT JOIN iam.member_roles AS member_role ON member_role.member_id = member.id
            LEFT JOIN iam.roles AS role ON role.id = member_role.role_id
            LEFT JOIN iam.role_permissions AS permission ON permission.role_id = member_role.role_id
            WHERE member.oidc_subject = $1
            GROUP BY member.id
          `,
          [oidcSubject],
        )) as {
          readonly rows: readonly {
            readonly id: string;
            readonly oidc_subject: string;
            readonly status: string;
            readonly authorization_revision: string;
            readonly permissions: readonly string[];
            readonly commercial_scope: "PROFILE" | "OWN";
          }[];
        };
        const row = result.rows[0];
        if (!row) return null;
        return Object.freeze({
          id: row.id,
          oidcSubject: row.oidc_subject,
          status: memberStatus(row.status),
          permissions: Object.freeze([...row.permissions]),
          authorizationRevision: BigInt(row.authorization_revision),
          commercialScope: row.commercial_scope,
        });
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
  });
}

export function createCrmPostgresDatabase(
  config: DatabaseConfig,
  serviceName: string,
  poolFactory?: PostgresPoolFactory,
): CrmPostgresDatabase {
  if (config.target !== "crm" || !config.tenantId) throw new DatabaseUnavailableError();
  const pool = createPostgresPool(config, serviceName, poolFactory);
  return Object.freeze({
    ...createPostgresDatabaseFromPool(pool),
    members: createIamMemberRepository(pool),
    roles: createIamRoleRepository(pool),
    invitationActivations: createIamInvitationActivationRepository(pool),
    memberships: createCrmMembershipRepository(pool),
    commercial: createCommercialPostgresRepositories(pool),
  });
}
