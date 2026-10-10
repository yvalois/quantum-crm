import { createHash } from "node:crypto";

import type { CrmAuthContext } from "@quantum-crm/auth";
import { ContactBulkActionSchema } from "@quantum-crm/contracts";
import { type ContactService } from "@quantum-crm/domain";
import { describe, expect, it, vi } from "vitest";

import { ContactsController } from "./contacts.controller.js";
import { CRM_AUTH_CONTEXT } from "./crm-security.js";

const memberId = "019b0000-0000-7000-8000-000000000040";
const operationKey = "contact-filter-0001";
const authContext: CrmAuthContext = {
  schemaVersion: "crm-auth-context/v1",
  boundary: "crm",
  tenantId: "019b0000-0000-7000-8000-000000000044",
  principal: { type: "human", id: memberId, oidcSubject: "member-40" },
  permissions: ["crm:contacts:read", "crm:contacts:delete"],
  authorizationRevision: 1n,
  commercialScope: "OWN",
  authenticatedAt: "2026-10-10T12:00:00.000Z",
  correlationId: "contact-controller-test",
};

describe("ContactsController", () => {
  it("normalizes a validated filter action into a server-side target before invoking the domain", async () => {
    const bulk = vi.fn(async () => ({
      results: [],
      updated: 1,
      unchanged: 0,
      notVisible: 0,
    }));
    const controller = new ContactsController({ bulk } as unknown as ContactService);
    const request = { headers: {}, [CRM_AUTH_CONTEXT]: authContext };
    const payload = {
      action: "ARCHIVE" as const,
      filter: {
        q: " Ada ",
        label: "VIP",
        createdFrom: "2026-09-01T00:00:00.000Z",
        createdTo: "2026-09-30T23:59:59.999Z",
      },
    };

    await controller.bulk(request as never, operationKey, payload);

    const parsed = ContactBulkActionSchema.parse(payload);
    expect(bulk).toHaveBeenCalledWith({
      actor: { memberId, scope: "OWN" },
      permissions: authContext.permissions,
      action: {
        action: "ARCHIVE",
        target: {
          kind: "FILTER",
          filter: {
            q: "Ada",
            label: "VIP",
            archived: false,
            createdFrom: new Date("2026-09-01T00:00:00.000Z"),
            createdTo: new Date("2026-09-30T23:59:59.999Z"),
          },
        },
      },
      idempotencyKey: operationKey,
      payloadHash: createHash("sha256").update(JSON.stringify(parsed)).digest("hex"),
    });
  });
});
