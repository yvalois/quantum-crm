import { z } from "zod";

export const CustomFieldModelSchema = z.enum(["contact", "opportunity"]);
export const CustomFieldDefinitionSchema = z
  .object({
    id: z.string().uuid(),
    key: z.string().min(1).max(1000),
    label: z.string().min(1).max(1000),
    description: z.string().max(100_000),
    dataType: z.string().min(1).max(100),
    model: CustomFieldModelSchema,
  })
  .strict();
export const CustomFieldDefinitionListQuerySchema = z
  .object({
    model: CustomFieldModelSchema,
    limit: z.coerce.number().int().min(1).max(100).default(100),
    cursor: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/u).optional(),
  })
  .strict();
export const CustomFieldDefinitionListResponseSchema = z
  .object({
    data: z.array(CustomFieldDefinitionSchema).max(100),
    page: z.object({ nextCursor: z.string().max(256).nullable() }).strict(),
  })
  .strict();

export type CustomFieldModel = z.infer<typeof CustomFieldModelSchema>;
export type CustomFieldDefinition = z.infer<typeof CustomFieldDefinitionSchema>;
export type CustomFieldDefinitionListQuery = z.infer<typeof CustomFieldDefinitionListQuerySchema>;
