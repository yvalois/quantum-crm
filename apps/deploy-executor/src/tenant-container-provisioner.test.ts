import { createServer } from "node:http";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createTenantContainerProvisioner,
  TenantContainerProvisioningError,
} from "./tenant-container-provisioner.js";

const command = {
  operationId: "01995f7e-7b52-7000-8000-000000000101",
  tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
  serverId: "01995f7e-7b52-7000-8000-000000000301",
  releaseId: "01995f7e-7b52-7000-8000-000000000302",
  manifestRef: "tenant/01995f7e-7b52-7000-8000-000000000201/configuration.json",
  configurationRevision: 1n,
  attempt: 1,
} as const;

describe("tenant container provisioner", () => {
  it("sends a typed reconciliation request over the private socket", async () => {
    const root = await mkdtemp(join(tmpdir(), "qcrm-host-"));
    const socketPath = join(root, "deploy-host.sock");
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        expect(JSON.parse(body)).toMatchObject({
          action: "RECONCILE_TENANT_COMPOSE",
          operationId: command.operationId,
          configurationRevision: "1",
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          projectName: `qcrm-t-${command.tenantProfileId}`,
          services: ["agent-runtime", "api", "crm-web", "portal-web", "worker"],
          ready: true,
          reconciled: false,
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      await expect(
        createTenantContainerProvisioner({ socketPath }).provision(command),
      ).resolves.toEqual({
        projectName: `qcrm-t-${command.tenantProfileId}`,
        services: ["agent-runtime", "api", "crm-web", "portal-web", "worker"],
        ready: true,
        reconciled: false,
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("maps a host adapter conflict to a typed failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "qcrm-host-"));
    const socketPath = join(root, "deploy-host.sock");
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(409, { "content-type": "application/json" });
        response.end(JSON.stringify({ reason: "TARGET_CONFLICT" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      await expect(
        createTenantContainerProvisioner({ socketPath }).provision(command),
      ).rejects.toEqual(new TenantContainerProvisioningError("TARGET_CONFLICT"));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
