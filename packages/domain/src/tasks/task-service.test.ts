import { describe, expect, it, vi } from "vitest";

import { IamAuthorizationError, type CommercialActor } from "../iam/index.js";
import {
  deriveTaskStatus,
  TaskNotFoundError,
  TaskService,
  TaskValidationError,
  TaskVersionConflictError,
  transitionTask,
  type TaskRecord,
  type TaskReferenceLookup,
  type TaskRepository,
} from "./index.js";

const actor: CommercialActor = Object.freeze({
  memberId: "019b0000-0000-7000-8000-000000000005",
  scope: "OWN",
});
const otherMemberId = "019b0000-0000-7000-8000-000000000007";
const now = new Date("2026-09-25T11:00:00.000Z");
const task: TaskRecord = Object.freeze({
  id: "019b0000-0000-7000-8000-000000000004",
  createdByMemberId: actor.memberId,
  contactId: "019b0000-0000-7000-8000-000000000006",
  opportunityId: null,
  assigneeMemberId: actor.memberId,
  title: "Call",
  description: "Confirm scope",
  priority: "MEDIUM",
  type: "CALL",
  origin: "MANUAL",
  dueAt: new Date("2026-09-26T10:00:00.000Z"),
  status: "PENDING",
  completedAt: null,
  completedByMemberId: null,
  version: 1n,
  createdAt: new Date("2026-09-25T10:00:00.000Z"),
  updatedAt: new Date("2026-09-25T10:00:00.000Z"),
});

function repositoryDouble(record: TaskRecord | null = task) {
  return {
    list: vi.fn(async () => (record === null ? [] : [record])),
    find: vi.fn(async () => record),
    create: vi.fn(async (input) => input.task),
    updateStatus: vi.fn(async (input) =>
      record === null || input.expectedVersion !== record.version
        ? null
        : Object.freeze({
            ...record,
            status: input.status,
            completedAt:
              input.status === "COMPLETED" || input.status === "CANCELLED" ? input.now : null,
            completedByMemberId:
              input.status === "COMPLETED" || input.status === "CANCELLED"
                ? input.actor.memberId
                : null,
            version: record.version + 1n,
            updatedAt: input.now,
          }),
    ),
    update: vi.fn(async (input) =>
      record === null || input.expectedVersion !== record.version
        ? null
        : Object.freeze({
            ...record,
            ...input.patch,
            version: record.version + 1n,
            updatedAt: input.now,
          }),
    ),
    addComment: vi.fn(async (input) => input.comment),
    listComments: vi.fn(async () => []),
    listHistory: vi.fn(async () => []),
  } satisfies TaskRepository;
}

function referencesDouble(active = true) {
  return {
    contactExistsFor: vi.fn(async () => true),
    opportunityExistsFor: vi.fn(async () => true),
    isActiveMember: vi.fn(async () => active),
    activeAssignees: vi.fn(async () => []),
  } satisfies TaskReferenceLookup;
}

describe("task expiry and transitions", () => {
  it("derives EXPIRED without persisting a new version", () => {
    const visible = deriveTaskStatus(task, new Date("2026-09-26T10:00:01.000Z"));
    expect(visible.status).toBe("EXPIRED");
    expect(visible.version).toBe(task.version);
    expect(task.status).toBe("PENDING");
  });

  it("does not allow a terminal task to be reopened", () => {
    const completed = Object.freeze({ ...task, status: "COMPLETED" as const });
    expect(() => transitionTask(completed, "PENDING", now)).toThrow(TaskValidationError);
  });

  it("does not allow a derived expiry to become a persisted transition directly", () => {
    const expired = deriveTaskStatus(task, new Date("2026-09-26T10:00:01.000Z"));
    expect(() => transitionTask(expired, "PENDING", now)).toThrow(TaskValidationError);
  });
});

