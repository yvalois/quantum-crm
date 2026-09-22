import { describe, expect, it } from "vitest";

import {
  TenantHttpsRouteProvisioningRequestSchema,
  TenantHttpsRouteProvisioningResponseSchema,
} from "./tenant-https-route.js";

describe("tenant HTTPS route contract", () => {
  it("accepts the closed reconciliation request", () => {
    expect(
      TenantHttpsRouteProvisioningRequestSchema.parse({
        action: "RECONCILE_TENANT_HTTPS",
        operationId: "01995f7e-7b52-7000-8000-000000000101",
        tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
        serverId: "01995f7e-7b52-7000-8000-000000000301",
        releaseId: "01995f7e-7b52-7000-8000-000000000302",
        hostname: "acme.2-25-172-119.nip.io",
        edgeNetworkName: "qcrm-tenant-edge-01995f7e-7b52-7000-8000-000000000201",
        upstreamServices: ["api", "crm-web", "portal-web"],
        configurationRevision: "1",
        attempt: 1,
      }).configurationRevision,
    ).toBe("1");
  });

  it("rejects arbitrary proxy configuration", () => {
    expect(
      TenantHttpsRouteProvisioningRequestSchema.safeParse({
        action: "RECONCILE_TENANT_HTTPS",
        operationId: "01995f7e-7b52-7000-8000-000000000101",
        tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
        serverId: "01995f7e-7b52-7000-8000-000000000301",
        releaseId: "01995f7e-7b52-7000-8000-000000000302",
        hostname: "acme.2-25-172-119.nip.io",
        edgeNetworkName: "qcrm-tenant-edge-01995f7e-7b52-7000-8000-000000000201",
        upstreamServices: ["api"],
        configurationRevision: "1",
        attempt: 1,
        caddyfile: "site * { reverse_proxy localhost:1 }",
      }),
    ).toMatchObject({ success: false });
  });

  it("requires an observed route generation in the response", () => {
    expect(
      TenantHttpsRouteProvisioningResponseSchema.safeParse({
        hostname: "acme.2-25-172-119.nip.io",
        edgeNetworkName: "qcrm-tenant-edge-01995f7e-7b52-7000-8000-000000000201",
        routeGeneration: "1",
        configured: true,
        reconciled: true,
      }).success,
    ).toBe(true);
  });
});
