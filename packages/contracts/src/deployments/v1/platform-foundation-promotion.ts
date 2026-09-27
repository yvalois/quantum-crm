import { z } from "zod";

export const PlatformFoundationPromotionSchema = z
  .object({
    id: z.string().uuid(),
    releaseId: z.string().uuid(),
    requestedByOperatorId: z.string().uuid(),
    status: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]),
    attempt: z.number().int().nonnegative(),
    version: z.string().regex(/^[1-9][0-9]*$/u),
    failureCode: z
      .enum(["UNAVAILABLE", "IDENTITY_MISMATCH", "TARGET_CONFLICT", "PERMISSION_DENIED"])
      .nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const PlatformFoundationPromotionResponseSchema = z
  .object({
    schemaVersion: z.literal("platform-foundation-promotion/v1"),
    data: PlatformFoundationPromotionSchema,
    meta: z.object({ idempotentReplay: z.boolean() }).strict(),
  })
  .strict();

export type PlatformFoundationPromotionContract = z.infer<typeof PlatformFoundationPromotionSchema>;
