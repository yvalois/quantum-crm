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
  /** Starts a new physical sheet before this block when composing a paginated document. */
  breakBefore: z.boolean().optional(),
});

export const TextDocumentBlockSchema = BlockBaseSchema.extend({
  type: z.literal("TEXT"),
  content: z.string().max(20_000),
  align: z.enum(["LEFT", "CENTER", "RIGHT"]).default("LEFT"),
  /** Optional for documents created before rich block formatting existed. */
  style: z.enum(["BODY", "TITLE", "SUBTITLE", "CAPTION"]).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  fontFamily: z.enum(["INHERIT", "SANS", "SERIF", "MONO"]).optional(),
  fontSize: z.number().int().min(8).max(96).optional(),
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
  width: z.enum(["FULL", "WIDE", "MEDIUM", "SMALL"]).default("FULL"),
  /** Exact frame width used by the visual composer. Legacy presets remain supported. */
  widthPercent: z.number().finite().positive().optional(),
  /** Exact frame height after a free vertical resize. Omitted means automatic height. */
  heightPx: z.number().finite().positive().optional(),
  align: z.enum(["LEFT", "CENTER", "RIGHT"]).default("CENTER"),
  fit: z.enum(["CONTAIN", "COVER"]).default("CONTAIN"),
  aspectRatio: z
    .enum(["AUTO", "FREE", "SQUARE", "LANDSCAPE_4_3", "WIDE_16_9", "PORTRAIT_3_4", "CIRCLE"])
    .optional(),
  focalX: z.number().int().min(0).max(100).optional(),
  focalY: z.number().int().min(0).max(100).optional(),
  rotation: z.number().int().min(-180).max(180).optional(),
  opacity: z.number().int().min(20).max(100).optional(),
  cornerRadius: z.number().int().min(0).max(48).optional(),
  /** Top-level images may participate in document flow; nested images stay inline. */
  flow: z.enum(["INLINE", "FLOAT_LEFT", "FLOAT_RIGHT"]).optional(),
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

const TableCellBorderSideSchema = z
  .object({
    style: z.enum(["NONE", "SOLID", "DASHED", "DOTTED"]).default("SOLID"),
    color: ColorSchema.default("#000000"),
    width: z.number().finite().min(0).max(12).default(1),
  })
  .strict();

/** Presentation deliberately lives with the cell, never with the page renderer. */
export const TableCellStyleSchema = z
  .object({
    horizontalAlign: z.enum(["LEFT", "CENTER", "RIGHT"]).optional(),
    verticalAlign: z.enum(["TOP", "MIDDLE", "BOTTOM"]).optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    fontFamily: z.enum(["INHERIT", "SANS", "SERIF", "MONO"]).optional(),
    fontSize: z.number().int().min(8).max(96).optional(),
    color: ColorSchema.optional(),
    backgroundColor: ColorSchema.optional(),
    paddingMm: z.number().finite().min(0).max(40).optional(),
    borders: z
      .object({
        top: TableCellBorderSideSchema.optional(),
        right: TableCellBorderSideSchema.optional(),
        bottom: TableCellBorderSideSchema.optional(),
        left: TableCellBorderSideSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const TableGridColumnSchema = z
  .object({
    id: IdSchema,
    widthPercent: z.number().int().min(5).max(100),
  })
  .strict();

export const TableGridCellSchema = z
  .object({
    id: IdSchema,
    column: z.number().int().min(0).max(7),
    colSpan: z.number().int().min(1).max(8).default(1),
    rowSpan: z.number().int().min(1).max(100).default(1),
    content: z.string().max(20_000),
    style: TableCellStyleSchema.optional(),
  })
  .strict();

export const TableGridRowSchema = z
  .object({
    id: IdSchema,
    section: z.enum(["HEADER", "BODY", "FOOTER"]).default("BODY"),
    heightMm: z.number().finite().positive().max(240).optional(),
    cells: z.array(TableGridCellSchema).min(1).max(8),
  })
  .strict();

export const TableGridSchema = z
  .object({
    columns: z.array(TableGridColumnSchema).min(1).max(8),
    rows: z.array(TableGridRowSchema).min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.columns.reduce((total, column) => total + column.widthPercent, 0) !== 100) {
      context.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Grid column widths must total 100",
      });
    }
    const ids = new Set<string>();
    const occupied = new Set<string>();
    for (const [columnIndex, column] of value.columns.entries()) {
      if (ids.has(column.id)) {
        context.addIssue({
          code: "custom",
          path: ["columns", columnIndex, "id"],
          message: "Grid IDs must be unique",
        });
      }
      ids.add(column.id);
    }
    for (const [rowIndex, row] of value.rows.entries()) {
      if (ids.has(row.id)) {
        context.addIssue({
          code: "custom",
          path: ["rows", rowIndex, "id"],
          message: "Grid IDs must be unique",
        });
      }
      ids.add(row.id);
      for (const [cellIndex, cell] of row.cells.entries()) {
        if (ids.has(cell.id)) {
          context.addIssue({
            code: "custom",
            path: ["rows", rowIndex, "cells", cellIndex, "id"],
            message: "Grid IDs must be unique",
          });
        }
        ids.add(cell.id);
        if (
          cell.column + cell.colSpan > value.columns.length ||
          rowIndex + cell.rowSpan > value.rows.length
        ) {
          context.addIssue({
            code: "custom",
            path: ["rows", rowIndex, "cells", cellIndex],
            message: "Cell span must stay within the grid",
          });
          continue;
        }
        for (let coveredRow = rowIndex; coveredRow < rowIndex + cell.rowSpan; coveredRow += 1) {
          for (
            let coveredColumn = cell.column;
            coveredColumn < cell.column + cell.colSpan;
            coveredColumn += 1
          ) {
            const coordinate = `${coveredRow}:${coveredColumn}`;
            if (occupied.has(coordinate)) {
              context.addIssue({
                code: "custom",
                path: ["rows", rowIndex, "cells", cellIndex],
                message: "Grid cells must not overlap",
              });
            }
            occupied.add(coordinate);
          }
        }
      }
    }
    for (let rowIndex = 0; rowIndex < value.rows.length; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < value.columns.length; columnIndex += 1) {
        if (!occupied.has(`${rowIndex}:${columnIndex}`)) {
          context.addIssue({
            code: "custom",
            path: ["rows", rowIndex],
            message: "Every grid coordinate must be covered by exactly one cell",
          });
          return;
        }
      }
    }
  });

const TableDocumentBlockBaseSchema = BlockBaseSchema.extend({
  type: z.literal("TABLE"),
  columns: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
  rows: z.array(z.array(z.string().max(2_000)).min(1).max(8)).max(100),
  /** Percentage widths. Legacy tables without widths are normalized by the editor. */
  columnWidths: z.array(z.number().int().min(5).max(100)).min(1).max(8).optional(),
  /** V2 grid. Legacy columns/rows remain required as a compatibility projection. */
  grid: TableGridSchema.optional(),
}).strict();
export const TableDocumentBlockSchema = TableDocumentBlockBaseSchema.superRefine(
  (value, context) => {
    if (value.rows.some((row) => row.length !== value.columns.length)) {
      context.addIssue({ code: "custom", message: "Every row must match the table columns" });
    }
    if (
      value.columnWidths !== undefined &&
      (value.columnWidths.length !== value.columns.length ||
        value.columnWidths.reduce((total, width) => total + width, 0) !== 100)
    ) {
      context.addIssue({
        code: "custom",
        message: "Column widths must match the table columns and total 100",
      });
    }
  },
);

export const DividerDocumentBlockSchema = BlockBaseSchema.extend({
  type: z.literal("DIVIDER"),
  style: z.enum(["SOLID", "DASHED", "DOTTED"]).default("SOLID"),
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

export const DocumentColumnItemSchema = z
  .discriminatedUnion("type", [
    TextDocumentBlockSchema,
    ImageDocumentBlockBaseSchema,
    DividerDocumentBlockSchema,
    VariableDocumentBlockSchema,
  ])
  .superRefine((value, context) => {
    if (value.type === "IMAGE" && (value.fileId === null) !== (value.checksum === null)) {
      context.addIssue({
        code: "custom",
        message: "fileId and checksum must be supplied together",
      });
    }
  });

export const DocumentColumnCellSchema = z
  .object({
    id: IdSchema,
    items: z.array(DocumentColumnItemSchema).max(24),
  })
  .strict();

function columnItemProjection(item: z.infer<typeof DocumentColumnItemSchema>): string {
  if (item.type === "TEXT") return item.content;
  if (item.type === "VARIABLE") return item.value ?? `{{${item.key}}}`;
  if (item.type === "IMAGE") return item.label ? `[Imagen: ${item.label}]` : "[Imagen]";
  return "---";
}

const ColumnsDocumentBlockBaseSchema = BlockBaseSchema.extend({
  type: z.literal("COLUMNS"),
  columns: z.array(z.string().max(500_000)).min(2).max(3),
  layout: z.enum(["EQUAL_2", "LEFT_WIDE", "RIGHT_WIDE", "EQUAL_3"]).default("EQUAL_2"),
  cells: z.array(DocumentColumnCellSchema).min(2).max(3).optional(),
}).strict();
export const ColumnsDocumentBlockSchema = ColumnsDocumentBlockBaseSchema.refine(
  (value) => {
    const count = value.layout === "EQUAL_3" ? 3 : 2;
    return (
      value.columns.length === count && (value.cells === undefined || value.cells.length === count)
    );
  },
  { message: "Column count must match the selected layout" },
).superRefine((value, context) => {
  if (!value.cells) return;
  const ids = new Set<string>();
  for (const [cellIndex, cell] of value.cells.entries()) {
    if (ids.has(cell.id)) {
      context.addIssue({ code: "custom", message: "Column cell and item IDs must be unique" });
    }
    ids.add(cell.id);
    for (const item of cell.items) {
      if (ids.has(item.id)) {
        context.addIssue({ code: "custom", message: "Column cell and item IDs must be unique" });
      }
      ids.add(item.id);
      if (item.locked) {
        context.addIssue({
          code: "custom",
          message: "Nested items inherit protection from their column block",
        });
      }
    }
    const projected = cell.items.map(columnItemProjection).filter(Boolean).join("\n\n");
    if (value.columns[cellIndex] !== projected) {
      context.addIssue({ code: "custom", message: "Column projection does not match its items" });
    }
  }
});

export const TermsDocumentBlockSchema = BlockBaseSchema.extend({
  type: z.literal("TERMS"),
  title: z.string().trim().min(1).max(160),
  content: z.string().max(20_000),
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
    if (value.type === "COLUMNS" && value.columns.length !== (value.layout === "EQUAL_3" ? 3 : 2)) {
      context.addIssue({
        code: "custom",
        message: "Column count must match the selected layout",
      });
    }
    if (
      value.type === "COLUMNS" &&
      value.cells !== undefined &&
      value.cells.length !== (value.layout === "EQUAL_3" ? 3 : 2)
    ) {
      context.addIssue({
        code: "custom",
        message: "Column cell count must match the selected layout",
      });
    }
    if (value.type === "COLUMNS" && value.cells) {
      const ids = new Set<string>();
      for (const [cellIndex, cell] of value.cells.entries()) {
        if (ids.has(cell.id)) {
          context.addIssue({ code: "custom", message: "Column cell and item IDs must be unique" });
        }
        ids.add(cell.id);
        for (const item of cell.items) {
          if (ids.has(item.id)) {
            context.addIssue({
              code: "custom",
              message: "Column cell and item IDs must be unique",
            });
          }
          ids.add(item.id);
          if (item.locked) {
            context.addIssue({
              code: "custom",
              message: "Nested items inherit protection from their column block",
            });
          }
        }
        const projected = cell.items.map(columnItemProjection).filter(Boolean).join("\n\n");
        if (value.columns[cellIndex] !== projected) {
          context.addIssue({
            code: "custom",
            message: "Column projection does not match its items",
          });
        }
      }
    }
    if (value.type === "TABLE" && value.rows.some((row) => row.length !== value.columns.length)) {
      context.addIssue({ code: "custom", message: "Every row must match the table columns" });
    }
    if (
      value.type === "TABLE" &&
      value.columnWidths !== undefined &&
      (value.columnWidths.length !== value.columns.length ||
        value.columnWidths.reduce((total, width) => total + width, 0) !== 100)
    ) {
      context.addIssue({
        code: "custom",
        message: "Column widths must match the table columns and total 100",
      });
    }
  });

export const DocumentDesignSchema = z
  .object({
    accentColor: ColorSchema,
    textColor: ColorSchema,
    fontFamily: z.enum(["INSTRUMENT_SANS", "SERIF", "MONO"]),
    pageSize: z.enum(["A4", "LETTER"]),
    margins: z
      .object({
        top: z.number().int().min(8).max(60),
        right: z.number().int().min(8).max(60),
        bottom: z.number().int().min(8).max(60),
        left: z.number().int().min(8).max(60),
      })
      .strict()
      .default({ top: 20, right: 18, bottom: 20, left: 18 }),
    headerText: z.string().max(500),
    /** Independent right-hand reference in a split commercial header. */
    headerRightText: z.string().max(500).default(""),
    footerText: z.string().max(500),
    showPageNumbers: z.boolean(),
    headerEnabled: z.boolean().default(true),
    headerLayout: z.enum(["TEXT", "LOGO_TEXT", "SPLIT"]).default("SPLIT"),
    headerAlign: z.enum(["LEFT", "CENTER", "RIGHT"]).default("LEFT"),
    headerSpacing: z.enum(["COMPACT", "NORMAL", "SPACIOUS"]).default("NORMAL"),
    /** Placement of the generic image on the editable header canvas. */
    headerImagePlacement: z
      .object({
        leftPercent: z.number().finite().min(0).max(100),
        topPx: z.number().finite().min(0),
        widthPercent: z.number().finite().positive().max(100),
        heightPx: z.number().finite().positive(),
      })
      .strict()
      .optional(),
    showDocumentKind: z.boolean().default(true),
    /** Legacy documents show this fixed identity region; new blank documents can omit it. */
    identityEnabled: z.boolean().optional(),
    footerEnabled: z.boolean().default(true),
    footerAlign: z.enum(["LEFT", "CENTER", "RIGHT"]).default("LEFT"),
    footerSpacing: z.enum(["COMPACT", "NORMAL", "SPACIOUS"]).default("NORMAL"),
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
export type DocumentColumnCell = z.infer<typeof DocumentColumnCellSchema>;
export type DocumentColumnItem = z.infer<typeof DocumentColumnItemSchema>;
export type DocumentDesign = z.infer<typeof DocumentDesignSchema>;
export type DocumentTemplate = z.infer<typeof DocumentTemplateSchema>;
export type CreateDocument = z.infer<typeof CreateDocumentSchema>;
export type UpdateDocument = z.infer<typeof UpdateDocumentSchema>;
