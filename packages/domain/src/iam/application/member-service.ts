import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  createInvitation,
  createInvitedMember,
  deactivateMember,
  IamMemberValidationError,
  updateMemberProfile,
  type IamInvitation,
  type IamMember,
  type IamPermission,
  type InitialRoleCode,
} from "../domain/member.js";
import type { IamMemberPage, IamMemberRepository } from "./member-repository.js";

const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;

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

  public async invite(input: {
    readonly actor: IamActor;
    readonly displayName: string;
    readonly email: string;
    readonly roleCode: InitialRoleCode;
    readonly idempotencyKey: string;
  }): Promise<{
    readonly member: IamMember;
    readonly invitation: IamInvitation;
    readonly invitationToken: string | null;
  }> {
    requirePermission(input.actor, "iam:members:create");
    if (!idempotencyKeyPattern.test(input.idempotencyKey)) throw new IamMemberValidationError();
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
  }): Promise<IamMember> {
    requirePermission(input.actor, "iam:members:update");
    const current = await this.repository.findById(input.memberId);
    if (!current) throw new IamMemberNotFoundError();
    return this.repository.update(
      updateMemberProfile({
        member: current,
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
        ...(input.email === undefined ? {} : { email: input.email }),
        now: this.clock(),
      }),
    );
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
}
