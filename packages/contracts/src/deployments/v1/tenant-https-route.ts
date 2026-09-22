import { z } from "zod";

const uuidSchema = z.string().uuid();
const hostnameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[0-9-]+\.nip\.io$/u);
const edgeNetworkSchema = z.string().regex(/^qcrm-tenant-edge-[0-9a-f-]{36}$/u);

export const TenantHttpsRouteProvisioningRequestSchema = z
  .object({
    action: z.literal("RECONCILE_TENANT_HTTPS"),
    operationId: uuidSchema,
    tenantProfileId: uuidSchema,
    serverId: uuidSchema,
    releaseId: uuidSchema,
    hostname: hostnameSchema,
    edgeNetworkName: edgeNetworkSchema,
    upstreamServices: z
      .array(z.enum(["api", "crm-web", "portal-web"]))
      .min(1)
      .max(3),
    configurationRevision: z.string().regex(/^[1-9][0-9]*$/u),
    attempt: z.number().int().positive(),
  })
  .strict();

export const TenantHttpsRouteProvisioningResponseSchema = z
  .object({
    hostname: hostnameSchema,
    edgeNetworkName: edgeNetworkSchema,
    routeGeneration: z.string().regex(/^[1-9][0-9]*$/u),
    configured: z.boolean(),
    reconciled: z.boolean(),
  })
  .strict();

export type TenantHttpsRouteProvisioningRequest = z.infer<
  typeof TenantHttpsRouteProvisioningRequestSchema
>;
export type TenantHttpsRouteProvisioningResponse = z.infer<
  typeof TenantHttpsRouteProvisioningResponseSchema
>;
