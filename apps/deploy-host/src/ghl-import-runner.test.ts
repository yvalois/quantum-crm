import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { platformReleaseArtifactNames } from "@quantum-crm/platform-domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTenantGhlImportRunner, parseGhlImportReceipt } from "./ghl-import-runner.js";
import { HostAdapterError, type HostAdapterGhlImportRequest } from "./host-adapter.js";

const request: HostAdapterGhlImportRequest = {
  action: "RUN_TENANT_GHL_IMPORT",
  operationId: "01995f7e-7b52-7000-8000-000000000101",
  tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
  serverId: "01995f7e-7b52-7000-8000-000000000301",
  releaseId: "01995f7e-7b52-7000-8000-000000000302",
  exportId: "01995f7e-7b52-7000-8000-000000000401",
  manifestRef: "tenant/01995f7e-7b52-7000-8000-000000000201/configuration.json",
  configurationRevision: 1n,
  attempt: 1,
  projectName: "qcrm-t-01995f7e-7b52-7000-8000-000000000201",
  mode: "APPLY",
};
const imageId = `sha256:${"a".repeat(64)}`;
const migratorImageId = `sha256:${"f".repeat(64)}`;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "qcrm-ghl-runner-"));
  roots.push(root);
  const configurationRoot = join(root, "configuration");
  const databaseSecretRoot = join(root, "secrets");
  const exportRoot = join(root, "exports");
  const jobDirectory = join(configurationRoot, "tenant", request.tenantProfileId, "ghl-imports");
  await mkdir(jobDirectory, { recursive: true });
  await mkdir(join(databaseSecretRoot, request.tenantProfileId), { recursive: true });
  await mkdir(join(exportRoot, request.exportId), { recursive: true });
  const compact = request.tenantProfileId.replaceAll("-", "");
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
      buckets: ["INCOMING", "OBJECTS"].map((kind) => ({
        kind,
        bucketName: `qcrm-${compact}-${kind.toLowerCase()}`,
        quotaMiB: 10240,
        versioning: "ENABLED",
      })),
      secrets: [
        {
          kind: "ACCESS_KEY",
          secretRef: `tenant/${request.tenantProfileId}/storage-access-key`,
          version: "1",
        },
        {
          kind: "SECRET_KEY",
          secretRef: `tenant/${request.tenantProfileId}/storage-secret-key`,
          version: "1",
        },
      ],
    },
    identity: {
      crmWebOrigin: "https://acme.2-25-172-119.nip.io",
      issuer: `https://identity.example.test/realms/qcrm-${compact}`,
      crmWebClientId: "quantum-crm-web",
      apiAudience: "quantum-crm-api",
    },
  };
  await writeFile(join(configurationRoot, request.manifestRef), JSON.stringify(manifest), {
    mode: 0o600,
  });
  const databaseFile = join(databaseSecretRoot, request.tenantProfileId, "runtime-url");
  await writeFile(databaseFile, "synthetic-runtime-secret", { mode: 0o400 });
  await writeFile(
    join(databaseSecretRoot, request.tenantProfileId, "migrator-url"),
    "synthetic-migrator-secret",
    { mode: 0o400 },
  );
  const exportKeyFile = join(databaseSecretRoot, "export-key");
  await writeFile(exportKeyFile, "synthetic-key", { mode: 0o400 });
  const artifactFile = join(exportRoot, request.exportId, "records.qcrm");
  await writeFile(artifactFile, "encrypted-synthetic-artifact", { mode: 0o600 });
  const approved = {
    schemaVersion: 1,
    operationId: request.operationId,
    tenantProfileId: request.tenantProfileId,
    serverId: request.serverId,
    releaseId: request.releaseId,
    configurationRevision: "1",
    exportId: request.exportId,
    workerImageId: imageId,
    migratorImageId,
    artifactSha256: createHash("sha256").update("encrypted-synthetic-artifact").digest("hex"),
    locationId: "synthetic-location",
    currency: "USD",
    developmentBackupException: true,
  };
  const jobFile = join(jobDirectory, `${request.exportId}.json`);
  const registered = JSON.stringify(approved);
  await writeFile(jobFile, registered, { mode: 0o600 });
  let started = false;
  let exited = false;
  let internal = true;
  let currentMode = request.mode;
  const container = () =>
    JSON.stringify([
      {
        Name: `/qcrm-ghl-${request.operationId}-${currentMode.toLowerCase()}-${request.attempt}`,
        Image: currentMode === "MIGRATE" ? migratorImageId : imageId,
        Config: {
          Labels: {
            "com.quantum.operation-id": request.operationId,
            "com.quantum.tenant-id": request.tenantProfileId,
            "com.quantum.ghl-export-id": request.exportId,
            "com.quantum.ghl-job-sha256": createHash("sha256").update(registered).digest("hex"),
            "com.quantum.ghl-import-mode": currentMode,
          },
        },
        State: { Status: exited ? "exited" : "running", Running: !exited, ExitCode: 0 },
      },
    ]);
  const run = vi.fn(async (args: readonly string[]) => {
    if (args[0] === "container")
      return started
        ? { exitCode: 0, stdout: container(), stderr: "" }
        : { exitCode: 1, stdout: "[]", stderr: "Error: No such container" };
    if (args[0] === "network")
      return { exitCode: 0, stdout: JSON.stringify([{ Internal: internal }]), stderr: "" };
    if (args[0] === "run") started = true;
    return { exitCode: 0, stdout: "", stderr: "" };
  });
  const options = {
    configurationRoot,
    databaseSecretRoot,
    exportRoot,
    exportKeyFile,
    composeTemplate: "/opt/quantum/infra/compose/tenant.yaml",
    imageRegistry: "ghcr.io/example/quantum-crm",
    environment: "staging" as const,
    tenantEdgeNetworkPrefix: "qcrm-tenant-edge",
    platformDatabaseNetwork: "qcrm-platform-database",
    platformStorageNetwork: "qcrm-platform-storage",
    platformSessionNetwork: "qcrm-platform-session",
    platformOidcNetwork: "qcrm-platform-oidc",
    storagePublicEndpoint: "https://files.example.test",
    commandRunner: { run },
  };
  return {
    options,
    run,
    approved,
    jobFile,
    artifactFile,
    databaseFile,
    root,
    finish: () => {
      exited = true;
    },
    externalNetwork: () => {
      internal = false;
    },
    migrationMode: () => {
      currentMode = "MIGRATE";
    },
  };
}

