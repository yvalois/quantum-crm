import { z } from "zod";

const IdSchema = z.string().uuid();
const VersionSchema = z.string().regex(/^[1-9][0-9]*$/u);
const TimestampSchema = z.string().datetime({ offset: true });
const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/u);
const ChecksumSchema = z.string().regex(/^(?:sha256:[0-9a-f]{64}|[A-Za-z0-9+/]{43}=)$/u);

export const CommercialDocumentKindSchema = z.enum(["QUOTE", "INVOICE"]);
export const CommercialDocumentStatusSchema = z.enum(["DRAFT"]);

const BlockBaseSchema = z.object({
  id: IdSchema,
  locked: z.boolean().default(false),
});

export const TextDocumentBlockSchema = BlockBaseSchema.extend({
  type: z.literal("TEXT"),
  content: z.string().max(20_000),
  align: z.enum(["LEFT", "CENTER", "RIGHT"]).default("LEFT"),
}).strict();

const ImageDocumentBlockBaseSchema = BlockBaseSchema.extend({
  type: z.literal("IMAGE"),
  label: z.string().trim().min(1).max(120),
  alt: z.string().trim().max(300),
  caption: z.string().trim().max(500),
  fileId: IdSchema.nullable(),
  checksum: ChecksumSchema.nullable(),
  /** A protected template may still expose this image as an instance-level slot. */
  replaceable: z.boolean().default(false),
  /** A replaceable slot can be intentionally omitted from one document instance. */
  visible: z.boolean().default(true),
}).strict();
export const ImageDocumentBlockSchema = ImageDocumentBlockBaseSchema.refine(
  (value) => (value.fileId === null) === (value.checksum === null),
  {
    message: "fileId and checksum must be supplied together",
  },
);

const AttachmentDocumentBlockBaseSchema = BlockBaseSchema.extend({
  type: z.literal("ATTACHMENT"),
  label: z.string().trim().min(1).max(160),
  fileId: IdSchema.nullable(),
  checksum: ChecksumSchema.nullable(),
  mimeType: z.string().trim().max(160),
  originalName: z.string().trim().max(255),
}).strict();
export const AttachmentDocumentBlockSchema = AttachmentDocumentBlockBaseSchema.superRefine(
  (value, context) => {
    if ((value.fileId === null) !== (value.checksum === null)) {
      context.addIssue({
        code: "custom",
        message: "fileId and checksum must be supplied together",
      });
    }
    if (value.fileId !== null && (value.mimeType.length < 1 || value.originalName.length < 1)) {
      context.addIssue({
        code: "custom",
        message: "Attached files require mimeType and originalName",
      });
    }
  },
);

const TableDocumentBlockBaseSchema = BlockBaseSchema.extend({
  type: z.literal("TABLE"),
  columns: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
  rows: z.array(z.array(z.string().max(2_000)).min(1).max(8)).max(100),
}).strict();
export const TableDocumentBlockSchema = TableDocumentBlockBaseSchema.refine(
  (value) => value.rows.every((row) => row.length === value.columns.length),
  {
    message: "Every row must match the table columns",
  },
);

const ColumnsDocumentBlockBaseSchema = BlockBaseSchema.extend({
  type: z.literal("COLUMNS"),
  columns: z.array(z.string().max(10_000)).min(2).max(3),
  layout: z.enum(["EQUAL_2", "LEFT_WIDE", "RIGHT_WIDE", "EQUAL_3"]).default("EQUAL_2"),
}).strict();
export const ColumnsDocumentBlockSchema = ColumnsDocumentBlockBaseSchema.refine(
  (value) => value.columns.length === (value.layout === "EQUAL_3" ? 3 : 2),
  { message: "Column count must match the selected layout" },
);

export const DividerDocumentBlockSchema = BlockBaseSchema.extend({
  type: z.literal("DIVIDER"),
  style: z.enum(["SOLID", "DASHED", "DOTTED"]).default("SOLID"),
}).strict();

export const TermsDocumentBlockSchema = BlockBaseSchema.extend({
  type: z.literal("TERMS"),
  title: z.string().trim().min(1).max(160),
  content: z.string().max(20_000),
}).strict();

export const VariableDocumentBlockSchema = BlockBaseSchema.extend({
  type: z.literal("VARIABLE"),
  key: z.string().regex(/^[a-z][a-z0-9_.]{1,119}$/u),
  label: z.string().trim().min(1).max(160),
  fallback: z.string().max(500),
  /** Snapshot value resolved when a template is instantiated; never a live data lookup. */
  value: z.string().max(500).nullable().default(null),
  /** Allows only the resolved value to be changed in an instance of a protected template. */
  editable: z.boolean().default(false),
}).strict();

const SignatureDocumentBlockBaseSchema = BlockBaseSchema.extend({
  type: z.literal("SIGNATURE"),
  label: z.string().trim().min(1).max(160),
  fileId: IdSchema.nullable(),
  checksum: ChecksumSchema.nullable(),
}).strict();
export const SignatureDocumentBlockSchema = SignatureDocumentBlockBaseSchema.refine(
  (value) => (value.fileId === null) === (value.checksum === null),
  {
    message: "fileId and checksum must be supplied together",
  },
);

