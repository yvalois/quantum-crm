import { describe, expect, it, vi } from "vitest";

import { IamAuthorizationError } from "../iam/index.js";
import { AgentControlService, type AgentControlRepository } from "./agent-control-service.js";
import { ConversationVersionConflictError } from "./index.js";

const state = { enabled: true, version: 1n, updatedAt: new Date("2026-10-14T00:00:00.000Z") };
const repository: AgentControlRepository = {
  get: vi.fn(async () => state),
  set: vi.fn(async () => state),
};

describe("AgentControlService", () => {
  it("allows readers to inspect the profile switch but not change it", async () => {
    const service = new AgentControlService(repository);
    await expect(service.get(["crm:conversations:read"])).resolves.toEqual(state);
    await expect(
      service.set({
        permissions: ["crm:conversations:read"],
        actorMemberId: "member",
        expectedVersion: 1n,
        enabled: false,
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
  });

  it("requires configuration permission and reports concurrent changes", async () => {
    const service = new AgentControlService({ get: async () => state, set: async () => null });
    await expect(
      service.set({
        permissions: ["crm:conversations:configure"],
        actorMemberId: "member",
        expectedVersion: 1n,
        enabled: false,
      }),
    ).rejects.toBeInstanceOf(ConversationVersionConflictError);
  });
});
