import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  platformReleaseArtifactNames,
  tenantOidcIdentity,
  type PlatformRelease,
} from "@quantum-crm/platform-domain";

import {
  createTenantConfigurationProvisioner,
  TenantConfigurationProvisioningError,
} from "./tenant-configuration-provisioner.js";

const command = {
  tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
  serverId: "01995f7e-7b52-7000-8000-000000000301",
  releaseId: "01995f7e-7b52-7000-8000-000000000302",
  quotaMiB: 10240,
  hostname: "acme.2-25-172-119.nip.io",
  identity: tenantOidcIdentity("01995f7e-7b52-7000-8000-000000000201"),
} as const;

const release: PlatformRelease = {
  id: command.releaseId,
  semanticVersion: "1.0.0",
  commitSha: "a".repeat(40),
  releaseNotes: "Validated release for the configuration test.",
  compatibility: {
    configurationSchemaVersion: 1,
    agentContractVersion: "agent/v1",
    databaseMigrationRequired: false,
  },
  artifacts: platformReleaseArtifactNames.map((name, index) => ({
    name,
    digest: `sha256:${index.toString(16).padStart(64, "0")}`,
  })),
  status: "VALIDATED",
  version: 1n,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const releaseRepository = {
  findById: async (id: string): Promise<PlatformRelease | null> =>
    id === release.id ? release : { ...release, id },
};

describe("tenant configuration provisioner", () => {
  it("installs a deterministic non-secret manifest and reconciles it", async () => {
    const root = await mkdtemp(join(tmpdir(), "qcrm-config-"));
    try {
      const provisioner = createTenantConfigurationProvisioner({
        configurationDirectory: root,
        storageEndpoint: "http://platform-storage:8333/",
        releaseRepository,
        identityIssuer: "https://identity.example.test",
      });

      await expect(provisioner.provision(command)).resolves.toMatchObject({
        manifestRef: `tenant/${command.tenantProfileId}/configuration.json`,
        revision: 1n,
        reconciled: false,
      });
      const path = join(root, "tenant", command.tenantProfileId, "configuration.json");
      const content = await readFile(path, "utf8");
      expect(content).toContain('"schemaVersion": 1');
      expect(content).toContain('"artifacts"');
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
        releaseRepository,
        identityIssuer: "https://identity.example.test",
      });
      await provisioner.provision(command);
      await expect(
        provisioner.provision({ ...command, releaseId: "01995f7e-7b52-7000-8000-000000000303" }),
      ).rejects.toEqual(new TenantConfigurationProvisioningError("TARGET_CONFLICT"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("derives and reuses the runtime database URL outside the manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "qcrm-config-"));
    const secrets = await mkdtemp(join(tmpdir(), "qcrm-secrets-"));
    try {
      const secretDirectory = join(secrets, command.tenantProfileId);
      await mkdir(secretDirectory, { recursive: true, mode: 0o700 });
      await writeFile(join(secretDirectory, "runtime-password"), "synthetic-runtime-password\n", {
        mode: 0o400,
      });
      const provisioner = createTenantConfigurationProvisioner({
        configurationDirectory: root,
        storageEndpoint: "http://platform-storage:8333",
        releaseRepository,
        tenantSecretDirectory: secrets,
        databaseHost: "platform-postgres",
        databasePort: 5432,
        identityIssuer: "https://identity.example.test",
      });

      await provisioner.provision(command);
      const runtimeUrlPath = join(secretDirectory, "runtime-url");
      const first = await readFile(runtimeUrlPath, "utf8");
      expect(first).toContain("platform-postgres:5432");
      await expect(provisioner.provision(command)).resolves.toMatchObject({ reconciled: true });
      expect(await readFile(runtimeUrlPath, "utf8")).toBe(first);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(secrets, { recursive: true, force: true });
    }
  });
});
