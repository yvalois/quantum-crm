import { describe, expect, it } from "vitest";

import {
  ConversationListQuerySchema,
  CreateConversationSchema,
  MarkConversationReadSchema,
  SendConversationMessageSchema,
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
    expect(UpdateConversationSchema.safeParse({ resetAgent: true }).success).toBe(true);
    expect(UpdateConversationSchema.safeParse({ resetAgent: false }).success).toBe(false);
  });

  it("requires the last displayed sequence when acknowledging incoming messages", () => {
    expect(MarkConversationReadSchema.safeParse({ throughSequence: "12" }).success).toBe(true);
    expect(MarkConversationReadSchema.safeParse({ throughSequence: "0" }).success).toBe(true);
    expect(MarkConversationReadSchema.safeParse({ throughSequence: "-1" }).success).toBe(false);
    expect(MarkConversationReadSchema.safeParse({}).success).toBe(false);
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

  it("requires a validated file reference for media messages", () => {
    const fileId = "019b0000-0000-7000-8000-000000000004";
    expect(
      SendConversationMessageSchema.safeParse({ body: "Foto", kind: "IMAGE", fileId }).success,
    ).toBe(true);
    expect(SendConversationMessageSchema.safeParse({ body: "Foto", kind: "IMAGE" }).success).toBe(
      false,
    );
    expect(
      SendConversationMessageSchema.safeParse({ body: "Hola", kind: "TEXT", fileId }).success,
    ).toBe(false);
    expect(
      SendConversationMessageSchema.safeParse({ body: "PDF", kind: "DOCUMENT", fileId }).success,
    ).toBe(true);
  });
});
