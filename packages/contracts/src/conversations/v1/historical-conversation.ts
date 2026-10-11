import { z } from "zod";

const TimestampSchema = z.string().datetime({ offset: true });
const SourceTextSchema = z.string().max(200).nullable();
export const HistoricalConversationPageQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,512}$/u)
      .optional(),
  })
  .strict();
export const HistoricalConversationListQuerySchema = HistoricalConversationPageQuerySchema.extend({
  contactId: z.string().uuid().optional(),
  query: z.string().trim().min(1).max(160).optional(),
});
export const HistoricalConversationSchema = z
  .object({
    id: z.string().uuid(),
    source: z.literal("GHL"),
    sourceExternalId: z.string().min(1).max(300),
    sourceThreadPresent: z.boolean(),
    contactId: z.string().uuid().nullable(),
    assigneeMemberId: z.string().uuid().nullable(),
    rawChannel: SourceTextSchema,
    rawStatus: SourceTextSchema,
    subject: z.string().max(16_000).nullable(),
    sourceCreatedAt: TimestampSchema.nullable(),
    sourceUpdatedAt: TimestampSchema.nullable(),
    messageCount: z.number().int().nonnegative(),
    lastMessageAt: TimestampSchema.nullable(),
    importedAt: TimestampSchema,
  })
  .strict();
export const HistoricalConversationMessageSchema = z
  .object({
    id: z.string().uuid(),
    threadId: z.string().uuid(),
    sourceExternalId: z.string().min(1).max(300),
    rawChannel: SourceTextSchema,
    rawType: SourceTextSchema,
    rawDirection: SourceTextSchema,
    rawStatus: SourceTextSchema,
    body: z.string().max(1_000_000),
    attachmentCount: z.number().int().nonnegative(),
    sourceCreatedAt: TimestampSchema.nullable(),
    sourceUpdatedAt: TimestampSchema.nullable(),
    importedAt: TimestampSchema,
  })
  .strict();
const PageSchema = z.object({ nextCursor: z.string().max(512).nullable() }).strict();
export const HistoricalConversationListResponseSchema = z
  .object({
    data: z.array(HistoricalConversationSchema),
    page: PageSchema,
  })
  .strict();
export const HistoricalConversationResponseSchema = z
  .object({ data: HistoricalConversationSchema })
  .strict();
export const HistoricalConversationMessageListResponseSchema = z
  .object({
    data: z.array(HistoricalConversationMessageSchema),
    page: PageSchema,
  })
  .strict();
export type HistoricalConversation = z.infer<typeof HistoricalConversationSchema>;
export type HistoricalConversationMessage = z.infer<typeof HistoricalConversationMessageSchema>;
