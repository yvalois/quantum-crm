import { z } from "zod";
import {
  ConversationAttentionModeSchema,
  ConversationChannelSchema,
  ConversationSchema,
  ConversationStatusSchema,
} from "./conversation.js";
import { HistoricalConversationSchema } from "./historical-conversation.js";

export const UnifiedInboxListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(30),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,512}$/u)
      .optional(),
    query: z.string().trim().min(1).max(160).optional(),
    contactId: z.string().uuid().optional(),
    contactState: z.enum(["ALL", "LINKED", "UNLINKED"]).default("ALL"),
    channel: ConversationChannelSchema.optional(),
    status: ConversationStatusSchema.optional(),
    attentionMode: ConversationAttentionModeSchema.optional(),
    unassigned: z
      .union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")])
      .optional(),
  })
  .strict();

/** Source identifies the detail route; neither an external identity nor a contact is merged. */
export const UnifiedInboxItemSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("QUANTUM"), conversation: ConversationSchema }).strict(),
  z.object({ source: z.literal("GHL"), conversation: HistoricalConversationSchema }).strict(),
]);
export const UnifiedInboxListResponseSchema = z
  .object({
    data: z.array(UnifiedInboxItemSchema).max(50),
    page: z.object({ nextCursor: z.string().min(1).max(512).nullable() }).strict(),
  })
  .strict();
export type UnifiedInboxItem = z.infer<typeof UnifiedInboxItemSchema>;
export type UnifiedInboxListQuery = z.infer<typeof UnifiedInboxListQuerySchema>;
export type UnifiedInboxListResponse = z.infer<typeof UnifiedInboxListResponseSchema>;
