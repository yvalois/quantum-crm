import { describe, expect, it } from "vitest";
import { ConversationChannelSchema, CreateConversationSchema } from "./conversation.js";
import {
  UnifiedInboxChannelSchema,
  UnifiedInboxListQuerySchema,
  UnifiedInboxListResponseSchema,
} from "./unified-inbox.js";

const historical = {
  id: "019b0000-0000-7000-8000-000000000001",
  source: "GHL",
  sourceExternalId: "fixture-thread",
  sourceThreadPresent: true,
  contactId: null,
  assigneeMemberId: null,
  rawChannel: "TYPE_SMS",
  rawStatus: "unread",
  subject: null,
  sourceCreatedAt: null,
  sourceUpdatedAt: null,
  messageCount: 0,
  lastMessageAt: null,
  importedAt: "2026-10-11T00:00:00.000Z",
};
describe("unified inbox contracts", () => {
  it.each(UnifiedInboxChannelSchema.options)(
    "accepts %s as an inbox filter without enabling historical-only native channels",
    (channel) => {
      expect(UnifiedInboxListQuerySchema.parse({ channel }).channel).toBe(channel);
      expect(
        CreateConversationSchema.safeParse({
          contactId: historical.id,
          channel,
          initialMessage: "Synthetic message",
        }).success,
      ).toBe(["EMAIL", "WHATSAPP", "WEBCHAT", "SMS"].includes(channel));
    },
  );
  it("keeps native channels bounded and rejects unsupported query values", () => {
    expect(ConversationChannelSchema.options).toEqual(["EMAIL", "WHATSAPP", "WEBCHAT", "SMS"]);
    for (const channel of ["TYPE_INSTAGRAM", "instagram", "PHONE", "", "OTHER"])
      expect(UnifiedInboxListQuerySchema.safeParse({ channel }).success).toBe(false);
  });
  it("bounds a global page and parses boolean query strings without truthiness coercion", () => {
    expect(UnifiedInboxListQuerySchema.parse({})).toEqual({ limit: 30, contactState: "ALL" });
    expect(UnifiedInboxListQuerySchema.parse({ unassigned: "false" }).unassigned).toBe(false);
    expect(UnifiedInboxListQuerySchema.parse({ unassigned: "true" }).unassigned).toBe(true);
    for (const input of [
      { limit: 51 },
      { unassigned: "0" },
      { tenantId: "other" },
      { scope: "PROFILE" },
    ])
      expect(UnifiedInboxListQuerySchema.safeParse(input).success).toBe(false);
  });
  it("preserves unknown provider status and rejects internal source metadata or the wrong discriminator", () => {
    const response = {
      data: [{ source: "GHL", conversation: historical }],
      page: { nextCursor: null },
    };
    expect(UnifiedInboxListResponseSchema.parse(response)).toEqual(response);
    for (const item of [
      { source: "QUANTUM", conversation: historical },
      {
        source: "GHL",
        conversation: { ...historical, sourceParticipantReferences: { locationId: "private" } },
      },
      { source: "GHL", conversation: { ...historical, raw: { token: "never-visible" } } },
    ])
      expect(UnifiedInboxListResponseSchema.safeParse({ ...response, data: [item] }).success).toBe(
        false,
      );
  });
});
