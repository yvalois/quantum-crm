import type { CrmAuthContext } from "@quantum-crm/auth";
import { DashboardService } from "@quantum-crm/domain";
import { describe, expect, it, vi } from "vitest";
import { DashboardController } from "./dashboard.controller.js";
import { CRM_AUTH_CONTEXT } from "./crm-security.js";

const auth: CrmAuthContext = {
  schemaVersion: "crm-auth-context/v1",
  boundary: "crm",
  tenantId: "019b0000-0000-7000-8000-000000000044",
  principal: {
    type: "human",
    id: "019b0000-0000-7000-8000-000000000040",
    oidcSubject: "dashboard-reader",
  },
  permissions: ["crm:contacts:read"],
  authorizationRevision: 1n,
  commercialScope: "ASSIGNED",
  authenticatedAt: "2026-10-14T12:00:00.000Z",
  correlationId: "dashboard-test",
};

describe("DashboardController", () => {
  it("passes only authenticated scope and permissions to the reporting use case", async () => {
    const snapshot = vi.fn().mockResolvedValue({
      period: "all",
      generatedAt: "2026-10-14T12:00:00.000Z",
      metrics: {
        contacts: 1,
        conversations: null,
        openOpportunities: null,
        wonOpportunities: null,
        overdueTasks: null,
        pipelineValue: null,
      },
      contactsTrend: [],
      opportunityStages: [],
      conversationChannels: [],
    });
    const controller = new DashboardController({ snapshot } as unknown as DashboardService);
    await expect(controller.snapshot({ headers: {} }, "all")).rejects.toThrow("Unauthorized");
    await expect(
      controller.snapshot({ headers: {}, [CRM_AUTH_CONTEXT]: auth }, "invalid"),
    ).rejects.toThrow("Invalid period");
    await controller.snapshot({ headers: {}, [CRM_AUTH_CONTEXT]: auth }, "all");
    expect(snapshot).toHaveBeenCalledWith(
      { memberId: auth.principal.id, scope: "ASSIGNED" },
      auth.permissions,
      "all",
    );
  });
});
