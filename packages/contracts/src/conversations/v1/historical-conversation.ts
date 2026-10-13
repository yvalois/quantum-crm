import { z } from "zod";
import { SourceParticipantsSchema } from "../../iam/v1/source-participants.js";

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
  contactState: z.enum(["ALL", "LINKED", "UNLINKED"]).optional(),
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
    sourceParticipants: SourceParticipantsSchema.optional(),
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
export const HistoricalConversationAttachmentSchema = z
  .object({
    id: z.string().uuid(),
    attachmentIndex: z.number().int().nonnegative(),
    fileId: z.string().uuid().nullable(),
    status: z.enum(["PENDING", "AVAILABLE", "REJECTED", "FAILED"]),
    errorCode: z
      .enum([
        "SOURCE_UNAVAILABLE",
        "UNSUPPORTED_FORMAT",
        "SIZE_LIMIT",
        "CHECKSUM_MISMATCH",
        "SCAN_REJECTED",
        "SCAN_PENDING",
        "TRANSFER_FAILED",
        "SOURCE_CHANGED",
      ])
      .nullable(),
    name: z.string().max(255).nullable(),
    mimeType: z.string().max(160).nullable(),
    size: z.number().int().positive().max(262144000).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === "AVAILABLE" &&
      (value.fileId === null ||
        value.errorCode !== null ||
        value.name === null ||
        value.mimeType === null ||
        value.size === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Available attachment requires verified file metadata",
      });
    }
  });
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
    attachments: z.array(HistoricalConversationAttachmentSchema).default([]),
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
export const AssignHistoricalConversationSchema = z
  .object({
    assigneeMemberId: z.string().uuid(),
    expectedAssigneeMemberId: z.string().uuid().nullable(),
  })
  .strict();
export const HistoricalConversationMessageListResponseSchema = z
  .object({
    data: z.array(HistoricalConversationMessageSchema),
    page: PageSchema,
  })
  .strict();
export type HistoricalConversation = z.infer<typeof HistoricalConversationSchema>;
export type HistoricalConversationMessage = z.infer<typeof HistoricalConversationMessageSchema>;
export type HistoricalConversationAttachment = z.infer<
  typeof HistoricalConversationAttachmentSchema
>;
