import { randomUUID } from "node:crypto";

import {
  createIamTeam,
  IamTeamValidationError,
  type IamTeam,
} from "../domain/team.js";
import { IamAuthorizationError, type IamActor } from "./member-service.js";
import type { IamTeamRepository } from "./team-repository.js";

export class IamTeamNotFoundError extends Error {
  public constructor() {
    super("IAM team was not found");
    this.name = "IamTeamNotFoundError";
  }
}

export class IamTeamMemberNotFoundError extends Error {
  public constructor() {
    super("IAM team member was not found");
    this.name = "IamTeamMemberNotFoundError";
  }
}

export class IamTeamConflictError extends Error {
  public constructor() {
    super("IAM team conflicts with current state");
    this.name = "IamTeamConflictError";
  }
}

function requirePermission(actor: IamActor, permission: "iam:teams:read" | "iam:teams:create" | "iam:teams:update"): void {
  if (!actor.permissions.includes(permission)) throw new IamAuthorizationError();
}

function requireUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    throw new IamTeamValidationError();
  }
}

export class IamTeamService {
  public constructor(
    private readonly repository: IamTeamRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async list(actor: IamActor): Promise<readonly IamTeam[]> {
    requirePermission(actor, "iam:teams:read");
    return this.repository.list();
  }

  public async create(input: { readonly actor: IamActor; readonly name: string }): Promise<IamTeam> {
    requirePermission(input.actor, "iam:teams:create");
    const team = createIamTeam({ id: randomUUID(), name: input.name, now: this.clock() });
    const created = await this.repository.create(team);
    if (!created) throw new IamTeamConflictError();
    return created;
  }

  public async addMember(input: {
    readonly actor: IamActor;
    readonly teamId: string;
    readonly memberId: string;
  }): Promise<IamTeam> {
    requirePermission(input.actor, "iam:teams:update");
    requireUuid(input.teamId);
    requireUuid(input.memberId);
    const updated = await this.repository.addMember(input.teamId, input.memberId);
    if (!updated) throw new IamTeamMemberNotFoundError();
    return updated;
  }

  public async removeMember(input: {
    readonly actor: IamActor;
    readonly teamId: string;
    readonly memberId: string;
  }): Promise<IamTeam> {
    requirePermission(input.actor, "iam:teams:update");
    requireUuid(input.teamId);
    requireUuid(input.memberId);
    const updated = await this.repository.removeMember(input.teamId, input.memberId);
    if (!updated) throw new IamTeamNotFoundError();
    return updated;
  }
}
