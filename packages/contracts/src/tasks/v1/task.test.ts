import { describe, expect, it } from "vitest";

import {
  CreateTaskCommentSchema,
  CreateTaskSchema,
  TaskHistoryEntrySchema,
  TaskListQuerySchema,
  TaskSchema,
  TaskStatusSchema,
  UpdateTaskSchema,
  UpdateTaskStatusSchema,
} from "./task.js";

const contactId = "019b0000-0000-7000-8000-000000000001";
const opportunityId = "019b0000-0000-7000-8000-000000000002";
const memberId = "019b0000-0000-7000-8000-000000000003";

describe("task contracts", () => {
  it("requires exactly one commercial relation and an RFC3339 timestamp with offset", () => {
    expect(
      CreateTaskSchema.safeParse({
        contactId,
        opportunityId,
        assigneeMemberId: memberId,
        title: "Call",
        description: "Confirm scope",
        dueAt: "2026-09-26T09:00:00-05:00",
      }).success,
    ).toBe(false);
    expect(
      CreateTaskSchema.safeParse({
        contactId,
        assigneeMemberId: memberId,
        title: "Call",
        description: "Confirm scope",
        dueAt: "2026-09-26T09:00:00",
      }).success,
    ).toBe(false);
    expect(
      CreateTaskSchema.safeParse({
        contactId,
        assigneeMemberId: memberId,
        title: "Call",
        description: "Confirm scope",
        dueAt: "2026-09-26T09:00:00-05:00",
      }).success,
    ).toBe(true);
  });

  it("applies stable defaults and accepts every supported task type", () => {
    const base = {
      contactId,
      assigneeMemberId: memberId,
      title: "Call",
      description: "Confirm scope",
      dueAt: "2026-09-26T09:00:00-05:00",
    };

    expect(CreateTaskSchema.parse(base)).toMatchObject({ priority: "MEDIUM", type: "OTHER" });
    for (const type of ["CALL", "MESSAGE", "MEETING", "QUOTE", "COLLECTION", "OTHER"] as const) {
      expect(CreateTaskSchema.safeParse({ ...base, type }).success).toBe(true);
    }
    expect(CreateTaskSchema.safeParse({ ...base, type: "REMINDER" }).success).toBe(false);
  });

  it("publishes EXPIRED as a read-only presentation status", () => {
    expect(TaskStatusSchema.parse("EXPIRED")).toBe("EXPIRED");
    expect(UpdateTaskStatusSchema.safeParse({ status: "EXPIRED" }).success).toBe(false);
    expect(UpdateTaskStatusSchema.safeParse({ status: "COMPLETED" }).success).toBe(true);
  });

  it("requires a non-empty strict edit and preserves the required due date", () => {
    expect(UpdateTaskSchema.safeParse({}).success).toBe(false);
    expect(UpdateTaskSchema.safeParse({ dueAt: null }).success).toBe(false);
    expect(UpdateTaskSchema.safeParse({ title: "  " }).success).toBe(false);
    expect(UpdateTaskSchema.safeParse({ title: "Follow up", unknown: true }).success).toBe(false);
  });

  it("validates combinable filters and rejects an inverted due-date range", () => {
    expect(
      TaskListQuerySchema.safeParse({
        contactId,
        assigneeMemberId: memberId,
        status: "EXPIRED",
        priority: "HIGH",
        type: "CALL",
        dueFrom: "2026-09-25T00:00:00-05:00",
        dueTo: "2026-09-30T23:59:59-05:00",
      }).success,
    ).toBe(true);
    expect(
      TaskListQuerySchema.safeParse({
        dueFrom: "2026-10-01T00:00:00Z",
        dueTo: "2026-09-30T23:59:59Z",
      }).success,
    ).toBe(false);
    expect(TaskListQuerySchema.safeParse({ owner: memberId }).success).toBe(false);
  });

  it("publishes origin and durable closure metadata in task responses", () => {
    expect(
      TaskSchema.parse({
        id: "019b0000-0000-7000-8000-000000000004",
        contactId,
        opportunityId: null,
        assigneeMemberId: memberId,
        title: "Call",
        description: "Confirm scope",
        priority: "HIGH",
        type: "CALL",
        origin: "MANUAL",
        dueAt: null,
        status: "COMPLETED",
        completedAt: "2026-09-26T15:00:00Z",
        completedByMemberId: memberId,
        version: "2",
        createdAt: "2026-09-25T15:00:00Z",
        updatedAt: "2026-09-26T15:00:00Z",
      }),
    ).toMatchObject({ origin: "MANUAL", completedByMemberId: memberId });
  });

  it("keeps comments and history strict, bounded and attributable", () => {
    expect(CreateTaskCommentSchema.parse({ body: "  Customer confirmed  " })).toEqual({
      body: "Customer confirmed",
    });
    expect(CreateTaskCommentSchema.safeParse({ body: " ".repeat(4_001) }).success).toBe(false);
    expect(CreateTaskCommentSchema.safeParse({ body: "ok", public: true }).success).toBe(false);

    expect(
      TaskHistoryEntrySchema.safeParse({
        id: "019b0000-0000-7000-8000-000000000010",
        taskId: "019b0000-0000-7000-8000-000000000004",
        eventType: "ASSIGNEE_CHANGED",
        actorMemberId: memberId,
        note: "Responsable actualizado",
        createdAt: "2026-09-26T15:00:00Z",
      }).success,
    ).toBe(true);
    expect(
      TaskHistoryEntrySchema.safeParse({
        id: "019b0000-0000-7000-8000-000000000010",
        taskId: "019b0000-0000-7000-8000-000000000004",
        eventType: "DELETED",
        actorMemberId: memberId,
        note: null,
        createdAt: "2026-09-26T15:00:00Z",
      }).success,
    ).toBe(false);
  });
});
