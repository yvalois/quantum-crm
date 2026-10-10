import { createHash } from "node:crypto";

import type { CrmAuthContext } from "@quantum-crm/auth";
import { describe, expect, it, vi } from "vitest";

import { type AutomationService } from "@quantum-crm/domain";

import { AutomationsController } from "./automations.controller.js";
import { CRM_AUTH_CONTEXT } from "./crm-security.js";

const memberId = "019b0000-0000-7000-8000-000000000040";
const contactId = "019b0000-0000-7000-8000-000000000041";
const firstAutomationId = "019b0000-0000-7000-8000-000000000042";
const secondAutomationId = "019b0000-0000-7000-8000-000000000043";
const operationKey = "automation-run-0001";
const payload = { contactIds: [contactId] };

const authContext: CrmAuthContext = {
  schemaVersion: "crm-auth-context/v1",
  boundary: "crm",
  tenantId: "019b0000-0000-7000-8000-000000000044",
  principal: { type: "human", id: memberId, oidcSubject: "member-40" },
  permissions: ["crm:automations:execute", "crm:tasks:create"],
  authorizationRevision: 1n,
  commercialScope: "PROFILE",
  authenticatedAt: "2026-10-10T12:00:00.000Z",
  correlationId: "automation-controller-test",
};

describe("AutomationsController", () => {
  it("binds an activation idempotency hash to its automation as well as its batch", async () => {
    const activate = vi.fn(async (input: { readonly automationId: string }) => ({
      automationId: input.automationId,
      operationKey,
      results: [],
      succeeded: 0,
      failed: 0,
    }));
    const controller = new AutomationsController({ activate } as unknown as AutomationService);
    const request = { headers: {}, [CRM_AUTH_CONTEXT]: authContext };

    await controller.activate(request as never, firstAutomationId, operationKey, payload);
    await controller.activate(request as never, secondAutomationId, operationKey, payload);

    const firstHash = activate.mock.calls[0]?.[0]?.payloadHash;
    const secondHash = activate.mock.calls[1]?.[0]?.payloadHash;
    expect(firstHash).toBe(
      createHash("sha256")
        .update(JSON.stringify({ automationId: firstAutomationId, ...payload }))
        .digest("hex"),
    );
    expect(secondHash).toBe(
      createHash("sha256")
        .update(JSON.stringify({ automationId: secondAutomationId, ...payload }))
        .digest("hex"),
    );
    expect(secondHash).not.toBe(firstHash);
  });
});
