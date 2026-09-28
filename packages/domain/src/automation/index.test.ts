import { describe, expect, it, vi } from "vitest";

import { IamAuthorizationError } from "../iam/index.js";
import { AutomationService, type AutomationRepository } from "./index.js";

const actor = { memberId: "01995f7e-7b52-7000-8000-000000000201", scope: "PROFILE" as const };
const action = {
  type: "CREATE_TASK" as const,
  title: "Llamar al contacto",
  description: "Realizar la llamada inicial.",
  priority: "MEDIUM" as const,
  dueHours: 24,
};

describe("AutomationService", () => {
  it("requires the configure permission to create a flow", async () => {
    const repository = { create: vi.fn(), list: vi.fn(), activate: vi.fn() } as unknown as AutomationRepository;
    const service = new AutomationService(repository, () => new Date("2026-09-28T12:00:00.000Z"));
    expect(() =>
      service.create({
        actor,
        permissions: ["crm:automations:read"],
        name: "Seguimiento",
        status: "ACTIVE",
        action,
        idempotencyKey: "automation-create-1",
        payloadHash: "hash",
      }),
    ).toThrow(IamAuthorizationError);
  });

  it("deduplicates contacts before delegating activation", async () => {
    const activate = vi.fn().mockResolvedValue({
      automationId: "01995f7e-7b52-7000-8000-000000000210",
      operationKey: "automation-run-1",
      results: [],
      succeeded: 0,
      failed: 0,
    });
    const repository = { create: vi.fn(), list: vi.fn(), activate } as unknown as AutomationRepository;
    const service = new AutomationService(repository);
    await service.activate({
      actor,
      permissions: ["crm:automations:execute"],
      automationId: "01995f7e-7b52-7000-8000-000000000210",
      contactIds: ["01995f7e-7b52-7000-8000-000000000201", "01995f7e-7b52-7000-8000-000000000201"],
      operationKey: "automation-run-1",
      payloadHash: "hash",
    });
    expect(activate).toHaveBeenCalledWith(expect.objectContaining({ contactIds: ["01995f7e-7b52-7000-8000-000000000201"] }));
  });
});
