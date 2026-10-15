import type { CrmAuthContext } from "@quantum-crm/auth";
import { CustomFieldDefinitionService } from "@quantum-crm/domain";
import { describe, expect, it, vi } from "vitest";
import { CustomFieldDefinitionsController } from "./custom-field-definitions.controller.js";
import { CRM_AUTH_CONTEXT } from "./crm-security.js";

const auth: CrmAuthContext = {
  schemaVersion: "crm-auth-context/v1",
  boundary: "crm",
  tenantId: "019b0000-0000-7000-8000-000000000044",
  principal: {
    type: "human",
    id: "019b0000-0000-7000-8000-000000000040",
    oidcSubject: "field-catalog-reader",
  },
  permissions: ["crm:contacts:read"],
  authorizationRevision: 1n,
  commercialScope: "OWN",
  authenticatedAt: "2026-10-11T12:00:00.000Z",
  correlationId: "field-catalog-test",
};

describe("CustomFieldDefinitionsController", () => {
  it("requires authenticated model-specific permission without broadening access to values", async () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: null }));
    const controller = new CustomFieldDefinitionsController(
      new CustomFieldDefinitionService({ list, find: async () => null }),
    );
    await expect(controller.list({ headers: {} }, { model: "contact" })).rejects.toThrow(
      "Unauthorized",
    );
    await expect(
      controller.list({ headers: {}, [CRM_AUTH_CONTEXT]: auth }, { model: "opportunity" }),
    ).rejects.toThrow("Forbidden");
    expect(list).not.toHaveBeenCalled();
    await expect(
      controller.list({ headers: {}, [CRM_AUTH_CONTEXT]: auth }, { model: "contact" }),
    ).resolves.toEqual({ data: [], page: { nextCursor: null } });
  });

  it("rejects caller profile selectors, unknown models and invalid page limits", async () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: null }));
    const controller = new CustomFieldDefinitionsController(
      new CustomFieldDefinitionService({ list, find: async () => null }),
    );
    for (const query of [
      { model: "contact", tenantId: "other" },
      { model: "iam" },
      { model: "contact", limit: 101 },
    ])
      await expect(
        controller.list({ headers: {}, [CRM_AUTH_CONTEXT]: auth }, query),
      ).rejects.toThrow("Bad Request");
    expect(list).not.toHaveBeenCalled();
  });
});
