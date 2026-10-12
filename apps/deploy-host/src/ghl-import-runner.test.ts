import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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

async function fixture(participants = false) {
  const root = await mkdtemp(join(tmpdir(), "qcrm-ghl-runner-"));
  roots.push(root);
  const configurationRoot = join(root, "configuration");
  const databaseSecretRoot = join(root, "secrets");
  const exportRoot = join(root, "exports");
  const jobDirectory = join(configurationRoot, "tenant", request.tenantProfileId, "ghl-imports");
  await mkdir(jobDirectory, { recursive: true });
  await mkdir(join(databaseSecretRoot, request.tenantProfileId), { recursive: true });
  const storageDirectory = join(databaseSecretRoot, "tenant", request.tenantProfileId);
  await mkdir(storageDirectory, { recursive: true });
  const storageAccessKeyFile = join(storageDirectory, "storage-access-key");
  await writeFile(storageAccessKeyFile, "synthetic-storage-access", { mode: 0o400 });
  await writeFile(join(storageDirectory, "storage-secret-key"), "synthetic-storage-secret", {
    mode: 0o400,
  });
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
  const tokenFile = join(databaseSecretRoot, "migration-token");
  await writeFile(tokenFile, "synthetic-roster-token", { mode: 0o400 });
  const participantsCandidate = {
    commit: "c".repeat(40),
    workerImageId: `sha256:${"d".repeat(64)}`,
    migratorImageId: `sha256:${"e".repeat(64)}`,
    tokenFile,
  };
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
  let storageInternal = true;
  let egressCreated = false;
  let foreignEgress = false;
  let currentMode = participants ? ("VERIFY" as const) : request.mode;
  const labels = () => ({
    "com.quantum.operation-id": request.operationId,
    "com.quantum.tenant-id": request.tenantProfileId,
    "com.quantum.ghl-export-id": request.exportId,
    "com.quantum.ghl-job-sha256": createHash("sha256").update(registered).digest("hex"),
    "com.quantum.ghl-import-mode": currentMode,
    ...(participants
      ? { "com.quantum.ghl-participants-commit": participantsCandidate.commit }
      : {}),
  });
  const container = () =>
    JSON.stringify([
      {
        Name: `/qcrm-ghl-${request.operationId}-${participants ? `participants-${participantsCandidate.commit}-` : ""}${currentMode.toLowerCase()}-${request.attempt}`,
        Image:
          currentMode === "MIGRATE"
            ? participants
              ? participantsCandidate.migratorImageId
              : migratorImageId
            : participants
              ? participantsCandidate.workerImageId
              : imageId,
        Config: {
          Labels: labels(),
        },
        State: { Status: exited ? "exited" : "running", Running: !exited, ExitCode: 0 },
      },
    ]);
  const run = vi.fn(async (args: readonly string[]) => {
    if (args[0] === "container")
      return started
        ? { exitCode: 0, stdout: container(), stderr: "" }
        : { exitCode: 1, stdout: "[]", stderr: "Error: No such container" };
    if (args[0] === "network") {
      if (args[1] === "create") {
        egressCreated = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (args[2]?.endsWith("-egress")) {
        if (!egressCreated && !foreignEgress)
          return { exitCode: 1, stdout: "", stderr: "network not found" };
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              Name: args[2],
              Driver: "bridge",
              Internal: false,
              Attachable: false,
              Scope: "local",
              Options: { "com.docker.network.bridge.enable_icc": "false" },
              Labels: foreignEgress
                ? { ...labels(), "com.quantum.tenant-id": request.serverId }
                : labels(),
              Containers: {},
            },
          ]),
          stderr: "",
        };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify([
          { Internal: args[2] === "qcrm-platform-storage" ? storageInternal : internal },
        ]),
        stderr: "",
      };
    }
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
    ...(participants ? { participantsCandidate } : {}),
  };
  return {
    options,
    run,
    approved,
    jobFile,
    artifactFile,
    databaseFile,
    storageAccessKeyFile,
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
    attachmentsMode: () => {
      currentMode = "ATTACHMENTS";
    },
    externalStorage: () => {
      storageInternal = false;
    },
    foreignEgress: () => {
      foreignEgress = true;
    },
  };
}

