import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  platformReleaseArtifactNames,
  tenantContainerServiceNames,
} from "@quantum-crm/platform-domain";

import {
  createTenantComposeReconciler,
  createTenantCrmMigrationReconciler,
  type ComposeCommandResult,
} from "./compose-runner.js";
import {
  HostAdapterError,
  type HostAdapterMigrationRequest,
  type HostAdapterRequest,
} from "./host-adapter.js";

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
  storage: {
    endpoint: "http://platform-storage:8333",
    buckets: [
      {
        kind: "INCOMING",
        bucketName: "qcrm-01995f7e7b5270008000000000000201-incoming",
        quotaMiB: 10240,
        versioning: "ENABLED",
      },
      {
        kind: "OBJECTS",
        bucketName: "qcrm-01995f7e7b5270008000000000000201-objects",
        quotaMiB: 10240,
        versioning: "ENABLED",
      },
    ],
    secrets: [
      {
        kind: "ACCESS_KEY",
        secretRef: "tenant/01995f7e-7b52-7000-8000-000000000201/storage-access-key",
        version: "1",
      },
      {
        kind: "SECRET_KEY",
        secretRef: "tenant/01995f7e-7b52-7000-8000-000000000201/storage-secret-key",
        version: "1",
      },
    ],
  },
  identity: {
    crmWebOrigin: "https://acme.2-25-172-119.nip.io",
    issuer: "https://identity.example.test/realms/qcrm-01995f7e7b5270008000000000000201",
    crmWebClientId: "quantum-crm-web",
    apiAudience: "quantum-crm-api",
  },
};

function psOutput(unhealthyService?: string): string {
  return JSON.stringify(
    tenantContainerServiceNames.map((Service) => ({
      Service,
      State: "running",
      Health: Service === unhealthyService ? "starting" : "healthy",
    })),
  );
}

