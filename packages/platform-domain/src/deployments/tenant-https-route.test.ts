import { describe, expect, it } from "vitest";

import {
  tenantHttpsEdgeNetworkName,
  tenantHttpsHostname,
  TenantHttpsRouteValidationError,
  validateTenantHttpsRouteProvisioningCommand,
} from "./tenant-https-route.js";

const tenantProfileId = "01995f7e-7b52-7000-8000-000000000201";

describe("tenant HTTPS route domain", () => {
  it("derives the nip.io hostname and edge network from trusted inventory", () => {
    expect(tenantHttpsHostname("Acme-demo", "2.25.172.119")).toBe("acme-demo.2-25-172-119.nip.io");
    expect(tenantHttpsEdgeNetworkName(tenantProfileId)).toBe(`qcrm-tenant-edge-${tenantProfileId}`);
  });

  it("rejects invalid addresses before producing a public hostname", () => {
    expect(() => tenantHttpsHostname("acme", "2.25.172.999")).toThrow(
      new TenantHttpsRouteValidationError("publicIpv4"),
    );
  });

  it("accepts only the profile edge network and fixed upstreams", () => {
    expect(
      validateTenantHttpsRouteProvisioningCommand({
        operationId: "01995f7e-7b52-7000-8000-000000000101",
        tenantProfileId,
        serverId: "01995f7e-7b52-7000-8000-000000000301",
        releaseId: "01995f7e-7b52-7000-8000-000000000302",
        hostname: "acme.2-25-172-119.nip.io",
        edgeNetworkName: tenantHttpsEdgeNetworkName(tenantProfileId),
        upstreamServices: ["api", "crm-web", "portal-web"],
        configurationRevision: 1n,
        attempt: 1,
      }).upstreamServices,
    ).toEqual(["api", "crm-web", "portal-web"]);

    expect(() =>
      validateTenantHttpsRouteProvisioningCommand({
        operationId: "01995f7e-7b52-7000-8000-000000000101",
        tenantProfileId,
        serverId: "01995f7e-7b52-7000-8000-000000000301",
        releaseId: "01995f7e-7b52-7000-8000-000000000302",
        hostname: "acme.2-25-172-119.nip.io",
        edgeNetworkName: "qcrm-tenant-edge-other",
        upstreamServices: ["api"],
        configurationRevision: 1n,
        attempt: 1,
      }),
    ).toThrow(new TenantHttpsRouteValidationError("edgeNetworkName"));
  });
});