describe("TaskService", () => {
  it("denies mutations before consulting repositories or references", async () => {
    const repository = repositoryDouble();
    const references = referencesDouble();
    const service = new TaskService(repository, references, () => now);

    await expect(
      service.create({
        actor,
        permissions: [],
        contactId: task.contactId!,
        assigneeMemberId: task.assigneeMemberId,
        title: task.title,
        description: task.description,
        priority: task.priority,
        type: task.type,
        dueAt: task.dueAt!,
        idempotencyKey: "task-create-0001",
        payloadHash: "a".repeat(64),
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);

    expect(references.isActiveMember).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("creates a trimmed manual task linked to one visible commercial record", async () => {
    const repository = repositoryDouble();
    const references = referencesDouble();
    const service = new TaskService(repository, references, () => now);

    const created = await service.create({
      actor,
      permissions: ["crm:tasks:create"],
      contactId: task.contactId!,
      assigneeMemberId: task.assigneeMemberId,
      title: "  Follow up  ",
      description: "  Confirm scope  ",
      priority: "HIGH",
      type: "CALL",
      dueAt: task.dueAt!,
      idempotencyKey: "task-create-0002",
      payloadHash: "b".repeat(64),
    });

    expect(created).toMatchObject({
      contactId: task.contactId,
      opportunityId: null,
      title: "Follow up",
      description: "Confirm scope",
      type: "CALL",
      origin: "MANUAL",
      completedAt: null,
      completedByMemberId: null,
    });
    expect(references.contactExistsFor).toHaveBeenCalledWith(actor, task.contactId);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actor,
        idempotencyKey: "task-create-0002",
        payloadHash: "b".repeat(64),
      }),
    );
  });

  it("rejects an inactive assignee without writing the task", async () => {
    const repository = repositoryDouble();
    const service = new TaskService(repository, referencesDouble(false), () => now);

    await expect(
      service.create({
        actor,
        permissions: ["crm:tasks:create"],
        contactId: task.contactId!,
        assigneeMemberId: otherMemberId,
        title: task.title,
        description: task.description,
        priority: task.priority,
        type: task.type,
        dueAt: task.dueAt!,
        idempotencyKey: "task-create-0003",
        payloadHash: "c".repeat(64),
      }),
    ).rejects.toBeInstanceOf(TaskNotFoundError);

    expect(repository.create).not.toHaveBeenCalled();
  });

  it("forwards combined filters and derives expiry with one controlled clock", async () => {
    const overdue = Object.freeze({ ...task, dueAt: new Date("2026-09-25T10:59:59.000Z") });
    const repository = repositoryDouble(overdue);
    const service = new TaskService(repository, referencesDouble(), () => now);
    const filters = Object.freeze({
      assigneeMemberId: actor.memberId,
      status: "EXPIRED" as const,
      priority: "MEDIUM" as const,
      type: "CALL" as const,
      dueFrom: new Date("2026-09-01T00:00:00.000Z"),
      dueTo: new Date("2026-09-30T23:59:59.000Z"),
    });

    await expect(service.list(actor, ["crm:tasks:read"], filters)).resolves.toEqual([
      expect.objectContaining({ id: task.id, status: "EXPIRED" }),
    ]);
    expect(repository.list).toHaveBeenCalledWith(actor, filters, now);
  });

  it("edits and reassigns only to an active member while preserving command metadata", async () => {
    const repository = repositoryDouble();
    const references = referencesDouble();
    const service = new TaskService(repository, references, () => now);

    await service.update({
      actor,
      permissions: ["crm:tasks:update"],
      id: task.id,
      patch: { assigneeMemberId: otherMemberId, title: "New title" },
      expectedVersion: 1n,
      idempotencyKey: "task-update-0001",
      payloadHash: "d".repeat(64),
    });

    expect(references.isActiveMember).toHaveBeenCalledWith(otherMemberId);
    expect(repository.update).toHaveBeenCalledWith({
      actor,
      id: task.id,
      patch: { assigneeMemberId: otherMemberId, title: "New title" },
      expectedVersion: 1n,
      now,
      idempotencyKey: "task-update-0001",
      payloadHash: "d".repeat(64),
    });
  });

  it("rejects stale edits and invalid dates before writing", async () => {
    const repository = repositoryDouble();
    const service = new TaskService(repository, referencesDouble(), () => now);

    await expect(
      service.update({
        actor,
        permissions: ["crm:tasks:update"],
        id: task.id,
        patch: { title: "Stale" },
        expectedVersion: 2n,
        idempotencyKey: "task-update-0002",
        payloadHash: "e".repeat(64),
      }),
    ).rejects.toBeInstanceOf(TaskVersionConflictError);
    repository.update.mockClear();
    await expect(
      service.update({
        actor,
        permissions: ["crm:tasks:update"],
        id: task.id,
        patch: { dueAt: new Date(Number.NaN) },
        expectedVersion: 1n,
        idempotencyKey: "task-update-0003",
        payloadHash: "f".repeat(64),
      }),
    ).rejects.toBeInstanceOf(TaskValidationError);

    expect(repository.update).not.toHaveBeenCalled();
  });

  it("closes an overdue task with actor and time while keeping EXPIRED derived", async () => {
    const overdue = Object.freeze({ ...task, dueAt: new Date("2026-09-25T10:59:59.000Z") });
    const repository = repositoryDouble(overdue);
    const service = new TaskService(repository, referencesDouble(), () => now);

    await expect(
      service.updateStatus({
        actor,
        permissions: ["crm:tasks:update"],
        id: task.id,
        status: "COMPLETED",
        expectedVersion: 1n,
        idempotencyKey: "task-status-0001",
        payloadHash: "1".repeat(64),
      }),
    ).resolves.toMatchObject({
      status: "COMPLETED",
      completedAt: now,
      completedByMemberId: actor.memberId,
      version: 2n,
    });
    expect(repository.updateStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "COMPLETED", now }),
    );
  });

  it("lets the repository replay an already committed status command", async () => {
    const completed = Object.freeze({
      ...task,
      status: "COMPLETED" as const,
      completedAt: now,
      completedByMemberId: actor.memberId,
      version: 2n,
      updatedAt: now,
    });
    const repository = repositoryDouble(completed);
    repository.updateStatus.mockResolvedValue(completed);
    const service = new TaskService(repository, referencesDouble(), () => now);

    await expect(
      service.updateStatus({
        actor,
        permissions: ["crm:tasks:update"],
        id: task.id,
        status: "COMPLETED",
        expectedVersion: 1n,
        idempotencyKey: "task-status-replay-0001",
        payloadHash: "3".repeat(64),
      }),
    ).resolves.toBe(completed);
    expect(repository.updateStatus).toHaveBeenCalledOnce();
  });

  it("trims and attributes an internal comment without losing idempotency metadata", async () => {
    const repository = repositoryDouble();
    const service = new TaskService(repository, referencesDouble(), () => now);

    const comment = await service.addComment({
      actor,
      permissions: ["crm:tasks:update"],
      taskId: task.id,
      body: "  Customer confirmed  ",
      idempotencyKey: "task-comment-0001",
      payloadHash: "2".repeat(64),
    });

    expect(comment).toMatchObject({
      taskId: task.id,
      authorMemberId: actor.memberId,
      body: "Customer confirmed",
      createdAt: now,
    });
    expect(repository.addComment).toHaveBeenCalledWith(
      expect.objectContaining({
        actor,
        taskId: task.id,
        idempotencyKey: "task-comment-0001",
        payloadHash: "2".repeat(64),
      }),
    );
  });

  it("fails closed when comments or history target a task outside the actor scope", async () => {
    const repository = repositoryDouble(null);
    const service = new TaskService(repository, referencesDouble(), () => now);

    await expect(service.listComments(actor, ["crm:tasks:read"], task.id)).rejects.toBeInstanceOf(
      TaskNotFoundError,
    );
    await expect(service.listHistory(actor, ["crm:tasks:read"], task.id)).rejects.toBeInstanceOf(
      TaskNotFoundError,
    );
    await expect(service.listComments(actor, [], task.id)).rejects.toBeInstanceOf(
      IamAuthorizationError,
    );

    expect(repository.listComments).not.toHaveBeenCalled();
    expect(repository.listHistory).not.toHaveBeenCalled();
  });
});
