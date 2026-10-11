import { describe, expect, it } from "vitest";
import {
  HistoricalConversationListQuerySchema,
  HistoricalConversationMessageSchema,
} from "./historical-conversation.js";

const message = {
  id: "019b0000-0000-7000-8000-000000000001",
  threadId: "019b0000-0000-7000-8000-000000000002",
  sourceExternalId: "fixture-message",
  rawChannel: "TYPE_CALL",
  rawType: "1",
  rawDirection: "outbound",
  rawStatus: "pending",
  body: "",
  attachmentCount: 2,
  sourceCreatedAt: "2020-01-01T13:00:00.000Z",
  sourceUpdatedAt: null,
  importedAt: "2026-10-11T13:00:00.000Z",
};
describe("historical conversation contracts", () => {
  it("keeps missing message text, unknown channels and source dates without fabricating delivery", () => {
    expect(HistoricalConversationMessageSchema.parse(message)).toEqual(message);
    expect(
      HistoricalConversationMessageSchema.parse({ ...message, body: "  original\n" }).body,
    ).toBe("  original\n");
  });
  it("rejects source payloads, contact identifiers and attachment URLs in API responses", () => {
    for (const extra of [
      { sourceContactId: "private-source-id" },
      { raw: { internal: true } },
      { attachmentUrl: "https://invalid.example/attachment" },
    ]) {
      expect(HistoricalConversationMessageSchema.safeParse({ ...message, ...extra }).success).toBe(
        false,
      );
    }
  });
  it("bounds and validates history queries", () => {
    expect(HistoricalConversationListQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(HistoricalConversationListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(HistoricalConversationListQuerySchema.safeParse({ tenantId: "other" }).success).toBe(
      false,
    );
  });
});
