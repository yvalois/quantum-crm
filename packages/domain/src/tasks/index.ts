import type { CommercialActor } from "../iam/index.js";

export type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "EXPIRED";
export type MutableTaskStatus = Exclude<TaskStatus, "EXPIRED">;
export type TaskType = "CALL" | "MESSAGE" | "MEETING" | "QUOTE" | "COLLECTION" | "OTHER";
export type TaskOrigin = "MANUAL" | "AUTOMATION" | "AGENT";
export interface TaskRecord {
  readonly id: string;
  readonly createdByMemberId: string;
  readonly contactId: string | null;
  readonly opportunityId: string | null;
  readonly assigneeMemberId: string;
  readonly title: string;
  readonly description: string;
  readonly priority: "LOW" | "MEDIUM" | "HIGH";
  readonly type: TaskType;
  readonly origin: TaskOrigin;
  readonly dueAt: Date | null;
  readonly status: TaskStatus;
  readonly completedAt: Date | null;
  readonly completedByMemberId: string | null;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export interface TaskListFilters {
  readonly contactId?: string;
  readonly opportunityId?: string;
  readonly assigneeMemberId?: string;
  readonly status?: TaskStatus;
  readonly priority?: TaskRecord["priority"];
  readonly type?: TaskType;
  readonly dueFrom?: Date;
  readonly dueTo?: Date;
}
export interface TaskCommentRecord {
  readonly id: string;
  readonly taskId: string;
  readonly authorMemberId: string;
  readonly body: string;
  readonly createdAt: Date;
}
export interface TaskHistoryRecord {
  readonly id: string;
  readonly taskId: string;
  readonly eventType: "CREATED" | "UPDATED" | "ASSIGNEE_CHANGED" | "STATUS_CHANGED" | "COMMENTED";
  readonly actorMemberId: string;
  readonly note: string | null;
  readonly createdAt: Date;
}
export type TaskUpdatePatch = Partial<
  Pick<TaskRecord, "assigneeMemberId" | "title" | "description" | "priority" | "type"> & {
    readonly dueAt: Date;
  }
>;
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
  readonly list: (
    actor: CommercialActor,
    filters?: TaskListFilters,
    now?: Date,
  ) => Promise<readonly TaskRecord[]>;
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
  readonly update: (input: {
    readonly actor: CommercialActor;
    readonly id: string;
    readonly patch: TaskUpdatePatch;
    readonly expectedVersion: bigint;
    readonly now: Date;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<TaskRecord | null>;
  readonly addComment: (input: {
    readonly actor: CommercialActor;
    readonly taskId: string;
    readonly comment: TaskCommentRecord;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<TaskCommentRecord>;
  readonly listComments: (
    actor: CommercialActor,
    taskId: string,
  ) => Promise<readonly TaskCommentRecord[]>;
  readonly listHistory: (
    actor: CommercialActor,
    taskId: string,
  ) => Promise<readonly TaskHistoryRecord[]>;
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
  return Object.freeze({
    ...task,
    status,
    completedAt: status === "COMPLETED" || status === "CANCELLED" ? now : null,
    version: task.version + 1n,
    updatedAt: now,
  });
}
export { TaskService, TaskNotFoundError } from "./task-service.js";
