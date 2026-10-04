import { z } from "zod";

const uuid = z.string().uuid();
const failureCodes = [
  "TENANT_STATE_INVALID",
  "RELEASE_NOT_VALIDATED",
  "TARGET_CONFLICT",
  "MIGRATION_FAILED",
  "RECONCILIATION_FAILED",
  "VERIFICATION_FAILED",
  "PERMISSION_DENIED",
  "UNAVAILABLE",
] as const;
export const RequestTenantReleasePromotionSchema = z.object({ targetReleaseId: uuid }).strict();
export const TenantReleasePromotionSchema = z
  .object({
    id: uuid,
    tenantProfileId: uuid,
    previousReleaseId: uuid,
    targetReleaseId: uuid,
    requestedByOperatorId: uuid,
    status: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]),
    currentStep: z.enum(["VALIDATE", "MIGRATE", "RECONCILE", "VERIFY", "ACTIVATE"]),
    attempt: z.number().int().nonnegative(),
    version: z.string().regex(/^[1-9][0-9]*$/u),
    failureCode: z.enum(failureCodes).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const TenantReleasePromotionResponseSchema = z
  .object({
    schemaVersion: z.literal("tenant-release-promotion/v1"),
    data: TenantReleasePromotionSchema,
    meta: z.object({ idempotentReplay: z.boolean() }).strict(),
  })
  .strict();
export type RequestTenantReleasePromotion = z.infer<typeof RequestTenantReleasePromotionSchema>;
export type TenantReleasePromotionContract = z.infer<typeof TenantReleasePromotionSchema>;
export type TenantReleasePromotionResponse = z.infer<typeof TenantReleasePromotionResponseSchema>;
