import { describe, expect, it } from "vitest";

import {
  ConversationListQuerySchema,
  CreateConversationSchema,
  UpdateConversationSchema,
} from "./conversation.js";

describe("conversation contracts", () => {
  it("accepts the four planned channels and rejects unknown provider payloads", () => {
    for (const channel of ["EMAIL", "WHATSAPP", "WEBCHAT", "SMS"])
      expect(
        CreateConversationSchema.safeParse({
          contactId: "019b0000-0000-7000-8000-000000000001",
          channel,
          initialMessage: "Hola",
        }).success,
      ).toBe(true);
    expect(
      CreateConversationSchema.safeParse({
        contactId: "019b0000-0000-7000-8000-000000000001",
        channel: "TELEGRAM",
        initialMessage: "Hola",
      }).success,
    ).toBe(false);
  });

  it("requires at least one controlled mutation field", () => {
    expect(UpdateConversationSchema.safeParse({}).success).toBe(false);
    expect(UpdateConversationSchema.safeParse({ attentionMode: "HUMAN" }).success).toBe(true);
  });

  it("bounds pagination and normalizes query values", () => {
    const parsed = ConversationListQuerySchema.parse({
      limit: "25",
      unassigned: "true",
      contactId: "019b0000-0000-7000-8000-000000000001",
    });
    expect(parsed.limit).toBe(25);
    expect(parsed.unassigned).toBe(true);
    expect(parsed.contactId).toBe("019b0000-0000-7000-8000-000000000001");
    expect(ConversationListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(ConversationListQuerySchema.safeParse({ contactId: "not-a-contact" }).success).toBe(
      false,
    );
  });
});
