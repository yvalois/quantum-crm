import { z } from "zod";

export const ContactIdSchema = z.string().uuid();
const TextSchema = z.string().trim().min(1).max(160);
const EmailSchema = z.string().trim().email().max(320).transform((value) => value.toLowerCase());
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
export const CreateContactSchema = z.object({
  displayName: TextSchema,
  email: EmailSchema.optional(),
  phone: PhoneSchema.optional(),
}).strict();
/**
 * Creation omits optional contact channels, while an update can explicitly
 * remove an existing one.  `undefined` means "leave unchanged" and `null`
 * means "clear"; that distinction is preserved through the BFF and domain.
 */
export const UpdateContactSchema = z.object({
  displayName: TextSchema.optional(),
  email: EmailSchema.nullable().optional(),
  phone: PhoneSchema.nullable().optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "At least one contact field is required",
);
export type Contact = z.infer<typeof ContactSchema>;
export type CreateContact = z.infer<typeof CreateContactSchema>;
export type UpdateContact = z.infer<typeof UpdateContactSchema>;
