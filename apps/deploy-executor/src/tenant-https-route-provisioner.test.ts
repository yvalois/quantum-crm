import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTenantHttpsRouteProvisioner } from "./tenant-https-route-provisioner.js";

const command = {
  operationId: "01995f7e-7b52-7000-8000-000000000101",
  tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
  serverId: "01995f7e-7b52-7000-8000-000000000301",
  releaseId: "01995f7e-7b52-7000-8000-000000000302",
  hostname: "acme.2-25-172-119.nip.io",
  edgeNetworkName: "qcrm-tenant-edge-01995f7e-7b52-7000-8000-000000000201",
  upstreamServices: ["crm-web"] as const,
  configurationRevision: 1n,
  attempt: 1,
} as const;

describe("tenant HTTPS route provisioner", () => {
  it("uses the closed HTTPS route operation on the private deploy-host socket", async () => {
    const root = await mkdtemp(join(tmpdir(), "qcrm-host-"));
    const socketPath = join(root, "deploy-host.sock");
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        expect(request.url).toBe("/v1/tenant-https/reconcile");
        expect(JSON.parse(body)).toMatchObject({
          action: "RECONCILE_TENANT_HTTPS",
          hostname: command.hostname,
          configurationRevision: "1",
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            hostname: command.hostname,
            edgeNetworkName: command.edgeNetworkName,
            routeGeneration: "1",
            configured: true,
            reconciled: true,
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      await expect(
        createTenantHttpsRouteProvisioner({ socketPath }).provision(command),
      ).resolves.toEqual({
        hostname: command.hostname,
        edgeNetworkName: command.edgeNetworkName,
        routeGeneration: 1n,
        configured: true,
        reconciled: true,
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
