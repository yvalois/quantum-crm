import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  platformReleaseArtifactNames,
  tenantContainerServiceNames,
} from "@quantum-crm/platform-domain";

import { createTenantComposeReconciler, type ComposeCommandResult } from "./compose-runner.js";
import type { HostAdapterRequest } from "./host-adapter.js";

const request: HostAdapterRequest = {
  action: "RECONCILE_TENANT_COMPOSE",
  operationId: "01995f7e-7b52-7000-8000-000000000101",
  tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
  serverId: "01995f7e-7b52-7000-8000-000000000301",
  releaseId: "01995f7e-7b52-7000-8000-000000000302",
  manifestRef: "tenant/01995f7e-7b52-7000-8000-000000000201/configuration.json",
  configurationRevision: 1n,
  attempt: 1,
  projectName: "qcrm-t-01995f7e-7b52-7000-8000-000000000201",
};

const manifest = {
  schemaVersion: 1,
  tenantProfileId: request.tenantProfileId,
  serverId: request.serverId,
  releaseId: request.releaseId,
  release: {
    id: request.releaseId,
    version: "1",
    artifacts: platformReleaseArtifactNames.map((name, index) => ({
      name,
      digest: `sha256:${index.toString(16).padStart(64, "0")}`,
    })),
  },
};

function psOutput(): string {
  return JSON.stringify(
    tenantContainerServiceNames.map((Service) => ({
      Service,
      State: "running",
      Health: "healthy",
    })),
  );
}

describe("tenant compose runner", () => {
  it("validates the manifest, runs fixed compose commands and observes readiness", async () => {
    const root = join(process.cwd(), ".tmp-compose-runner-test");
    const configurationRoot = join(root, "configuration");
    const databaseSecretRoot = join(root, "secrets");
    const manifestPath = join(configurationRoot, request.manifestRef);
    await mkdir(join(configurationRoot, "tenant", request.tenantProfileId), { recursive: true });
    await mkdir(join(databaseSecretRoot, request.tenantProfileId), { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
    await writeFile(join(databaseSecretRoot, request.tenantProfileId, "runtime-url"), "not-a-url", {
      mode: 0o400,
    });
    const results: ComposeCommandResult[] = [
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: psOutput(), stderr: "" },
    ];
    const run = vi.fn(async () => results.shift() ?? { exitCode: 1, stdout: "", stderr: "" });
    const reconciler = createTenantComposeReconciler({
      configurationRoot,
      composeTemplate: "/opt/quantum/infra/compose/tenant.yaml",
      imageRegistry: "ghcr.io/example/quantum-crm",
      environment: "staging",
      tenantEdgeNetworkPrefix: "qcrm-tenant-edge",
      platformDatabaseNetwork: "qcrm-platform-database",
      platformStorageNetwork: "qcrm-platform-storage",
      databaseSecretRoot,
      commandRunner: { run },
    });

    try {
      await expect(reconciler.reconcile(request)).resolves.toMatchObject({
        projectName: request.projectName,
        ready: true,
        reconciled: true,
      });
      expect(run).toHaveBeenCalledTimes(3);
      expect(run.mock.calls[0]?.[0]).toEqual([
        "compose",
        "-f",
        "/opt/quantum/infra/compose/tenant.yaml",
        "--project-name",
        request.projectName,
        "config",
        "--quiet",
      ]);
      expect(run.mock.calls[1]?.[0]).toContain("--remove-orphans");
      expect(run.mock.calls[0]?.[1]).toMatchObject({
        QCRM_TENANT_EDGE_NETWORK: `qcrm-tenant-edge-${request.tenantProfileId}`,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