async function createFixture(): Promise<{
  readonly root: string;
  readonly configurationRoot: string;
  readonly databaseSecretRoot: string;
}> {
  const root = join(process.cwd(), `.tmp-compose-runner-test-${Date.now()}`);
  const configurationRoot = join(root, "configuration");
  const databaseSecretRoot = join(root, "secrets");
  const manifestPath = join(configurationRoot, request.manifestRef);
  await mkdir(join(configurationRoot, "tenant", request.tenantProfileId), { recursive: true });
  await mkdir(join(databaseSecretRoot, request.tenantProfileId), { recursive: true });
  await mkdir(join(databaseSecretRoot, "tenant", request.tenantProfileId), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  await writeFile(join(databaseSecretRoot, request.tenantProfileId, "runtime-url"), "not-a-url", {
    mode: 0o400,
  });
  await writeFile(join(databaseSecretRoot, request.tenantProfileId, "migrator-url"), "not-a-url", {
    mode: 0o400,
  });
  await writeFile(
    join(databaseSecretRoot, request.tenantProfileId, "oidc-client-secret"),
    "synthetic-oidc-secret",
    { mode: 0o400 },
  );
  await writeFile(
    join(databaseSecretRoot, request.tenantProfileId, "session-redis-url"),
    "redis://session:synthetic@redis:6379/0",
    { mode: 0o400 },
  );
  await writeFile(
    join(databaseSecretRoot, "tenant", request.tenantProfileId, "storage-access-key"),
    "synthetic-storage-access-key",
    { mode: 0o400 },
  );
  await writeFile(
    join(databaseSecretRoot, "tenant", request.tenantProfileId, "storage-secret-key"),
    "synthetic-storage-secret-key",
    { mode: 0o400 },
  );
  return { root, configurationRoot, databaseSecretRoot };
}

function createReconciler(
  configurationRoot: string,
  databaseSecretRoot: string,
  run: (
    args: readonly string[],
    environment: Readonly<Record<string, string>>,
    timeout: number,
  ) => Promise<ComposeCommandResult>,
) {
  return createTenantComposeReconciler({
    configurationRoot,
    composeTemplate: "/opt/quantum/infra/compose/tenant.yaml",
    imageRegistry: "ghcr.io/example/quantum-crm",
    environment: "staging",
    tenantEdgeNetworkPrefix: "qcrm-tenant-edge",
    platformDatabaseNetwork: "qcrm-platform-database",
    platformStorageNetwork: "qcrm-platform-storage",
    platformSessionNetwork: "qcrm-platform-session",
    platformOidcNetwork: "qcrm-platform-oidc",
    databaseSecretRoot,
    storagePublicEndpoint: "https://files.example.test",
    commandRunner: { run },
  });
}

describe("tenant compose runner", () => {
  it("validates the manifest, runs fixed compose commands and observes readiness", async () => {
    const { root, configurationRoot, databaseSecretRoot } = await createFixture();
    const results: ComposeCommandResult[] = [
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: psOutput(), stderr: "" },
    ];
    const run = vi.fn(async () => results.shift() ?? { exitCode: 1, stdout: "", stderr: "" });
    const reconciler = createReconciler(configurationRoot, databaseSecretRoot, run);

    try {
      await expect(reconciler.reconcile(request)).resolves.toMatchObject({
        projectName: request.projectName,
        ready: true,
        reconciled: true,
      });
      expect(run).toHaveBeenCalledTimes(4);
      expect(run.mock.calls[1]?.[0]).toEqual([
        "compose",
        "-f",
        "/opt/quantum/infra/compose/tenant.yaml",
        "--project-name",
        request.projectName,
        "config",
        "--quiet",
      ]);
      expect(run.mock.calls[2]?.[0]).toContain("--remove-orphans");
      expect(run.mock.calls[0]?.[1]).toMatchObject({
        QCRM_TENANT_EDGE_NETWORK: `qcrm-tenant-edge-${request.tenantProfileId}`,
        QCRM_FILES_S3_PUBLIC_ENDPOINT: "https://files.example.test",
        QCRM_FILES_INCOMING_BUCKET: "qcrm-01995f7e7b5270008000000000000201-incoming",
        QCRM_FILES_OBJECTS_BUCKET: "qcrm-01995f7e7b5270008000000000000201-objects",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns pending readiness when one service is not healthy", async () => {
    const { root, configurationRoot, databaseSecretRoot } = await createFixture();
    const results: ComposeCommandResult[] = [
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: psOutput("worker"), stderr: "" },
    ];
    const run = vi.fn(async () => results.shift() ?? { exitCode: 1, stdout: "", stderr: "" });
    try {
      await expect(
        createReconciler(configurationRoot, databaseSecretRoot, run).reconcile(request),
      ).resolves.toMatchObject({
        ready: false,
        reconciled: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs only crm-migrator for the fenced migration request", async () => {
    const { root, configurationRoot, databaseSecretRoot } = await createFixture();
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const migration: HostAdapterMigrationRequest = {
      ...request,
      action: "MIGRATE_TENANT_CRM_DATABASE",
    };
    try {
      await expect(
        createTenantCrmMigrationReconciler({
          configurationRoot,
          composeTemplate: "/opt/quantum/infra/compose/tenant.yaml",
          imageRegistry: "ghcr.io/example/quantum-crm",
          environment: "staging",
          tenantEdgeNetworkPrefix: "qcrm-tenant-edge",
          platformDatabaseNetwork: "qcrm-platform-database",
          platformStorageNetwork: "qcrm-platform-storage",
          platformSessionNetwork: "qcrm-platform-session",
          platformOidcNetwork: "qcrm-platform-oidc",
          databaseSecretRoot,
          storagePublicEndpoint: "https://files.example.test",
          commandRunner: { run },
        }).migrate(migration),
      ).resolves.toEqual({ migrated: true, reconciled: true });
      expect(run).toHaveBeenCalledWith(
        expect.arrayContaining(["run", "--no-deps", "crm-migrator"]),
        expect.any(Object),
        expect.any(Number),
      );
      expect(run.mock.calls[0]?.[0]).not.toContain("up");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a malformed manifest before invoking Docker", async () => {
    const { root, configurationRoot, databaseSecretRoot } = await createFixture();
    await writeFile(
      join(configurationRoot, request.manifestRef),
      JSON.stringify({ ...manifest, release: { ...manifest.release, version: "0" } }),
      { mode: 0o600 },
    );
    const run = vi.fn(async () => ({ exitCode: 0, stdout: psOutput(), stderr: "" }));
    try {
      await expect(
        createReconciler(configurationRoot, databaseSecretRoot, run).reconcile(request),
      ).rejects.toEqual(new HostAdapterError("IDENTITY_MISMATCH"));
      expect(run).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a concurrent reconciliation for the same project", async () => {
    const { root, configurationRoot, databaseSecretRoot } = await createFixture();
    let releaseFirst!: () => void;
    const firstCommandStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const run = vi.fn(async (args: readonly string[]) => {
      if (args.includes("config")) await firstCommandStarted;
      return { exitCode: 0, stdout: args.includes("ps") ? psOutput() : "", stderr: "" };
    });
    const reconciler = createReconciler(configurationRoot, databaseSecretRoot, run);
    const first = reconciler.reconcile(request);
    try {
      await expect(reconciler.reconcile(request)).rejects.toEqual(
        new HostAdapterError("TARGET_CONFLICT"),
      );
    } finally {
      releaseFirst();
      await first;
      await rm(root, { recursive: true, force: true });
    }
  });
});
