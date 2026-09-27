import { describe, expect, it } from "vitest";

import { IamAuthorizationError } from "../iam/index.js";
import {
  deriveTaskStatus,
  TaskService,
  TaskValidationError,
  transitionTask,
  type TaskRecord,
  type TaskRepository,
} from "./index.js";

const task: TaskRecord = Object.freeze({
  id: "019b0000-0000-7000-8000-000000000004",
  createdByMemberId: "019b0000-0000-7000-8000-000000000005",
  contactId: "019b0000-0000-7000-8000-000000000006",
  opportunityId: null,
  assigneeMemberId: "019b0000-0000-7000-8000-000000000005",
  title: "Call",
  description: "Confirm scope",
  priority: "MEDIUM",
  dueAt: new Date("2026-09-26T10:00:00.000Z"),
  status: "PENDING",
  version: 1n,
  createdAt: new Date("2026-09-25T10:00:00.000Z"),
  updatedAt: new Date("2026-09-25T10:00:00.000Z"),
});

describe("task expiry", () => {
  it("derives EXPIRED without persisting a new version", () => {
    const visible = deriveTaskStatus(task, new Date("2026-09-26T10:00:01.000Z"));
    expect(visible.status).toBe("EXPIRED");
    expect(visible.version).toBe(task.version);
    expect(task.status).toBe("PENDING");
  });
  it("denies task mutations by default before consulting another module", async () => {
    const repository: TaskRepository = {
      list: async () => [],
      find: async () => task,
      create: async (input) => input.task,
      updateStatus: async () => task,
    };
    const service = new TaskService(
      repository,
      {
        contactExistsFor: async () => true,
        opportunityExistsFor: async () => true,
        isActiveMember: async () => true,
        activeAssignees: async () => [],
      },
      () => new Date("2026-09-25T11:00:00.000Z"),
    );
    await expect(
      service.create({
        actor: { memberId: task.createdByMemberId, scope: "OWN" },
        permissions: [],
        contactId: task.contactId!,
        assigneeMemberId: task.assigneeMemberId,
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueAt: task.dueAt!,
        idempotencyKey: "task-create-0001",
        payloadHash: "a".repeat(64),
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
  });
  it("does not allow a derived expiry to become a persisted transition", () => {
    const expired = deriveTaskStatus(task, new Date("2026-09-26T10:00:01.000Z"));
    expect(() => transitionTask(expired, "PENDING", new Date())).toThrow(TaskValidationError);
  });
});
