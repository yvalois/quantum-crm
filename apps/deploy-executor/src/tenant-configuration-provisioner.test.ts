import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createTenantConfigurationProvisioner,
  TenantConfigurationProvisioningError,
} from "./tenant-configuration-provisioner.js";

const command = {
  tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
  serverId: "01995f7e-7b52-7000-8000-000000000301",
  releaseId: "01995f7e-7b52-7000-8000-000000000302",
  quotaMiB: 10240,
} as const;

describe("tenant configuration provisioner", () => {
  it("installs a deterministic non-secret manifest and reconciles it", async () => {
    const root = await mkdtemp(join(tmpdir(), "qcrm-config-"));
    try {
      const provisioner = createTenantConfigurationProvisioner({
        configurationDirectory: root,
        storageEndpoint: "http://platform-storage:8333/",
      });

      await expect(provisioner.provision(command)).resolves.toMatchObject({
        manifestRef: `tenant/${command.tenantProfileId}/configuration.json`,
        revision: 1n,
        reconciled: false,
      });
      const path = join(root, "tenant", command.tenantProfileId, "configuration.json");
      const content = await readFile(path, "utf8");
      expect(content).toContain('"schemaVersion": 1');
      expect(content).toContain("migrator-password");
      expect(content).not.toContain("test-only-secret");
      await expect(provisioner.provision(command)).resolves.toMatchObject({ reconciled: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an existing manifest with a different identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "qcrm-config-"));
    try {
      const provisioner = createTenantConfigurationProvisioner({
        configurationDirectory: root,
        storageEndpoint: "http://platform-storage:8333",
      });
      await provisioner.provision(command);
      await expect(
        provisioner.provision({ ...command, releaseId: "01995f7e-7b52-7000-8000-000000000303" }),
      ).rejects.toEqual(new TenantConfigurationProvisioningError("TARGET_CONFLICT"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
