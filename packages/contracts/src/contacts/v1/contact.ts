import { z } from "zod";

export const ContactIdSchema = z.string().uuid();
const TextSchema = z.string().trim().min(1).max(160);
const LabelTextSchema = z.string().trim().min(1).max(80);
const EmailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .transform((value) => value.toLowerCase());
const PhoneSchema = z.string().trim().min(3).max(40);
const TimestampSchema = z.string().datetime({ offset: true });
export const ContactChannelSchema = z.enum(["EMAIL", "PHONE", "NONE"]);
export const ContactSourceSchema = z.enum([
  "MANUAL",
  "IMPORT",
  "FORM",
  "CONVERSATION",
  "API",
  "MIGRATION",
  "OTHER",
]);
export const ContactSortSchema = z.enum(["UPDATED_DESC", "CREATED_DESC", "NAME_ASC"]);
export const ContactAssignmentSchema = z.enum(["UNASSIGNED"]);
const ContactFilterDateSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date");

const BooleanQuerySchema = z
  .union([z.literal("true"), z.literal("false"), z.boolean()])
  .transform((value) => value === true || value === "true");

export const ContactLabelSchema = z.object({
  id: ContactIdSchema,
  name: LabelTextSchema,
});

export const ContactSchema = z.object({
  id: ContactIdSchema,
  ownerMemberId: ContactIdSchema.nullable(),
  displayName: TextSchema,
  email: EmailSchema.nullable(),
  phone: PhoneSchema.nullable(),
  labels: z.array(ContactLabelSchema),
  source: ContactSourceSchema,
  archivedAt: TimestampSchema.nullable(),
  version: z.string().regex(/^[1-9][0-9]*$/u),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export const ContactResponseSchema = z.object({ data: ContactSchema });
export const ContactListPageSchema = z.object({
  limit: z.number().int().min(1).max(100),
  nextCursor: z.string().min(1).max(2_048).nullable(),
  previousCursor: z.string().min(1).max(2_048).nullable(),
  total: z.number().int().nonnegative(),
});
export const ContactListResponseSchema = z.object({
  data: z.array(ContactSchema),
  page: ContactListPageSchema,
});
export const ContactListQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(160).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().min(1).max(2_048).optional(),
    sort: ContactSortSchema.default("UPDATED_DESC"),
    label: z.string().trim().min(1).max(80).optional(),
    pipelineId: ContactIdSchema.optional(),
    ownerMemberId: ContactIdSchema.optional(),
    channel: ContactChannelSchema.optional(),
    source: ContactSourceSchema.optional(),
    archived: BooleanQuerySchema.default(false),
    assignment: ContactAssignmentSchema.optional(),
    createdFrom: ContactFilterDateSchema.optional(),
    createdTo: ContactFilterDateSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.createdFrom === undefined ||
      value.createdTo === undefined ||
      Date.parse(value.createdFrom) <= Date.parse(value.createdTo),
    { message: "createdFrom must be before createdTo", path: ["createdFrom"] },
  );
export const CreateContactSchema = z
  .object({
    displayName: TextSchema,
    email: EmailSchema.optional(),
    phone: PhoneSchema.optional(),
    ownerMemberId: ContactIdSchema.nullable().optional(),
    source: ContactSourceSchema.optional(),
    labelIds: z.array(ContactIdSchema).min(1).max(40).optional(),
  })
  .strict();
/**
 * Creation omits optional contact channels, while an update can explicitly
 * remove an existing one.  `undefined` means "leave unchanged" and `null`
 * means "clear"; that distinction is preserved through the BFF and domain.
 */
export const UpdateContactSchema = z
  .object({
    displayName: TextSchema.optional(),
    email: EmailSchema.nullable().optional(),
    phone: PhoneSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one contact field is required");

export const CreateContactLabelSchema = z.object({ name: LabelTextSchema }).strict();
export const ContactLabelResponseSchema = z.object({ data: ContactLabelSchema });
export const ContactLabelListResponseSchema = z.object({ data: z.array(ContactLabelSchema) });

const ContactIdsSchema = z
  .array(ContactIdSchema)
  .min(1)
  .max(100)
  .transform((ids) => [...new Set(ids)]);
export const ContactBulkActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("ASSIGN"),
      contactIds: ContactIdsSchema,
      ownerMemberId: ContactIdSchema.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("ADD_LABEL"),
      contactIds: ContactIdsSchema,
      labelId: ContactIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("REMOVE_LABEL"),
      contactIds: ContactIdsSchema,
      labelId: ContactIdSchema,
    })
    .strict(),
  z.object({ action: z.literal("ARCHIVE"), contactIds: ContactIdsSchema }).strict(),
  z.object({ action: z.literal("RESTORE"), contactIds: ContactIdsSchema }).strict(),
]);
export const ContactBulkActionResultSchema = z.object({
  contactId: ContactIdSchema,
  status: z.enum(["UPDATED", "UNCHANGED", "NOT_VISIBLE"]),
});
export const ContactBulkActionResponseSchema = z.object({
  data: z.object({
    results: z.array(ContactBulkActionResultSchema),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    notVisible: z.number().int().nonnegative(),
  }),
});

export const ContactImportFileSchema = z.object({
  fileName: z.string().trim().min(1).max(160),
  contentBase64: z.string().min(1).max(8_000_000),
});
export const ContactImportPreviewRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  displayName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  status: z.enum(["VALID", "MATCH", "ERROR"]),
  contactId: ContactIdSchema.nullable(),
  errors: z.array(z.string()),
});
export const ContactImportPreviewResponseSchema = z.object({
  data: z.object({
    rows: z.array(ContactImportPreviewRowSchema),
    validRows: z.number().int().nonnegative(),
    errorRows: z.number().int().nonnegative(),
    matches: z.number().int().nonnegative(),
  }),
});
export const ContactImportApplyResponseSchema = z.object({
  data: z.object({
    rows: z.array(
      ContactImportPreviewRowSchema.extend({ status: z.enum(["CREATED", "UPDATED", "ERROR"]) }),
    ),
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  }),
});
export type Contact = z.infer<typeof ContactSchema>;
export type ContactChannel = z.infer<typeof ContactChannelSchema>;
export type ContactSource = z.infer<typeof ContactSourceSchema>;
export type ContactSort = z.infer<typeof ContactSortSchema>;
export type ContactLabel = z.infer<typeof ContactLabelSchema>;
export type ContactListQuery = z.infer<typeof ContactListQuerySchema>;
export type CreateContact = z.infer<typeof CreateContactSchema>;
export type UpdateContact = z.infer<typeof UpdateContactSchema>;
export type CreateContactLabel = z.infer<typeof CreateContactLabelSchema>;
export type ContactBulkAction = z.infer<typeof ContactBulkActionSchema>;
export type ContactImportFile = z.infer<typeof ContactImportFileSchema>;
export type ContactImportPreviewRow = z.infer<typeof ContactImportPreviewRowSchema>;
