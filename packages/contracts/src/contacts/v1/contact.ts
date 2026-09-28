import { z } from "zod";

export const ContactIdSchema = z.string().uuid();
const TextSchema = z.string().trim().min(1).max(160);
const EmailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .transform((value) => value.toLowerCase());
const PhoneSchema = z.string().trim().min(3).max(40);
const TimestampSchema = z.string().datetime({ offset: true });

export const ContactSchema = z.object({
  id: ContactIdSchema,
  displayName: TextSchema,
  email: EmailSchema.nullable(),
  phone: PhoneSchema.nullable(),
  version: z.string().regex(/^[1-9][0-9]*$/u),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export const ContactResponseSchema = z.object({ data: ContactSchema });
export const ContactListResponseSchema = z.object({ data: z.array(ContactSchema) });
export const CreateContactSchema = z
  .object({
    displayName: TextSchema,
    email: EmailSchema.optional(),
    phone: PhoneSchema.optional(),
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
export type CreateContact = z.infer<typeof CreateContactSchema>;
export type UpdateContact = z.infer<typeof UpdateContactSchema>;
export type ContactImportFile = z.infer<typeof ContactImportFileSchema>;
export type ContactImportPreviewRow = z.infer<typeof ContactImportPreviewRowSchema>;
