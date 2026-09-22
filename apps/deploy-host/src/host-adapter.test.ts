import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createHostAdapterServer } from "./host-adapter.js";

const requestBody = {
  action: "RECONCILE_TENANT_COMPOSE",
  operationId: "01995f7e-7b52-7000-8000-000000000101",
  tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
  serverId: "01995f7e-7b52-7000-8000-000000000301",
  releaseId: "01995f7e-7b52-7000-8000-000000000302",
  manifestRef: "tenant/01995f7e-7b52-7000-8000-000000000201/configuration.json",
  configurationRevision: "1",
  attempt: 1,
};

function requestOverSocket(
  socketPath: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const client = request(
      {
        socketPath,
        path: "/v1/tenant-containers/reconcile",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: JSON.parse(responseBody),
          });
        });
      },
    );
    client.once("error", reject);
    client.end(payload);
  });
}

describe("deploy host adapter", () => {
  it("validates the typed request and forwards the derived project", async () => {
    const root = await mkdtemp(join(tmpdir(), "qcrm-host-adapter-"));
    const socketPath = join(root, "adapter.sock");
    const reconcile = vi.fn(async (request: { readonly projectName: string }) => ({
      projectName: request.projectName,
      services: ["agent-runtime", "api", "crm-web", "portal-web", "worker"] as const,
      ready: true,
      reconciled: false,
    }));
    const adapter = createHostAdapterServer({
      socketPath,
      reconciler: { reconcile },
    });
    await adapter.listen();
    try {
      const response = await requestOverSocket(socketPath, requestBody);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        projectName: "qcrm-t-01995f7e-7b52-7000-8000-000000000201",
        ready: true,
      });
      expect(reconcile).toHaveBeenCalledWith(
        expect.objectContaining({
          projectName: "qcrm-t-01995f7e-7b52-7000-8000-000000000201",
          configurationRevision: 1n,
        }),
      );
    } finally {
      await adapter.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a request that tries to supply an arbitrary path", async () => {
    const root = await mkdtemp(join(tmpdir(), "qcrm-host-adapter-"));
    const socketPath = join(root, "adapter.sock");
    const adapter = createHostAdapterServer({
      socketPath,
      reconciler: { reconcile: vi.fn() },
    });
    await adapter.listen();
    try {
      const response = await requestOverSocket(socketPath, {
        ...requestBody,
        composePath: "/etc/passwd",
      });
      expect(response.status).toBe(409);
    } finally {
      await adapter.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
