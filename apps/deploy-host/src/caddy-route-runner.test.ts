import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createTenantCaddyRouteReconciler, type CaddyCommandResult } from "./caddy-route-runner.js";
import { HostAdapterError, type HostAdapterHttpsRequest } from "./host-adapter.js";

const request: HostAdapterHttpsRequest = {
  action: "RECONCILE_TENANT_HTTPS",
  operationId: "01995f7e-7b52-7000-8000-000000000101",
  tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
  serverId: "01995f7e-7b52-7000-8000-000000000301",
  releaseId: "01995f7e-7b52-7000-8000-000000000302",
  hostname: "acme.2-25-172-119.nip.io",
  edgeNetworkName: "qcrm-tenant-edge-01995f7e-7b52-7000-8000-000000000201",
  upstreamServices: ["crm-web"],
  configurationRevision: 1n,
  attempt: 1,
};

const caddyContainerId = "a".repeat(64);

function result(exitCode = 0, stdout = ""): CaddyCommandResult {
  return { exitCode, stdout, stderr: "" };
}

describe("tenant Caddy route runner", () => {
  it("writes only a derived route, attaches the edge network and reloads Caddy", async () => {
    const routeRoot = await mkdtemp(join(tmpdir(), "qcrm-tenant-routes-"));
    const run = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "ps") return result(0, `${caddyContainerId}\n`);
      return result();
    });
    const reconciler = createTenantCaddyRouteReconciler({
      routeRoot,
      commandRunner: { run },
    });
    try {
      await expect(reconciler.reconcile(request)).resolves.toEqual({
        hostname: request.hostname,
        edgeNetworkName: request.edgeNetworkName,
        routeGeneration: 1n,
        configured: true,
        reconciled: true,
      });
      await expect(
        readFile(join(routeRoot, `${request.tenantProfileId}.caddy`), "utf8"),
      ).resolves.toContain("qcrm-01995f7e7b5270008000000000000201-crm-web:3000");
      expect(run.mock.calls.map(([args]) => args)).toEqual([
        expect.arrayContaining(["ps", "--no-trunc"]),
        ["network", "connect", request.edgeNetworkName, caddyContainerId],
        expect.arrayContaining(["exec", caddyContainerId, "caddy", "validate"]),
        expect.arrayContaining(["exec", caddyContainerId, "caddy", "reload"]),
      ]);
    } finally {
      await rm(routeRoot, { recursive: true, force: true });
    }
  });

  it("restores the prior route when the full Caddy validation rejects a replacement", async () => {
    const routeRoot = await mkdtemp(join(tmpdir(), "qcrm-tenant-routes-"));
    const routePath = join(routeRoot, `${request.tenantProfileId}.caddy`);
    await writeFile(routePath, "prior-route\n", { mode: 0o600 });
    const run = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "ps") return result(0, `${caddyContainerId}\n`);
      if (args.includes("validate")) return result(1);
      return result();
    });
    const reconciler = createTenantCaddyRouteReconciler({
      routeRoot,
      commandRunner: { run },
    });
    try {
      await expect(reconciler.reconcile(request)).rejects.toEqual(
        new HostAdapterError("UNAVAILABLE"),
      );
      await expect(readFile(routePath, "utf8")).resolves.toBe("prior-route\n");
    } finally {
      await rm(routeRoot, { recursive: true, force: true });
    }
  });
});
