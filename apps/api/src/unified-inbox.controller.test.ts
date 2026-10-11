import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { CrmAuthContext } from "@quantum-crm/auth";
import { UnifiedInboxService, type UnifiedInboxRecord } from "@quantum-crm/domain";
import { describe, expect, it, vi } from "vitest";
import { CRM_AUTH_CONTEXT } from "./crm-security.js";
import { UnifiedInboxController } from "./unified-inbox.controller.js";

const auth: CrmAuthContext = {
  schemaVersion: "crm-auth-context/v1", boundary: "crm",
  tenantId: "019b0000-0000-7000-8000-000000000001",
  principal: { type: "human", id: "019b0000-0000-7000-8000-000000000002", oidcSubject: "fixture" },
  permissions: ["crm:conversations:read"], authorizationRevision: 1n, commercialScope: "OWN",
  authenticatedAt: "2026-10-11T00:00:00.000Z", correlationId: "unified-inbox-test",
};
const item: UnifiedInboxRecord = {
  source: "GHL",
  conversation: {
    id: "019b0000-0000-7000-8000-000000000003", source: "GHL", sourceExternalId: "fixture-thread",
    sourceThreadPresent: true, contactId: auth.principal.id, assigneeMemberId: auth.principal.id,
    rawChannel: "TYPE_EMAIL", rawStatus: "unread", subject: "Fixture",
    sourceCreatedAt: null, sourceUpdatedAt: null, messageCount: 0, lastMessageAt: null,
    importedAt: new Date("2026-10-11T00:00:00.000Z"),
    sourceParticipantReferences: { locationId: "private-location", ownerExternalId: "fixture-owner", followerExternalIds: [] },
  },
};
describe("UnifiedInboxController", () => {
  it("serializes authorized history without private source references and retains unknown status", async () => {
    const list = vi.fn(async () => ({ items: [item], nextCursor: null }));
    const resolve = vi.fn(async () => [{ locationId: "private-location", externalId: "fixture-owner", displayName: "Original owner" }]);
    const controller = new UnifiedInboxController(new UnifiedInboxService({ list }, { resolve }));
    const response = await controller.list({ headers: {}, [CRM_AUTH_CONTEXT]: auth }, { limit: "30" });
    expect(list).toHaveBeenCalledWith({ memberId: auth.principal.id, scope: "OWN" }, { limit: 30, contactState: "ALL" });
    expect(response.data[0]).toMatchObject({ source: "GHL", conversation: { rawStatus: "unread", importedAt: "2026-10-11T00:00:00.000Z", sourceParticipants: { owner: { displayName: "Original owner" } } } });
    expect(JSON.stringify(response)).not.toContain("private-location");
    expect(JSON.stringify(response)).not.toContain("sourceParticipantReferences");
  });
  it("rejects denied permission and query scope escalation before querying", async () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: null }));
    const controller = new UnifiedInboxController(new UnifiedInboxService({ list }));
    await expect(controller.list({ headers: {}, [CRM_AUTH_CONTEXT]: { ...auth, permissions: [] } }, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.list({ headers: {}, [CRM_AUTH_CONTEXT]: auth }, { scope: "PROFILE" })).rejects.toBeInstanceOf(BadRequestException);
    expect(list).not.toHaveBeenCalled();
  });
  it("refuses unexpected source payload fields instead of returning them", async () => {
    const list = async () => ({ items: [{ ...item, conversation: { ...item.conversation, sourcePayload: { token: "private-token" } } }], nextCursor: null });
    const controller = new UnifiedInboxController(new UnifiedInboxService({ list }));
    await expect(controller.list({ headers: {}, [CRM_AUTH_CONTEXT]: auth }, {})).rejects.toThrow();
  });
});
