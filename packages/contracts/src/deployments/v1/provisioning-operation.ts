import { z } from "zod";

export const RequestTenantProvisioningSchema = z
  .object({
    serverId: z.string().uuid(),
    releaseId: z.string().uuid(),
  })
  .strict();

export const ProvisioningOperationSchema = z
  .object({
    id: z.string().uuid(),
    tenantProfileId: z.string().uuid(),
    serverId: z.string().uuid(),
    releaseId: z.string().uuid(),
    status: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]),
    currentStep: z.enum([
      "VALIDATE",
      "CREATE_DATABASE",
      "CREATE_SECRETS",
      "CREATE_STORAGE",
      "WRITE_CONFIGURATION",
      "START_CONTAINERS",
      "CONFIGURE_HTTPS",
      "CREATE_ADMINISTRATOR",
      "VERIFY",
      "ACTIVATE",
    ]),
    attempt: z.number().int().nonnegative(),
    version: z.string().regex(/^[1-9][0-9]*$/u),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const ProvisioningOperationResponseSchema = z
  .object({
    schemaVersion: z.literal("tenant-provisioning-operation/v1"),
    data: ProvisioningOperationSchema,
    meta: z.object({ idempotentReplay: z.boolean() }).strict(),
  })
  .strict();

export type RequestTenantProvisioning = z.infer<typeof RequestTenantProvisioningSchema>;
export type ProvisioningOperationContract = z.infer<typeof ProvisioningOperationSchema>;
export type ProvisioningOperationResponse = z.infer<typeof ProvisioningOperationResponseSchema>;
