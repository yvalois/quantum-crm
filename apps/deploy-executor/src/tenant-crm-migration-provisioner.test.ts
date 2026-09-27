import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createTenantCrmMigrationProvisioner } from "./tenant-crm-migration-provisioner.js";

describe("tenant CRM migration provisioner", () => {
  it("uses the fixed private migration endpoint and no caller-controlled command", async () => {
    const root = await mkdtemp(join(tmpdir(), "qcrm-migration-"));
    const socketPath = join(root, "deploy.sock");
    const server = createServer((request, response) => {
      expect(request.url).toBe("/v1/tenant-database/migrate");
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ migrated: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      await expect(
        createTenantCrmMigrationProvisioner(socketPath).migrate({
          operationId: "01995f7e-7b52-7000-8000-000000000401",
          tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
          serverId: "01995f7e-7b52-7000-8000-000000000301",
          releaseId: "01995f7e-7b52-7000-8000-000000000302",
          attempt: 1,
        }),
      ).resolves.toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
