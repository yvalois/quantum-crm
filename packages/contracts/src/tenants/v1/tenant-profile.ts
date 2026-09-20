import { z } from "zod";

export const TenantProfileStatusSchema = z.enum([
  "PENDING",
  "PROVISIONING",
  "ACTIVE",
  "SUSPENDED",
  "ERROR",
]);

const TenantProfileFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u),
    adminContactName: z.string().trim().min(1).max(160),
    adminContactEmail: z.string().trim().toLowerCase().email().max(320),
    status: TenantProfileStatusSchema,
    serverId: z.string().uuid().nullable(),
    releaseId: z.string().uuid().nullable(),
  })
  .strict();

export const CreateTenantProfileSchema = TenantProfileFieldsSchema.pick({
  name: true,
  slug: true,
  adminContactName: true,
  adminContactEmail: true,
}).strict();

export const UpdateTenantProfileSchema = TenantProfileFieldsSchema.omit({
  status: true,
  serverId: true,
  releaseId: true,
})
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const TenantProfileSchema = TenantProfileFieldsSchema.extend({
  id: z.string().uuid(),
  version: z.string().regex(/^[1-9][0-9]*$/u),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const TenantProfileResponseSchema = z
  .object({
    schemaVersion: z.literal("tenant-profile/v1"),
    data: TenantProfileSchema,
  })
  .strict();

export const TenantProfileListQuerySchema = z
  .object({
    status: TenantProfileStatusSchema.optional(),
    serverId: z.string().uuid().optional(),
    releaseId: z.string().uuid().optional(),
    search: z.string().trim().min(1).max(160).optional(),
    cursor: z.string().min(1).max(512).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const TenantProfileListResponseSchema = z
  .object({
    schemaVersion: z.literal("tenant-profile-list/v1"),
    data: z.array(TenantProfileSchema).max(100),
    meta: z
      .object({
        pageSize: z.number().int().min(1).max(100),
        nextCursor: z.string().min(1).max(512).nullable(),
      })
      .strict(),
  })
  .strict();

export type CreateTenantProfile = z.infer<typeof CreateTenantProfileSchema>;
export type UpdateTenantProfile = z.infer<typeof UpdateTenantProfileSchema>;
export type TenantProfileContract = z.infer<typeof TenantProfileSchema>;
export type TenantProfileResponse = z.infer<typeof TenantProfileResponseSchema>;
export type TenantProfileListQuery = z.infer<typeof TenantProfileListQuerySchema>;
export type TenantProfileListResponse = z.infer<typeof TenantProfileListResponseSchema>;

export function tenantProfileResponse(input: TenantProfileContract): TenantProfileResponse {
  return TenantProfileResponseSchema.parse({ schemaVersion: "tenant-profile/v1", data: input });
}
