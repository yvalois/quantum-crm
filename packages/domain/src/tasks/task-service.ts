import { randomUUID } from "node:crypto";

import { IamAuthorizationError, type CommercialActor, type IamPermission } from "../iam/index.js";
import {
  deriveTaskStatus,
  type MutableTaskStatus,
  type TaskRecord,
  type TaskReferenceLookup,
  type TaskRepository,
  TaskVersionConflictError,
  transitionTask,
} from "./index.js";

export class TaskNotFoundError extends Error {
  public constructor() {
    super("Task not found");
    this.name = "TaskNotFoundError";
  }
}
function allow(permissions: readonly IamPermission[], permission: IamPermission): void {
  if (!permissions.includes(permission)) throw new IamAuthorizationError();
}

export class TaskService {
  public constructor(
    private readonly repository: TaskRepository,
    private readonly references: TaskReferenceLookup,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  public async list(actor: CommercialActor, permissions: readonly IamPermission[]) {
    allow(permissions, "crm:tasks:read");
    const now = this.clock();
    return (await this.repository.list(actor)).map((task) => deriveTaskStatus(task, now));
  }
  public async listActiveAssignees(permissions: readonly IamPermission[]) {
    allow(permissions, "crm:tasks:read");
    return this.references.activeAssignees();
  }
  public async create(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly contactId?: string;
    readonly opportunityId?: string;
    readonly assigneeMemberId: string;
    readonly title: string;
    readonly description: string;
    readonly priority: TaskRecord["priority"];
    readonly dueAt: Date;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:tasks:create");
    if (
      (input.contactId === undefined) === (input.opportunityId === undefined) ||
      !(await this.references.isActiveMember(input.assigneeMemberId))
    )
      throw new TaskNotFoundError();
    if (input.contactId && !(await this.references.contactExistsFor(input.actor, input.contactId)))
      throw new TaskNotFoundError();
    if (
      input.opportunityId &&
      !(await this.references.opportunityExistsFor(input.actor, input.opportunityId))
    )
      throw new TaskNotFoundError();
    const now = this.clock();
    if (Number.isNaN(input.dueAt.getTime())) throw new TaskNotFoundError();
    return this.repository.create({
      task: Object.freeze({
        id: randomUUID(),
        createdByMemberId: input.actor.memberId,
        contactId: input.contactId ?? null,
        opportunityId: input.opportunityId ?? null,
        assigneeMemberId: input.assigneeMemberId,
        title: input.title.trim(),
        description: input.description.trim(),
        priority: input.priority,
        dueAt: input.dueAt,
        status: "PENDING",
        version: 1n,
        createdAt: now,
        updatedAt: now,
      }),
      actor: input.actor,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
  }
  public async updateStatus(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly id: string;
    readonly status: MutableTaskStatus;
    readonly expectedVersion: bigint;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:tasks:update");
    const current = await this.repository.find(input.actor, input.id);
    if (!current) throw new TaskNotFoundError();
    const visible = deriveTaskStatus(current, this.clock());
    if (visible.version !== input.expectedVersion) throw new TaskVersionConflictError();
    const result = await this.repository.updateStatus({
      actor: input.actor,
      id: input.id,
      status: transitionTask(visible, input.status, this.clock()).status,
      expectedVersion: input.expectedVersion,
      now: this.clock(),
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
    if (!result) throw new TaskVersionConflictError();
    return result;
  }
}
