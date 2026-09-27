import type { CommercialActor } from "../iam/index.js";

export type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "EXPIRED";
export type MutableTaskStatus = Exclude<TaskStatus, "EXPIRED">;
export interface TaskRecord {
  readonly id: string;
  readonly createdByMemberId: string;
  readonly contactId: string | null;
  readonly opportunityId: string | null;
  readonly assigneeMemberId: string;
  readonly title: string;
  readonly description: string;
  readonly priority: "LOW" | "MEDIUM" | "HIGH";
  readonly dueAt: Date | null;
  readonly status: TaskStatus;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export interface TaskReferenceLookup {
  readonly contactExistsFor: (actor: CommercialActor, contactId: string) => Promise<boolean>;
  readonly opportunityExistsFor: (
    actor: CommercialActor,
    opportunityId: string,
  ) => Promise<boolean>;
  readonly isActiveMember: (memberId: string) => Promise<boolean>;
  readonly activeAssignees: () => Promise<readonly TaskAssignee[]>;
}
export interface TaskAssignee {
  readonly id: string;
  readonly displayName: string;
}
export interface TaskRepository {
  readonly list: (actor: CommercialActor) => Promise<readonly TaskRecord[]>;
  readonly find: (actor: CommercialActor, id: string) => Promise<TaskRecord | null>;
  readonly create: (input: {
    readonly task: TaskRecord;
    readonly actor: CommercialActor;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<TaskRecord>;
  readonly updateStatus: (input: {
    readonly actor: CommercialActor;
    readonly id: string;
    readonly status: MutableTaskStatus;
    readonly expectedVersion: bigint;
    readonly now: Date;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<TaskRecord | null>;
}
export class TaskValidationError extends Error {
  public constructor() {
    super("Invalid task state");
    this.name = "TaskValidationError";
  }
}
export class TaskVersionConflictError extends Error {
  public constructor() {
    super("Task has changed");
    this.name = "TaskVersionConflictError";
  }
}
export function deriveTaskStatus(task: TaskRecord, now: Date): TaskRecord {
  if (Number.isNaN(now.getTime())) throw new TaskValidationError();
  return (task.status === "PENDING" || task.status === "IN_PROGRESS") &&
    task.dueAt !== null &&
    task.dueAt <= now
    ? Object.freeze({ ...task, status: "EXPIRED" })
    : task;
}
export function transitionTask(
  task: TaskRecord,
  status: MutableTaskStatus,
  now: Date,
): TaskRecord & { readonly status: MutableTaskStatus } {
  if (
    task.status === "COMPLETED" ||
    task.status === "CANCELLED" ||
    task.status === "EXPIRED" ||
    Number.isNaN(now.getTime())
  )
    throw new TaskValidationError();
  return Object.freeze({ ...task, status, version: task.version + 1n, updatedAt: now });
}
export { TaskService, TaskNotFoundError } from "./task-service.js";
