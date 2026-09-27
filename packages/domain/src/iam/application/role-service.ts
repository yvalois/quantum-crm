import { randomUUID } from "node:crypto";

import {
  createCustomRole,
  IamMemberValidationError,
  updateCustomRole,
  type IamPermission,
  type IamRole,
} from "../domain/member.js";
import { IamAuthorizationError, type IamActor } from "./member-service.js";
import type { IamRoleRepository } from "./role-repository.js";

export class IamRoleNotFoundError extends Error {
  public constructor() {
    super("IAM role was not found");
    this.name = "IamRoleNotFoundError";
  }
}

export class IamRoleConflictError extends Error {
  public constructor() {
    super("IAM role conflicts with current state");
    this.name = "IamRoleConflictError";
  }
}

function requireRolePermission(actor: IamActor): void {
  if (!actor.permissions.includes("iam:members:roles")) {
    throw new IamAuthorizationError();
  }
}

export class IamRoleService {
  public constructor(
    private readonly repository: IamRoleRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async list(actor: IamActor): Promise<readonly IamRole[]> {
    requireRolePermission(actor);
    return this.repository.list();
  }

  public async create(input: {
    readonly actor: IamActor;
    readonly displayName: string;
    readonly permissions: readonly IamPermission[];
  }): Promise<IamRole> {
    requireRolePermission(input.actor);
    const code = `CUSTOM_${randomUUID().replaceAll("-", "").toUpperCase()}` as const;
    return this.repository.create(
      createCustomRole({
        id: randomUUID(),
        code,
        displayName: input.displayName,
        permissions: input.permissions,
        now: this.clock(),
      }),
    );
  }

  public async update(input: {
    readonly actor: IamActor;
    readonly roleId: string;
    readonly displayName?: string;
    readonly permissions?: readonly IamPermission[];
  }): Promise<IamRole> {
    requireRolePermission(input.actor);
    const current = await this.repository.findById(input.roleId);
    if (!current) throw new IamRoleNotFoundError();
    try {
      const updated = await this.repository.update(
        updateCustomRole({
          role: current,
          ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
          ...(input.permissions === undefined ? {} : { permissions: input.permissions }),
          now: this.clock(),
        }),
      );
      if (!updated) throw new IamRoleNotFoundError();
      return updated;
    } catch (error) {
      if (error instanceof IamMemberValidationError) throw error;
      throw error;
    }
  }
}