describe("registered GHL import host job", () => {
  it("returns only allowlisted aggregate progress and verification counters from worker logs", () => {
    const receipt = parseGhlImportReceipt(
      [
        "unstructured error containing pii-canary@example.test",
        JSON.stringify({ event: "unknown_event", secret: "credential-canary" }),
        JSON.stringify({
          event: "ghl_import_progress",
          resource: "CONTACTS",
          processed: 4,
          created: 3,
          replayed: 1,
          conflicts: 0,
          total: 4,
          email: "pii-canary@example.test",
        }),
        JSON.stringify({
          event: "ghl_import_verification",
          artifactRecords: 10,
          consistent: true,
          locationId: "private-location-canary",
          operation: { status: "COMPLETE", operatorMemberId: "private-member-canary" },
          contacts: { mappedContacts: 4, existingContacts: 4, sourcePayload: "payload-canary" },
          conversations: { messageCount: 6, outboxCount: 0, body: "body-canary" },
        }),
      ].join("\n"),
    );
    expect(receipt).toEqual({
      status: "COMPLETE",
      consistent: true,
      artifactRecords: 10,
      progress: [
        { resource: "CONTACTS", processed: 4, created: 3, replayed: 1, conflicts: 0, total: 4 },
      ],
      counters: {
        "contacts.mappedContacts": 4,
        "contacts.existingContacts": 4,
        "conversations.messageCount": 6,
        "conversations.outboxCount": 0,
      },
    });
    expect(JSON.stringify(receipt)).not.toContain("canary");
    expect(
      parseGhlImportReceipt(
        JSON.stringify({
          event: "ghl_import_failed",
          code: "IMPORT_FAILED",
          error: "driver-canary",
        }),
      ),
    ).toEqual({ progress: [], errorCode: "IMPORT_FAILED" });
  });

  it("launches only the pinned worker with exact read-only files, internal network and fixed command", async () => {
    const f = await fixture();
    await expect(createTenantGhlImportRunner(f.options).run(request)).resolves.toEqual({
      state: "RUNNING",
      reconciled: false,
    });
    const args = f.run.mock.calls.find(([args]) => args[0] === "run")?.[0] ?? [];
    expect(args.slice(-3)).toEqual(["node", imageId, "dist/ghl-migration-import-cli.js"]);
    expect(args).toContain(
      `type=bind,source=${f.databaseFile},target=/run/secrets/qcrm_database_url,readonly`,
    );
    expect(args).toContain("QCRM_GHL_IMPORT_DEVELOPMENT_EXCEPTION=true");
    expect(args).toContain("QCRM_GHL_IMPORT_MODE=APPLY");
    expect(args).toContain("no-new-privileges");
    expect(args).not.toContain("up");
    expect(args.join(" ")).not.toContain("migrator-url");
    expect(args.join(" ")).not.toContain("qcrm_ghl_migration_token");
  });

  it("observes an existing successful job without running or deleting it again", async () => {
    const f = await fixture();
    const subject = createTenantGhlImportRunner(f.options);
    await subject.run(request);
    f.finish();
    await expect(subject.run(request)).resolves.toEqual({
      state: "SUCCEEDED",
      exitCode: 0,
      reconciled: true,
    });
    expect(f.run.mock.calls.filter(([args]) => args[0] === "run")).toHaveLength(1);
  });

  it("runs the registered candidate migrator with only the target migration credential", async () => {
    const f = await fixture();
    f.migrationMode();
    await expect(
      createTenantGhlImportRunner(f.options).run({ ...request, mode: "MIGRATE" }),
    ).resolves.toMatchObject({ state: "RUNNING" });
    const args = f.run.mock.calls.find(([args]) => args[0] === "run")?.[0] ?? [];
    expect(args.at(-1)).toBe(migratorImageId);
    expect(args).toContain(
      "QCRM_MIGRATION_DATABASE_URL_FILE=/run/secrets/qcrm_migration_database_url",
    );
    expect(args.join(" ")).toContain("migrator-url");
    expect(args.join(" ")).not.toContain("runtime-url");
    expect(args.join(" ")).not.toContain("ghl_export_key");
    expect(args.join(" ")).not.toContain("ghl-migration-import-cli");
  });

  it("rejects corruption before any Docker command", async () => {
    const f = await fixture();
    await writeFile(f.artifactFile, "different-ciphertext");
    await expect(createTenantGhlImportRunner(f.options).run(request)).rejects.toEqual(
      new HostAdapterError("IDENTITY_MISMATCH"),
    );
    expect(f.run).not.toHaveBeenCalled();
  });

  it("rejects another tenant's registry and never obtains its database credential", async () => {
    const f = await fixture();
    await writeFile(
      f.jobFile,
      JSON.stringify({ ...f.approved, tenantProfileId: request.serverId }),
    );
    await expect(createTenantGhlImportRunner(f.options).run(request)).rejects.toEqual(
      new HostAdapterError("IDENTITY_MISMATCH"),
    );
    expect(f.run).not.toHaveBeenCalled();
  });

  it("rejects a source symlink, including one whose bytes have the approved checksum", async () => {
    const f = await fixture();
    await rm(f.artifactFile);
    const external = join(f.root, "external-records.qcrm");
    await writeFile(external, "encrypted-synthetic-artifact", { mode: 0o600 });
    await symlink(external, f.artifactFile);
    await expect(createTenantGhlImportRunner(f.options).run(request)).rejects.toEqual(
      new HostAdapterError("IDENTITY_MISMATCH"),
    );
    expect(f.run).not.toHaveBeenCalled();
  });

  it("never applies the development backup exception in production", async () => {
    const f = await fixture();
    await expect(
      createTenantGhlImportRunner({ ...f.options, environment: "production" }).run(request),
    ).rejects.toEqual(new HostAdapterError("IDENTITY_MISMATCH"));
    expect(f.run).not.toHaveBeenCalled();
  });

  it("refuses a database network with external egress", async () => {
    const f = await fixture();
    f.externalNetwork();
    await expect(createTenantGhlImportRunner(f.options).run(request)).rejects.toEqual(
      new HostAdapterError("IDENTITY_MISMATCH"),
    );
    expect(f.run.mock.calls.some(([args]) => args[0] === "run")).toBe(false);
  });
});
