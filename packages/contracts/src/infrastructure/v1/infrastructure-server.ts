import { z } from "zod";

export const InfrastructureServerStatusSchema = z.enum(["AVAILABLE", "DRAINING", "UNAVAILABLE"]);
export const InfrastructureServerArchitectureSchema = z.enum(["X86_64", "ARM64"]);

export const ServerCapacitySchema = z
  .object({
    cpuMillicores: z.number().int().nonnegative(),
    memoryMiB: z.number().int().nonnegative(),
    storageMiB: z.number().int().nonnegative(),
  })
  .strict();

const WritableInfrastructureServerFieldsSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u),
    displayName: z.string().trim().min(1).max(160),
    provider: z.string().trim().min(1).max(120),
    region: z.string().trim().min(1).max(120),
    publicIpv4: z.ipv4(),
    operatingSystem: z.string().trim().min(1).max(160),
    architecture: InfrastructureServerArchitectureSchema,
    status: InfrastructureServerStatusSchema,
    totalCapacity: ServerCapacitySchema.refine(
      (value) => value.cpuMillicores > 0 && value.memoryMiB > 0 && value.storageMiB > 0,
    ),
    reservedCapacity: ServerCapacitySchema,
    operationCredentialRef: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^secret:\/\/[a-z0-9][a-z0-9/_-]{2,253}$/u),
    confirmedAt: z.string().datetime(),
  })
  .strict();

export const CreateInfrastructureServerSchema = WritableInfrastructureServerFieldsSchema.refine(
  (value) =>
    value.reservedCapacity.cpuMillicores <= value.totalCapacity.cpuMillicores &&
    value.reservedCapacity.memoryMiB <= value.totalCapacity.memoryMiB &&
    value.reservedCapacity.storageMiB <= value.totalCapacity.storageMiB,
  { path: ["reservedCapacity"] },
);
export const UpdateInfrastructureServerSchema =
  WritableInfrastructureServerFieldsSchema.partial().refine(
    (value) => Object.keys(value).length > 0,
    { message: "At least one field is required" },
  );

export const InfrastructureServerSchema = WritableInfrastructureServerFieldsSchema.omit({
  operationCredentialRef: true,
}).extend({
  id: z.string().uuid(),
  availableCapacity: ServerCapacitySchema,
  credentialConfigured: z.boolean(),
  version: z.string().regex(/^[1-9][0-9]*$/u),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const InfrastructureServerResponseSchema = z
  .object({
    schemaVersion: z.literal("infrastructure-server/v1"),
    data: InfrastructureServerSchema,
  })
  .strict();

export const InfrastructureServerListQuerySchema = z
  .object({
    status: InfrastructureServerStatusSchema.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const InfrastructureServerListResponseSchema = z
  .object({
    schemaVersion: z.literal("infrastructure-server-list/v1"),
    data: z.array(InfrastructureServerSchema).max(100),
    meta: z.object({ pageSize: z.number().int().min(1).max(100) }).strict(),
  })
  .strict();

export type InfrastructureServerContract = z.infer<typeof InfrastructureServerSchema>;
export type CreateInfrastructureServer = z.infer<typeof CreateInfrastructureServerSchema>;
export type UpdateInfrastructureServer = z.infer<typeof UpdateInfrastructureServerSchema>;
