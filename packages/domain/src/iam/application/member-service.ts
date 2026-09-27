import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  createInvitation,
  createBootstrapAdministrator,
  createInvitedMember,
  deactivateMember,
  IamMemberValidationError,
  isRoleCode,
  updateMemberProfile,
  type IamInvitation,
  type IamMember,
  type IamPermission,
  type RoleCode,
} from "../domain/member.js";
import type { IamMemberPage, IamMemberRepository } from "./member-repository.js";

const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const oidcSubjectPattern = /^[!-~]{1,255}$/u;
const commercialScopes = ["PROFILE", "TEAM", "ASSIGNED"] as const;
type ConfigurableCommercialScope = (typeof commercialScopes)[number];

export interface IamActor {
  readonly memberId: string;
  readonly permissions: readonly IamPermission[];
}

export class IamAuthorizationError extends Error {
  public constructor() {
    super("IAM operation is not permitted");
    this.name = "IamAuthorizationError";
  }
}

export class IamMemberNotFoundError extends Error {
  public constructor() {
    super("IAM member was not found");
    this.name = "IamMemberNotFoundError";
  }
}

export class IamInvitationAcceptanceError extends Error {
  public constructor() {
    super("IAM invitation cannot be accepted");
    this.name = "IamInvitationAcceptanceError";
  }
}

export class IamMemberRevisionConflictError extends Error {
  public constructor() {
    super("IAM member authorization revision has changed");
    this.name = "IamMemberRevisionConflictError";
  }
}

export interface ConfirmedInvitationAcceptance {
  readonly invitationId: string;
  readonly oidcSubject: string;
}

function requirePermission(actor: IamActor, permission: IamPermission): void {
  if (!actor.permissions.includes(permission)) throw new IamAuthorizationError();
}

function invitationTokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class IamMemberService {
  public constructor(
    private readonly repository: IamMemberRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async list(
    actor: IamActor,
    criteria: Parameters<IamMemberRepository["list"]>[0],
  ): Promise<IamMemberPage> {
    requirePermission(actor, "iam:members:read");
    return this.repository.list(criteria);
  }

  /** Narrow public query port for tasks. Authorization remains with the task
   * module; this deliberately does not grant the IAM member-directory read. */
  public async listActiveForTaskAssignment(): Promise<
    readonly Pick<IamMember, "id" | "displayName">[]
  > {
    const page = await this.repository.list({ limit: 100, status: "ACTIVE" });
    return Object.freeze(
      page.members.map((member) =>
        Object.freeze({ id: member.id, displayName: member.displayName }),
      ),
    );
  }

  public async invite(input: {
    readonly actor: IamActor;
    readonly displayName: string;
    readonly email: string;
    readonly roleCode: RoleCode;
    readonly idempotencyKey: string;
  }): Promise<{
    readonly member: IamMember;
    readonly invitation: IamInvitation;
    readonly invitationToken: string | null;
  }> {
    requirePermission(input.actor, "iam:members:create");
    if (!idempotencyKeyPattern.test(input.idempotencyKey)) throw new IamMemberValidationError();
    if (!isRoleCode(input.roleCode)) throw new IamMemberValidationError();
    const now = this.clock();
    const member = createInvitedMember({
      id: randomUUID(),
      displayName: input.displayName,
      email: input.email,
      now,
    });
    const invitation = createInvitation({
      id: randomUUID(),
      memberId: member.id,
      now,
      expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1_000),
    });
    const token = randomBytes(32).toString("base64url");
    const persisted = await this.repository.createInvitation({
      member,
      invitation,
      invitationTokenHash: invitationTokenHash(token),
      createdByMemberId: input.actor.memberId,
      idempotencyKey: input.idempotencyKey,
      roleCode: input.roleCode,
    });
    return Object.freeze({
      ...persisted,
      invitationToken: persisted.replayed ? null : token,
    });
  }

  public async updateProfile(input: {
    readonly actor: IamActor;
    readonly memberId: string;
    readonly displayName?: string;
    readonly email?: string;
    readonly roleCode?: RoleCode;
    readonly commercialScope?: ConfigurableCommercialScope;
    readonly expectedAuthorizationRevision?: bigint;
  }): Promise<IamMember> {
    requirePermission(input.actor, "iam:members:update");
    if (input.roleCode !== undefined && !isRoleCode(input.roleCode)) {
      throw new IamMemberValidationError();
    }
    if (input.commercialScope !== undefined && !commercialScopes.includes(input.commercialScope)) {
      throw new IamMemberValidationError();
    }
    if (input.roleCode !== undefined) requirePermission(input.actor, "iam:members:roles");
    if (input.commercialScope !== undefined) requirePermission(input.actor, "iam:members:roles");
    if (input.commercialScope !== undefined && input.actor.memberId === input.memberId) {
      throw new IamAuthorizationError();
    }
    if (
      input.commercialScope !== undefined &&
      (input.displayName !== undefined || input.email !== undefined || input.roleCode !== undefined)
    ) {
      throw new IamMemberValidationError();
    }
    const current = await this.repository.findById(input.memberId);
    if (!current) throw new IamMemberNotFoundError();
    let updated = current;
    if (input.commercialScope !== undefined) {
      if (!this.repository.updateCommercialScope) throw new IamMemberValidationError();
      if (
        input.expectedAuthorizationRevision === undefined ||
        input.expectedAuthorizationRevision !== current.authorizationRevision
      ) {
        throw new IamMemberRevisionConflictError();
      }
    }
    const expectedAuthorizationRevision = input.commercialScope
      ? input.expectedAuthorizationRevision
      : undefined;
    if (input.commercialScope !== undefined) {
      const scoped = await this.repository.updateCommercialScope({
        memberId: current.id,
        scope: input.commercialScope,
        now: this.clock(),
        expectedAuthorizationRevision: expectedAuthorizationRevision!,
      });
      if (!scoped) throw new IamMemberRevisionConflictError();
      updated = scoped;
    }
    if (input.displayName !== undefined || input.email !== undefined) {
      updated = await this.repository.update(
        updateMemberProfile({
          member: updated,
          ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
          ...(input.email === undefined ? {} : { email: input.email }),
          now: this.clock(),
        }),
        input.commercialScope === undefined ? undefined : updated.authorizationRevision,
      );
    }
    if (input.roleCode !== undefined) {
      const assigned = await this.repository.assignRole({
        memberId: updated.id,
        roleCode: input.roleCode,
        now: this.clock(),
      });
      if (!assigned) throw new IamMemberNotFoundError();
      updated = assigned;
    }
    return updated;
  }

  public async deactivate(input: {
    readonly actor: IamActor;
    readonly memberId: string;
  }): Promise<IamMember> {
    requirePermission(input.actor, "iam:members:deactivate");
    const current = await this.repository.findById(input.memberId);
    if (!current) throw new IamMemberNotFoundError();
    return this.repository.update(deactivateMember({ member: current, now: this.clock() }));
  }

  /**
   * Internal tenant-local command invoked only after Keycloak confirms the
   * signed, one-use activation action. Its deliberately narrow input prevents
   * callers from selecting a member, role, email or profile and never carries
   * the invitation token or its persistent hash outside issuance.
   */
  public async acceptConfirmedInvitation(input: ConfirmedInvitationAcceptance): Promise<IamMember> {
    if (!uuidPattern.test(input.invitationId) || !oidcSubjectPattern.test(input.oidcSubject)) {
      throw new IamMemberValidationError();
    }
    const member = await this.repository.acceptInvitation({
      invitationId: input.invitationId,
      oidcSubject: input.oidcSubject,
      now: this.clock(),
    });
    if (!member) throw new IamInvitationAcceptanceError();
    return member;
  }

  /** Internal, tenant-local command for ADR-0023. There is deliberately no actor,
   * role, email or tenant field: transport authentication establishes the service
   * principal and the database establishes the tenant. */
  public async bootstrapInitialAdministrator(input: {
    readonly oidcSubject: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly member: IamMember; readonly replayed: boolean }> {
    if (!idempotencyKeyPattern.test(input.idempotencyKey)) throw new IamMemberValidationError();
    const now = this.clock();
    return this.repository.bootstrapInitialAdministrator({
      member: createBootstrapAdministrator({
        id: randomUUID(),
        oidcSubject: input.oidcSubject,
        now,
      }),
      idempotencyKey: input.idempotencyKey,
    });
  }
}
