import { z } from "zod";
import { DocumentBlockSchema, DocumentDesignSchema } from "../../documents/v1/document.js";

const IdSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });
const VersionSchema = z.string().regex(/^[1-9][0-9]*$/u);
const BodySchema = z.string().trim().min(1).max(16_000);

/** Immutable content captured when a document is attached to a conversation message. */
export const ConversationDocumentSnapshotSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(["QUOTE", "INVOICE"]),
    title: z.string().trim().min(1).max(240),
    sourceTemplateId: IdSchema.nullable(),
    revision: z.number().int().positive(),
    blocks: z.array(DocumentBlockSchema).max(250),
    design: DocumentDesignSchema,
  })
  .strict();

export const ConversationChannelSchema = z.enum(["EMAIL", "WHATSAPP", "WEBCHAT", "SMS"]);
export const ConversationStatusSchema = z.enum(["OPEN", "PENDING", "ESCALATED", "CLOSED"]);
export const ConversationAttentionModeSchema = z.enum(["AGENT", "HUMAN"]);
export const ConversationMessageDirectionSchema = z.enum(["INBOUND", "OUTBOUND", "INTERNAL"]);
export const ConversationMessageKindSchema = z.enum([
  "TEXT",
  "IMAGE",
  "AUDIO",
  "DOCUMENT",
  "SYSTEM",
]);
export const ConversationDeliveryStatusSchema = z.enum([
  "RECEIVED",
  "QUEUED",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
  "UNKNOWN",
  "NOT_APPLICABLE",
]);

export const ConversationSchema = z
  .object({
    id: IdSchema,
    contactId: IdSchema,
    channel: ConversationChannelSchema,
    externalThreadId: z.string().trim().min(1).max(512).nullable(),
    assigneeMemberId: IdSchema.nullable(),
    status: ConversationStatusSchema,
    attentionMode: ConversationAttentionModeSchema,
    subject: z.string().trim().min(1).max(240).nullable(),
    lastMessagePreview: z.string().max(280).nullable(),
    lastMessageAt: TimestampSchema.nullable(),
    unreadCount: z.number().int().min(0),
    version: VersionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const ConversationMessageSchema = z
  .object({
    id: IdSchema,
    conversationId: IdSchema,
    sequence: z.string().regex(/^[1-9][0-9]*$/u),
    direction: ConversationMessageDirectionSchema,
    kind: ConversationMessageKindSchema,
    authorMemberId: IdSchema.nullable(),
    body: BodySchema,
    externalMessageId: z.string().trim().min(1).max(512).nullable(),
    deliveryStatus: ConversationDeliveryStatusSchema,
    failureCode: z.string().trim().min(1).max(120).nullable(),
    documentId: IdSchema.nullable(),
    documentSnapshot: ConversationDocumentSnapshotSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const ConversationHistoryEntrySchema = z
  .object({
    id: IdSchema,
    conversationId: IdSchema,
    eventType: z.enum([
      "CREATED",
      "ASSIGNED",
      "TRANSFERRED",
      "STATUS_CHANGED",
      "ATTENTION_CHANGED",
      "MESSAGE_ADDED",
      "NOTE_ADDED",
    ]),
    actorMemberId: IdSchema,
    previousValue: z.string().max(512).nullable(),
    nextValue: z.string().max(512).nullable(),
    createdAt: TimestampSchema,
  })
  .strict();

export const ConversationListQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    /** Limits the inbox to conversations already linked to one visible contact. */
    contactId: IdSchema.optional(),
    query: z.string().trim().min(1).max(160).optional(),
    channel: ConversationChannelSchema.optional(),
    status: ConversationStatusSchema.optional(),
    attentionMode: ConversationAttentionModeSchema.optional(),
    assigneeMemberId: IdSchema.optional(),
    unassigned: z.coerce.boolean().optional(),
  })
  .strict();

export const CreateConversationSchema = z
  .object({
    contactId: IdSchema,
    channel: ConversationChannelSchema,
    subject: z.string().trim().min(1).max(240).optional(),
    initialMessage: BodySchema,
  })
  .strict();

export const UpdateConversationSchema = z
  .object({
    status: ConversationStatusSchema.optional(),
    attentionMode: ConversationAttentionModeSchema.optional(),
    assigneeMemberId: IdSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const SendConversationMessageSchema = z
  .object({
    body: BodySchema,
    kind: ConversationMessageKindSchema.default("TEXT"),
    documentId: IdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "DOCUMENT" && value.documentId === undefined) {
      context.addIssue({ code: "custom", path: ["documentId"], message: "Document is required" });
    }
    if (value.kind !== "DOCUMENT" && value.documentId !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["documentId"],
        message: "Document is not allowed",
      });
    }
  });
export const CreateConversationNoteSchema = z.object({ body: BodySchema }).strict();

export const QuickReplySchema = z
  .object({
    id: IdSchema,
    title: z.string().trim().min(1).max(120),
    body: BodySchema,
    createdByMemberId: IdSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export const CreateQuickReplySchema = z
  .object({ title: z.string().trim().min(1).max(120), body: BodySchema })
  .strict();

export const ConversationResponseSchema = z.object({ data: ConversationSchema }).strict();
export const ConversationListResponseSchema = z
  .object({
    data: z.array(ConversationSchema),
    page: z.object({ nextCursor: z.string().min(1).max(512).nullable() }).strict(),
  })
  .strict();
export const ConversationMessageResponseSchema = z
  .object({ data: ConversationMessageSchema })
  .strict();
export const ConversationThreadResponseSchema = z
  .object({
    data: z
      .object({
        conversation: ConversationSchema,
        messages: z.array(ConversationMessageSchema),
        history: z.array(ConversationHistoryEntrySchema),
      })
      .strict(),
  })
  .strict();
export const QuickReplyListResponseSchema = z.object({ data: z.array(QuickReplySchema) }).strict();
export const QuickReplyResponseSchema = z.object({ data: QuickReplySchema }).strict();

export type Conversation = z.infer<typeof ConversationSchema>;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export type ConversationHistoryEntry = z.infer<typeof ConversationHistoryEntrySchema>;
export type ConversationListQuery = z.infer<typeof ConversationListQuerySchema>;
export type ConversationChannel = z.infer<typeof ConversationChannelSchema>;
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;
export type ConversationAttentionMode = z.infer<typeof ConversationAttentionModeSchema>;
export type ConversationMessageKind = z.infer<typeof ConversationMessageKindSchema>;
export type ConversationDocumentSnapshot = z.infer<typeof ConversationDocumentSnapshotSchema>;
export type QuickReply = z.infer<typeof QuickReplySchema>;
