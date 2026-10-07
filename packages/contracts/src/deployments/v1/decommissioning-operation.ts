import { z } from "zod";

export const DecommissioningOperationSchema = z
  .object({
    id: z.string().uuid(),
    tenantProfileId: z.string().uuid(),
    status: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]),
    currentStep: z.enum([
      "VALIDATE",
      "STOP_CONTAINERS",
      "REMOVE_HTTPS",
      "REMOVE_IDENTITY",
      "REMOVE_CONFIGURATION",
      "REMOVE_STORAGE",
      "REMOVE_DATABASE",
      "RELEASE_CAPACITY",
      "TOMBSTONE",
    ]),
    attempt: z.number().int().nonnegative(),
    version: z.string().regex(/^[1-9][0-9]*$/u),
    failureCode: z
      .enum([
        "TENANT_STATE_INVALID",
        "TARGET_CONFLICT",
        "CONTAINERS_UNAVAILABLE",
        "HTTPS_UNAVAILABLE",
        "IDENTITY_UNAVAILABLE",
        "CONFIGURATION_UNAVAILABLE",
        "STORAGE_UNAVAILABLE",
        "DATABASE_UNAVAILABLE",
        "CAPACITY_ACCOUNTING_INVALID",
        "PERMISSION_DENIED",
      ])
      .nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const DecommissioningOperationResponseSchema = z
  .object({
    schemaVersion: z.literal("tenant-decommissioning-operation/v1"),
    data: DecommissioningOperationSchema,
    meta: z.object({ idempotentReplay: z.boolean() }).strict(),
  })
  .strict();

export type DecommissioningOperationContract = z.infer<typeof DecommissioningOperationSchema>;
export type DecommissioningOperationResponse = z.infer<
  typeof DecommissioningOperationResponseSchema
>;
