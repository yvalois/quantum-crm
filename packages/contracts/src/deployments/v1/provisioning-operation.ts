import { z } from "zod";

export const RequestTenantProvisioningSchema = z
  .object({
    serverId: z.string().uuid(),
    releaseId: z.string().uuid(),
    requestedCapacity: z
      .object({
        cpuMillicores: z.number().int().positive(),
        memoryMiB: z.number().int().positive(),
        storageMiB: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export const RequestAutomaticTenantProvisioningSchema = z.object({}).strict();

export const CancelTenantProvisioningSchema = z
  .object({
    reason: z
      .string()
      .min(1)
      .max(1000)
      .transform((value) =>
        value
          .replace(/\p{Cc}+/gu, " ")
          .replace(/\s+/gu, " ")
          .trim(),
      )
      .pipe(z.string().min(3).max(500)),
  })
  .strict();

export const ProvisioningOperationSchema = z
  .object({
    id: z.string().uuid(),
    tenantProfileId: z.string().uuid(),
    serverId: z.string().uuid(),
    releaseId: z.string().uuid(),
    requestedCapacity: z
      .object({
        cpuMillicores: z.number().int().positive(),
        memoryMiB: z.number().int().positive(),
        storageMiB: z.number().int().positive(),
      })
      .strict(),
    capacityReservation: z
      .object({
        id: z.string().uuid(),
      })
      .strict(),
    status: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]),
    currentStep: z.enum([
      "VALIDATE",
      "CREATE_DATABASE",
      "CREATE_SECRETS",
      "CREATE_STORAGE",
      "WRITE_CONFIGURATION",
      "MIGRATE_DATABASE",
      "START_CONTAINERS",
      "CONFIGURE_HTTPS",
      "CREATE_ADMINISTRATOR",
      "VERIFY",
      "ACTIVATE",
    ]),
    attempt: z.number().int().nonnegative(),
    version: z.string().regex(/^[1-9][0-9]*$/u),
    failureCode: z
      .enum([
        "TENANT_STATE_INVALID",
        "TENANT_PLACEMENT_MISMATCH",
        "SERVER_UNAVAILABLE",
        "RELEASE_NOT_VALIDATED",
        "RESERVATION_INVALID",
        "CAPACITY_ACCOUNTING_INVALID",
        "DATABASE_TARGET_CONFLICT",
        "DATABASE_UNAVAILABLE",
        "DATABASE_PERMISSION_DENIED",
        "DATABASE_IDENTITY_MISMATCH",
        "MIGRATION_TARGET_CONFLICT",
        "MIGRATION_UNAVAILABLE",
        "MIGRATION_PERMISSION_DENIED",
        "MIGRATION_IDENTITY_MISMATCH",
        "SECRET_TARGET_CONFLICT",
        "SECRET_UNAVAILABLE",
        "SECRET_PERMISSION_DENIED",
        "SECRET_IDENTITY_MISMATCH",
        "STORAGE_TARGET_CONFLICT",
        "STORAGE_UNAVAILABLE",
        "STORAGE_PERMISSION_DENIED",
        "STORAGE_IDENTITY_MISMATCH",
        "CONFIGURATION_TARGET_CONFLICT",
        "CONFIGURATION_UNAVAILABLE",
        "CONFIGURATION_PERMISSION_DENIED",
        "CONFIGURATION_IDENTITY_MISMATCH",
        "CONTAINERS_TARGET_CONFLICT",
        "CONTAINERS_UNAVAILABLE",
        "CONTAINERS_PERMISSION_DENIED",
        "CONTAINERS_IDENTITY_MISMATCH",
        "HTTPS_TARGET_CONFLICT",
        "HTTPS_UNAVAILABLE",
        "HTTPS_PERMISSION_DENIED",
        "HTTPS_IDENTITY_MISMATCH",
        "IDENTITY_TARGET_CONFLICT",
        "IDENTITY_UNAVAILABLE",
        "IDENTITY_PERMISSION_DENIED",
        "IDENTITY_IDENTITY_MISMATCH",
      ])
      .nullable(),
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

export const ProvisioningCancellationSchema = z
  .object({
    cancelledByOperatorId: z.string().uuid(),
    reason: z.string().min(3).max(500),
    expectedVersion: z.string().regex(/^[1-9][0-9]*$/u),
    result: z.literal("CANCELLED"),
    cancelledAt: z.string().datetime(),
  })
  .strict();

export const ProvisioningCancellationResponseSchema = z
  .object({
    schemaVersion: z.literal("tenant-provisioning-cancellation/v1"),
    data: z
      .object({
        operation: ProvisioningOperationSchema,
        cancellation: ProvisioningCancellationSchema,
      })
      .strict(),
    meta: z.object({ idempotentReplay: z.boolean() }).strict(),
  })
  .strict();

export type RequestTenantProvisioning = z.infer<typeof RequestTenantProvisioningSchema>;
export type RequestAutomaticTenantProvisioning = z.infer<
  typeof RequestAutomaticTenantProvisioningSchema
>;
export type CancelTenantProvisioning = z.infer<typeof CancelTenantProvisioningSchema>;
export type ProvisioningOperationContract = z.infer<typeof ProvisioningOperationSchema>;
export type ProvisioningOperationResponse = z.infer<typeof ProvisioningOperationResponseSchema>;
export type ProvisioningCancellation = z.infer<typeof ProvisioningCancellationSchema>;
export type ProvisioningCancellationResponse = z.infer<
  typeof ProvisioningCancellationResponseSchema
>;
