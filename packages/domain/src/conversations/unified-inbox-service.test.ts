import { describe, expect, it, vi } from "vitest";
import { IamAuthorizationError, type CommercialActor } from "../iam/index.js";
import { ConversationValidationError } from "./index.js";
import { UnifiedInboxService, type UnifiedInboxRecord } from "./unified-inbox-service.js";

const actor: CommercialActor = { memberId: "019b0000-0000-7000-8000-000000000001", scope: "OWN" };
const now = new Date("2026-10-11T00:00:00.000Z");
const historical: UnifiedInboxRecord = {
  source: "GHL",
  conversation: {
    id: "019b0000-0000-7000-8000-000000000002",
    source: "GHL",
    sourceExternalId: "fixture",
    sourceThreadPresent: true,
    contactId: null,
    assigneeMemberId: null,
    rawChannel: null,
    rawStatus: "unread",
    subject: null,
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    messageCount: 0,
    lastMessageAt: null,
    importedAt: now,
    sourceParticipantReferences: {
      locationId: "private-location",
      ownerExternalId: "owner",
      followerExternalIds: [],
    },
  },
};
const native: UnifiedInboxRecord = {
  source: "QUANTUM",
  conversation: {
    id: "019b0000-0000-7000-8000-000000000003",
    contactId: actor.memberId,
    channel: "SMS",
    externalThreadId: null,
    assigneeMemberId: actor.memberId,
    status: "OPEN",
    attentionMode: "HUMAN",
    subject: null,
    lastMessagePreview: "Fixture",
    lastMessageAt: now,
    unreadCount: 0,
    version: 1n,
    createdAt: now,
    updatedAt: now,
  },
};
describe("unified inbox service", () => {
  it("denies missing permission before repository or participant lookup", async () => {
    const list = vi.fn(async () => ({ items: [historical], nextCursor: null }));
    const resolve = vi.fn(async () => []);
    await expect(
      new UnifiedInboxService({ list }, { resolve }).list(actor, [], {
        limit: 30,
        contactState: "ALL",
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
    expect(list).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });
  it("rejects invalid limits before querying", async () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: null }));
    await expect(
      new UnifiedInboxService({ list }).list(actor, ["crm:conversations:read"], {
        limit: 51,
        contactState: "ALL",
      }),
    ).rejects.toBeInstanceOf(ConversationValidationError);
    expect(list).not.toHaveBeenCalled();
  });
  it("preserves mixed order and resolves only authorized source references in one batch", async () => {
    const list = vi.fn(async () => ({ items: [native, historical], nextCursor: "cursor" }));
    const resolve = vi.fn(async () => [
      { locationId: "private-location", externalId: "owner", displayName: "Original owner" },
    ]);
    const page = await new UnifiedInboxService({ list }, { resolve }).list(
      actor,
      ["crm:conversations:read"],
      { limit: 30, contactState: "ALL" },
    );
    expect(list).toHaveBeenCalledWith(actor, { limit: 30, contactState: "ALL" });
    expect(page.items.map((item) => item.source)).toEqual(["QUANTUM", "GHL"]);
    expect(page.items[0]).toBe(native);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(page.nextCursor).toBe("cursor");
    expect(page.items[1]?.conversation).not.toHaveProperty("sourceParticipantReferences");
    expect(page.items[1]?.conversation).toMatchObject({
      rawStatus: "unread",
      sourceParticipants: { owner: { displayName: "Original owner" } },
    });
  });
});
