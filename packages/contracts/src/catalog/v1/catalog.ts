import { z } from "zod";

const Uuid = z.string().uuid();
const Money = z.string().regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?$/u);
const Rfc3339 = z.string().datetime({ offset: true });

export const CatalogKindSchema = z.enum(["product", "service"]);
export const CatalogAvailabilityModeSchema = z.enum(["unlimited", "stock", "interval_capacity"]);
export const CatalogFieldTypeSchema = z.enum([
  "text",
  "number",
  "date",
  "boolean",
  "single_select",
  "multi_select",
  "color",
]);

export const CreateCatalogCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    parentId: Uuid.nullable().optional(),
  })
  .strict();

export const CatalogCategorySchema = CreateCatalogCategorySchema.extend({
  id: Uuid,
  active: z.boolean(),
});

export const CreateCatalogTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(500).default(""),
  })
  .strict();

export const CatalogTypeSchema = CreateCatalogTypeSchema.extend({
  id: Uuid,
  active: z.boolean(),
});

export const CatalogFieldOptionSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u),
    label: z.string().trim().min(1).max(120),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/u)
      .optional(),
  })
  .strict();

export const CreateCatalogFieldSchema = z
  .object({
    itemTypeId: Uuid.optional(),
    itemId: Uuid.optional(),
    key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u),
    label: z.string().trim().min(1).max(160),
    description: z.string().max(500).default(""),
    valueType: CatalogFieldTypeSchema,
    options: z.array(CatalogFieldOptionSchema).max(100).default([]),
    required: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(10000).default(0),
  })
  .strict()
  .refine((value) => Boolean(value.itemTypeId) !== Boolean(value.itemId), {
    message: "Choose either an item type or one item",
  });

export const CatalogFieldSchema = z
  .object({
    id: Uuid,
    itemTypeId: Uuid.nullable(),
    itemId: Uuid.nullable(),
    key: z.string(),
    label: z.string(),
    description: z.string(),
    valueType: CatalogFieldTypeSchema,
    options: z.array(CatalogFieldOptionSchema),
    required: z.boolean(),
    active: z.boolean(),
    sortOrder: z.number().int(),
  })
  .strict();

const CatalogItemFieldsSchema = z.record(Uuid, z.unknown());
const CatalogItemInputBaseSchema = z
  .object({
    kind: CatalogKindSchema,
    name: z.string().trim().min(1).max(180),
    description: z.string().max(10000).default(""),
    sku: z.string().trim().min(1).max(100).nullable().default(null),
    categoryId: Uuid.nullable().default(null),
    itemTypeId: Uuid.nullable().default(null),
    price: Money,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .default("GTQ"),
    availabilityMode: CatalogAvailabilityModeSchema,
    tracksStock: z.boolean().default(false),
    capacity: z.number().int().min(1).max(100000).nullable().default(null),
    locksAdvisor: z.boolean().default(true),
    fields: CatalogItemFieldsSchema.default({}),
  })
  .strict();

export const CreateCatalogItemSchema = CatalogItemInputBaseSchema.superRefine((value, context) => {
  if ((value.availabilityMode === "interval_capacity") !== (value.capacity !== null)) {
    context.addIssue({
      code: "custom",
      path: ["capacity"],
      message: "Capacity is required only for interval capacity",
    });
  }
  if (value.availabilityMode === "stock" && !value.tracksStock) {
    context.addIssue({
      code: "custom",
      path: ["tracksStock"],
      message: "Stock mode requires tracked stock",
    });
  }
});

export const UpdateCatalogItemSchema = CatalogItemInputBaseSchema.extend({
  active: z.boolean(),
})
  .partial()
  .refine((value) => Object.keys(value).length > 0);

export const CatalogItemSchema = z
  .object({
    id: Uuid,
    kind: CatalogKindSchema,
    name: z.string(),
    description: z.string(),
    sku: z.string().nullable(),
    categoryId: Uuid.nullable(),
    itemTypeId: Uuid.nullable(),
    price: Money,
    currency: z.string(),
    availabilityMode: CatalogAvailabilityModeSchema,
    tracksStock: z.boolean(),
    capacity: z.number().int().nullable(),
    locksAdvisor: z.boolean(),
    active: z.boolean(),
    stockOnHand: z.number().int(),
    fields: CatalogItemFieldsSchema,
    version: z.string().regex(/^[1-9][0-9]*$/u),
    createdAt: Rfc3339,
    updatedAt: Rfc3339,
  })
  .strict();

export const AdjustCatalogStockSchema = z
  .object({
    delta: z
      .number()
      .int()
      .refine((value) => value !== 0),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const CatalogItemListQuerySchema = z
  .object({
    kind: CatalogKindSchema.optional(),
    categoryId: Uuid.optional(),
    query: z.string().trim().max(120).optional(),
    includeInactive: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .default(false),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const CatalogItemResponseSchema = z.object({ data: CatalogItemSchema }).strict();
export const CatalogItemListResponseSchema = z
  .object({ data: z.array(CatalogItemSchema) })
  .strict();
export const CatalogCategoryListResponseSchema = z
  .object({ data: z.array(CatalogCategorySchema) })
  .strict();
export const CatalogCategoryResponseSchema = z.object({ data: CatalogCategorySchema }).strict();
export const CatalogTypeListResponseSchema = z
  .object({ data: z.array(CatalogTypeSchema) })
  .strict();
export const CatalogTypeResponseSchema = z.object({ data: CatalogTypeSchema }).strict();
export const CatalogFieldListResponseSchema = z
  .object({ data: z.array(CatalogFieldSchema) })
  .strict();
export const CatalogFieldResponseSchema = z.object({ data: CatalogFieldSchema }).strict();

export type CreateCatalogItem = z.infer<typeof CreateCatalogItemSchema>;
export type CatalogItem = z.infer<typeof CatalogItemSchema>;
