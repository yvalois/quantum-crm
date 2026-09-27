import { describe, expect, it } from "vitest";

import { CreateTaskSchema, TaskStatusSchema, UpdateTaskStatusSchema } from "./task.js";

const contactId = "019b0000-0000-7000-8000-000000000001";
const opportunityId = "019b0000-0000-7000-8000-000000000002";
const memberId = "019b0000-0000-7000-8000-000000000003";

describe("task contracts", () => {
  it("requires exactly one commercial relation and an RFC3339 timestamp with offset", () => {
    expect(CreateTaskSchema.safeParse({ contactId, opportunityId, assigneeMemberId: memberId, title: "Call", description: "Confirm scope", dueAt: "2026-09-26T09:00:00-05:00" }).success).toBe(false);
    expect(CreateTaskSchema.safeParse({ contactId, assigneeMemberId: memberId, title: "Call", description: "Confirm scope", dueAt: "2026-09-26T09:00:00" }).success).toBe(false);
    expect(CreateTaskSchema.safeParse({ contactId, assigneeMemberId: memberId, title: "Call", description: "Confirm scope", dueAt: "2026-09-26T09:00:00-05:00" }).success).toBe(true);
  });

  it("publishes EXPIRED as a read-only presentation status", () => {
    expect(TaskStatusSchema.parse("EXPIRED")).toBe("EXPIRED");
    expect(UpdateTaskStatusSchema.safeParse({ status: "EXPIRED" }).success).toBe(false);
    expect(UpdateTaskStatusSchema.safeParse({ status: "COMPLETED" }).success).toBe(true);
  });
});