export const DocumentBlockSchema = z
  .discriminatedUnion("type", [
    TextDocumentBlockSchema,
    ImageDocumentBlockBaseSchema,
    AttachmentDocumentBlockBaseSchema,
    TableDocumentBlockBaseSchema,
    ColumnsDocumentBlockBaseSchema,
    DividerDocumentBlockSchema,
    TermsDocumentBlockSchema,
    VariableDocumentBlockSchema,
    SignatureDocumentBlockBaseSchema,
  ])
  .superRefine((value, context) => {
    if (
      (value.type === "IMAGE" || value.type === "SIGNATURE") &&
      (value.fileId === null) !== (value.checksum === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "fileId and checksum must be supplied together",
      });
    }
    if (value.type === "ATTACHMENT") {
      if ((value.fileId === null) !== (value.checksum === null)) {
        context.addIssue({
          code: "custom",
          message: "fileId and checksum must be supplied together",
        });
      }
      if (value.fileId !== null && (value.mimeType.length < 1 || value.originalName.length < 1)) {
        context.addIssue({
          code: "custom",
          message: "Attached files require mimeType and originalName",
        });
      }
    }
    if (
      value.type === "COLUMNS" &&
      value.columns.length !== (value.layout === "EQUAL_3" ? 3 : 2)
    ) {
      context.addIssue({
        code: "custom",
        message: "Column count must match the selected layout",
      });
    }
    if (value.type === "TABLE" && value.rows.some((row) => row.length !== value.columns.length)) {
      context.addIssue({ code: "custom", message: "Every row must match the table columns" });
    }
  });

export const DocumentDesignSchema = z
  .object({
    accentColor: ColorSchema,
    textColor: ColorSchema,
    fontFamily: z.enum(["INSTRUMENT_SANS", "SERIF", "MONO"]),
    pageSize: z.enum(["A4", "LETTER"]),
    headerText: z.string().max(500),
    footerText: z.string().max(500),
    showPageNumbers: z.boolean(),
    logoFileId: IdSchema.nullable(),
    logoChecksum: ChecksumSchema.nullable(),
    backgroundFileId: IdSchema.nullable(),
    backgroundChecksum: ChecksumSchema.nullable(),
  })
  .strict()
  .refine((value) => (value.logoFileId === null) === (value.logoChecksum === null), {
    message: "Logo fileId and checksum must be supplied together",
  })
  .refine((value) => (value.backgroundFileId === null) === (value.backgroundChecksum === null), {
    message: "Background fileId and checksum must be supplied together",
  });

export const CommercialDocumentSchema = z
  .object({
    id: IdSchema,
    kind: CommercialDocumentKindSchema,
    status: CommercialDocumentStatusSchema,
    title: z.string().trim().min(1).max(240),
    contactId: IdSchema.nullable(),
    opportunityId: IdSchema.nullable(),
    ownerMemberId: IdSchema,
    sourceTemplateId: IdSchema.nullable(),
    blocks: z.array(DocumentBlockSchema).max(250),
    design: DocumentDesignSchema,
    revision: z.number().int().positive(),
    version: VersionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const DocumentTemplateSchema = z
  .object({
    id: IdSchema,
    kind: CommercialDocumentKindSchema,
    name: z.string().trim().min(1).max(180),
    blocks: z.array(DocumentBlockSchema).max(250),
    design: DocumentDesignSchema,
    revision: z.number().int().positive(),
    version: VersionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const DocumentListQuerySchema = z
  .object({
    kind: CommercialDocumentKindSchema.optional(),
    status: CommercialDocumentStatusSchema.optional(),
  })
  .strict();

export const CreateDocumentSchema = z
  .object({
    kind: CommercialDocumentKindSchema,
    title: z.string().trim().min(1).max(240),
    contactId: IdSchema.nullable().optional(),
    opportunityId: IdSchema.nullable().optional(),
    templateId: IdSchema.optional(),
    blocks: z.array(DocumentBlockSchema).max(250).optional(),
    design: DocumentDesignSchema.optional(),
  })
  .strict()
  .refine((value) => value.templateId === undefined || value.blocks === undefined, {
    message: "A template and explicit blocks cannot be combined",
  });

export const UpdateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    contactId: IdSchema.nullable().optional(),
    opportunityId: IdSchema.nullable().optional(),
    blocks: z.array(DocumentBlockSchema).max(250).optional(),
    design: DocumentDesignSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const DuplicateDocumentSchema = z
  .object({ title: z.string().trim().min(1).max(240).optional() })
  .strict();

export const CreateDocumentTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(180),
    sourceDocumentId: IdSchema,
  })
  .strict();

export const UpdateDocumentTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(180).optional(),
    blocks: z.array(DocumentBlockSchema).max(250).optional(),
    design: DocumentDesignSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const DocumentResponseSchema = z.object({ data: CommercialDocumentSchema }).strict();
export const DocumentListResponseSchema = z
  .object({ data: z.array(CommercialDocumentSchema).max(500) })
  .strict();
export const DocumentTemplateResponseSchema = z.object({ data: DocumentTemplateSchema }).strict();
export const DocumentTemplateListResponseSchema = z
  .object({ data: z.array(DocumentTemplateSchema).max(500) })
  .strict();

export type CommercialDocument = z.infer<typeof CommercialDocumentSchema>;
export type CommercialDocumentKind = z.infer<typeof CommercialDocumentKindSchema>;
export type DocumentBlock = z.infer<typeof DocumentBlockSchema>;
export type DocumentDesign = z.infer<typeof DocumentDesignSchema>;
export type DocumentTemplate = z.infer<typeof DocumentTemplateSchema>;
export type CreateDocument = z.infer<typeof CreateDocumentSchema>;
export type UpdateDocument = z.infer<typeof UpdateDocumentSchema>;