describe("registered GHL import host job", () => {
  it("returns only aggregate participants enrichment evidence", () => {
    const receipt = parseGhlImportReceipt(
      JSON.stringify({
        event: "ghl_participants_complete",
        status: "COMPLETE",
        total: 2,
        created: 2,
        replayed: 0,
        sourceReferences: 3,
        resolvedReferences: 3,
        privateName: "private-canary",
        token: "secret-canary",
      }),
    );
    expect(receipt).toMatchObject({
      status: "COMPLETE",
      consistent: true,
      counters: { "participants.resolvedReferences": 3 },
    });
    expect(JSON.stringify(receipt)).not.toContain("canary");
  });
  it("enriches only the registered target using candidate images without mutating its original registry", async () => {
    const f = await fixture(true);
    const before = await readFile(f.jobFile, "utf8");
    const runner = createTenantGhlImportRunner(f.options);
    await expect(runner.run({ ...request, mode: "VERIFY" })).resolves.toMatchObject({
      state: "RUNNING",
    });
    const args = f.run.mock.calls.find(([args]) => args[0] === "run")?.[0] ?? [];
    expect(args).toContain(`sha256:${"d".repeat(64)}`);
    expect(args).toContain("QCRM_GHL_IMPORT_MODE=PARTICIPANTS");
    expect(args).toContain("QCRM_GHL_MIGRATION_TOKEN_FILE=/run/secrets/qcrm_ghl_migration_token");
    expect(args.join(" ")).not.toContain("synthetic-roster-token");
    expect(args.join(" ")).not.toContain("migrator-url");
    expect(args.join(" ")).not.toContain("QCRM_FILES_");
    expect(await readFile(f.jobFile, "utf8")).toBe(before);
    f.finish();
    await expect(runner.run({ ...request, mode: "VERIFY" })).resolves.toMatchObject({
      state: "SUCCEEDED",
      reconciled: true,
    });
    expect(f.run.mock.calls.filter(([call]) => call[0] === "run")).toHaveLength(1);
  });

  it("never gives the supplemental migrator the GHL token or external network", async () => {
    const f = await fixture(true);
    f.migrationMode();
    await expect(
      createTenantGhlImportRunner(f.options).run({ ...request, mode: "MIGRATE" }),
    ).resolves.toMatchObject({ state: "RUNNING" });
    const args = f.run.mock.calls.find(([args]) => args[0] === "run")?.[0] ?? [];
    expect(args.at(-1)).toBe(`sha256:${"e".repeat(64)}`);
    expect(args.join(" ")).not.toContain("migration-token");
    expect(args.join(" ")).not.toContain("-egress");
    expect(args.join(" ")).not.toContain("runtime-url");
  });

  it("rejects using the supplemental candidate for APPLY or unvalidated candidate digests", async () => {
    const f = await fixture(true);
    await expect(createTenantGhlImportRunner(f.options).run(request)).rejects.toEqual(
      new HostAdapterError("IDENTITY_MISMATCH"),
    );
    await expect(
      createTenantGhlImportRunner({
        ...f.options,
        participantsCandidate: { ...f.options.participantsCandidate!, workerImageId: "latest" },
      }).run({ ...request, mode: "VERIFY" }),
    ).rejects.toEqual(new HostAdapterError("IDENTITY_MISMATCH"));
    expect(f.run).not.toHaveBeenCalled();
  });
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

  it("launches attachments with isolated egress, internal storage, scoped Files secrets and a fixed command", async () => {
    const f = await fixture();
    f.attachmentsMode();
    const subject = createTenantGhlImportRunner(f.options);
    await expect(subject.run({ ...request, mode: "ATTACHMENTS" })).resolves.toMatchObject({
      state: "RUNNING",
    });
    const args = f.run.mock.calls.find(([args]) => args[0] === "run")?.[0] ?? [];
    const network = `qcrm-ghl-${request.operationId}-attachments-1-egress`;
    expect(args.slice(-3)).toEqual(["node", imageId, "dist/ghl-migration-attachments-cli.js"]);
    expect(args.filter((_, index) => args[index - 1] === "--network")).toEqual([
      "qcrm-platform-database",
      "qcrm-platform-storage",
      network,
    ]);
    expect(args).toContain(
      `type=bind,source=${f.storageAccessKeyFile},target=/run/secrets/qcrm_files_s3_upload_access_key,readonly`,
    );
    expect(args).toContain(
      `type=bind,source=${f.storageAccessKeyFile},target=/run/secrets/qcrm_files_s3_delivery_access_key,readonly`,
    );
    expect(args).toContain(
      `type=bind,source=${f.storageAccessKeyFile},target=/run/secrets/qcrm_files_s3_processor_access_key,readonly`,
    );
    expect(args).toContain("QCRM_FILES_S3_ENDPOINT=http://platform-storage:8333");
    expect(args).toContain("QCRM_FILES_S3_PUBLIC_ENDPOINT=https://files.example.test");
    expect(args).toContain("QCRM_GHL_IMPORT_MODE=APPLY");
    expect(args).toContain("QCRM_FILES_WORKER_POLL_INTERVAL_MS=250");
    expect(args).toContain("QCRM_FILES_CLAMAV_MAX_SIGNATURE_AGE_SECONDS=172800");
    expect(args).toContain("QCRM_FILES_CLAMAV_HOST=platform-clamav");
    expect(args.join(" ")).not.toMatch(/qcrm_ghl_migration_token|synthetic-storage/);
    const create =
      f.run.mock.calls.find(([args]) => args[0] === "network" && args[1] === "create")?.[0] ?? [];
    expect(create).toContain("com.docker.network.bridge.enable_icc=false");
    expect(create).toContain(`com.quantum.tenant-id=${request.tenantProfileId}`);
    f.finish();
    await expect(subject.run({ ...request, mode: "ATTACHMENTS" })).resolves.toMatchObject({
      state: "SUCCEEDED",
      reconciled: true,
    });
    expect(f.run.mock.calls.filter(([args]) => args[0] === "run")).toHaveLength(1);
    expect(
      f.run.mock.calls.filter(([args]) => args[0] === "network" && args[1] === "create"),
    ).toHaveLength(1);
  });

  it("rejects an attachment storage network with egress before creating its private bridge", async () => {
    const f = await fixture();
    f.attachmentsMode();
    f.externalStorage();
    await expect(
      createTenantGhlImportRunner(f.options).run({ ...request, mode: "ATTACHMENTS" }),
    ).rejects.toEqual(new HostAdapterError("IDENTITY_MISMATCH"));
    expect(f.run.mock.calls.some(([args]) => args[0] === "run" || args[1] === "create")).toBe(
      false,
    );
  });

  it("never reuses another tenant's egress bridge", async () => {
    const f = await fixture();
    f.attachmentsMode();
    f.foreignEgress();
    await expect(
      createTenantGhlImportRunner(f.options).run({ ...request, mode: "ATTACHMENTS" }),
    ).rejects.toEqual(new HostAdapterError("IDENTITY_MISMATCH"));
    expect(f.run.mock.calls.some(([args]) => args[0] === "run" || args[1] === "create")).toBe(
      false,
    );
  });

  it("rejects a substituted storage secret before any Docker command", async () => {
    const f = await fixture();
    f.attachmentsMode();
    await rm(f.storageAccessKeyFile);
    await symlink(f.databaseFile, f.storageAccessKeyFile);
    await expect(
      createTenantGhlImportRunner(f.options).run({ ...request, mode: "ATTACHMENTS" }),
    ).rejects.toEqual(new HostAdapterError("IDENTITY_MISMATCH"));
    expect(f.run).not.toHaveBeenCalled();
  });

  it("returns numeric attachment aggregates without URLs, names, credentials or provider errors", () => {
    const receipt = parseGhlImportReceipt(
      [
        JSON.stringify({
          event: "ghl_attachment_import_progress",
          total: 10,
          processed: 4,
          available: 2,
          pending: 2,
          bytes: 1024,
          sourceUrl: "https://secret-canary.test",
          filename: "private-canary",
        }),
        JSON.stringify({
          event: "ghl_attachment_import_completed",
          total: 10,
          processed: 10,
          available: 7,
          rejected: 1,
          failed: 2,
          pending: 0,
          bytes: 12345,
          error: "credential-canary",
          body: "private-canary",
        }),
      ].join("\n"),
    );
    expect(receipt).toEqual({
      progress: [],
      counters: {
        "attachments.total": 10,
        "attachments.processed": 10,
        "attachments.available": 7,
        "attachments.rejected": 1,
        "attachments.failed": 2,
        "attachments.pending": 0,
        "attachments.bytes": 12345,
      },
    });
    expect(JSON.stringify(receipt)).not.toContain("canary");
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
