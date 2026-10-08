import { z } from "zod";

const UuidSchema = z.string().uuid();
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const VersionSchema = z.string().regex(/^[1-9][0-9]*$/u);
const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/u);

export const FormStatusSchema = z.enum(["DRAFT", "PUBLISHED", "CLOSED"]);
export const FormFieldTypeSchema = z.enum([
  "SHORT_TEXT",
  "LONG_TEXT",
  "NUMBER",
  "EMAIL",
  "PHONE",
  "URL",
  "ADDRESS",
  "DATE",
  "TIME",
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "DROPDOWN",
  "CHECKBOX",
  "SCALE",
  "RATING",
]);
export const FormConditionOperatorSchema = z.enum([
  "EQUALS",
  "NOT_EQUALS",
  "CONTAINS",
  "NOT_EMPTY",
]);

export const FormConditionSchema = z
  .object({
    sourceFieldId: UuidSchema,
    operator: FormConditionOperatorSchema,
    value: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
  })
  .strict();

export const FormFieldSchema = z
  .object({
    id: UuidSchema,
    type: FormFieldTypeSchema,
    label: z.string().trim().min(1).max(240),
    description: z.string().trim().max(1_000).default(""),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(240)).max(100).default([]),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
    condition: FormConditionSchema.nullable().default(null),
  })
  .strict()
  .superRefine((field, context) => {
    const choice = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"].includes(field.type);
    if (choice && field.options.length < 1) {
      context.addIssue({ code: "custom", message: "Choice fields require options" });
    }
    if (!choice && field.options.length > 0) {
      context.addIssue({ code: "custom", message: "This field type cannot define options" });
    }
    if (
      field.minimum !== undefined &&
      field.maximum !== undefined &&
      field.minimum > field.maximum
    ) {
      context.addIssue({ code: "custom", message: "Minimum cannot exceed maximum" });
    }
  });

export const FormSectionSchema = z
  .object({
    id: UuidSchema,
    title: z.string().trim().min(1).max(240),
    description: z.string().trim().max(2_000).default(""),
    fields: z.array(FormFieldSchema).max(200),
  })
  .strict();

export const FormDefinitionSchema = z
  .object({ sections: z.array(FormSectionSchema).min(1).max(50) })
  .strict()
  .superRefine((definition, context) => {
    const fieldIds = definition.sections.flatMap((section) =>
      section.fields.map((field) => field.id),
    );
    if (new Set(fieldIds).size !== fieldIds.length) {
      context.addIssue({ code: "custom", message: "Field identifiers must be unique" });
    }
    const positions = new Map(fieldIds.map((id, index) => [id, index]));
    definition.sections
      .flatMap((section) => section.fields)
      .forEach((field, index) => {
        if (field.condition && (positions.get(field.condition.sourceFieldId) ?? index) >= index) {
          context.addIssue({
            code: "custom",
            message: "Conditions can only reference an earlier field",
          });
        }
      });
  });

export const FormThemeSchema = z
  .object({
    accentColor: ColorSchema.default("#5de1d4"),
    backgroundColor: ColorSchema.default("#07110f"),
    logoFileId: UuidSchema.nullable().default(null),
    heroImageUrl: z.string().url().max(2_048).nullable().default(null),
    headerVideoUrl: z.string().url().max(2_048).nullable().default(null),
    completionMessage: z.string().trim().min(1).max(1_000).default("Respuesta enviada."),
    closedMessage: z.string().trim().min(1).max(1_000).default("Este formulario esta cerrado."),
  })
  .strict();

export const FormSchema = z.object({
  id: UuidSchema,
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{8}$/u),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(4_000),
  status: FormStatusSchema,
  definition: FormDefinitionSchema,
  theme: FormThemeSchema,
  publishedRevision: z.number().int().positive().nullable(),
  closesAt: IsoDateTimeSchema.nullable(),
  version: VersionSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const CreateFormSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    description: z.string().trim().max(4_000).default(""),
    definition: FormDefinitionSchema,
    theme: FormThemeSchema,
    closesAt: IsoDateTimeSchema.nullable().default(null),
  })
  .strict();

export const UpdateFormSchema = CreateFormSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one form field is required" },
);
export const PublishFormSchema = z.object({}).strict();
export const CloseFormSchema = z.object({}).strict();

export const FormResponseSchema = z.object({ data: FormSchema });
export const FormListResponseSchema = z.object({ data: z.array(FormSchema) });

export const FormAnswerValueSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(1_000)).max(100),
]);
export const SubmitFormResponseSchema = z
  .object({
    answers: z.record(UuidSchema, FormAnswerValueSchema),
  })
  .strict();

export const SubmittedFormResponseSchema = z.object({
  id: UuidSchema,
  formId: UuidSchema,
  formRevision: z.number().int().positive(),
  contactId: UuidSchema.nullable(),
  answers: z.record(UuidSchema, FormAnswerValueSchema),
  submittedAt: IsoDateTimeSchema,
});
export const SubmittedFormResponseResponseSchema = z.object({ data: SubmittedFormResponseSchema });
export const SubmittedFormResponseListSchema = z.object({
  data: z.array(SubmittedFormResponseSchema),
});

export const FormResponseListQuerySchema = z.object({
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const PublicFormSchema = FormSchema.pick({
  id: true,
  slug: true,
  title: true,
  description: true,
  definition: true,
  theme: true,
  publishedRevision: true,
  closesAt: true,
});
export const PublicFormResponseSchema = z.object({ data: PublicFormSchema });

export type FormContract = z.infer<typeof FormSchema>;
export type FormDefinition = z.infer<typeof FormDefinitionSchema>;
export type FormField = z.infer<typeof FormFieldSchema>;
export type FormFieldType = z.infer<typeof FormFieldTypeSchema>;
export type FormTheme = z.infer<typeof FormThemeSchema>;
export type FormAnswerValue = z.infer<typeof FormAnswerValueSchema>;
export type SubmittedFormResponse = z.infer<typeof SubmittedFormResponseSchema>;
