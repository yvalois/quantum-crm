import { execFile } from "node:child_process";
import { request as httpRequest } from "node:http";
import { chown, mkdir, open, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { createCommandRunner, type TenantComposeRunnerOptions } from "./compose-runner.js";
import { createTenantGhlImportRunner } from "./ghl-import-runner.js";
import { HostAdapterError, type HostAdapterGhlImportRequest } from "./host-adapter.js";

const execFileAsync = promisify(execFile);
const commitPattern = /^[0-9a-f]{40}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const ghlCandidateApps = ["worker", "api", "crm-web", "deploy-host", "crm-migrator"] as const;
export type GhlCandidateApp = typeof ghlCandidateApps[number];
const configurationRoot = "/opt/quantum/config/staging/tenants";
const docker = createCommandRunner("/usr/bin/docker");

interface ContainerInspection {
  readonly Id: string;
  readonly Name: string;
  readonly Image: string;
  readonly Config: { readonly Image: string; readonly Env: readonly string[];
    readonly Labels: Readonly<Record<string, string>>; readonly [key: string]: unknown };
  readonly HostConfig: Readonly<Record<string, unknown>>;
  readonly NetworkSettings: { readonly Networks: Readonly<Record<string, { readonly Aliases?: readonly string[] }>> };
  readonly State: { readonly Running: boolean; readonly Health?: { readonly Status: string } };
}

export type CandidateDockerApi = (method: string, path: string, body?: unknown) => Promise<unknown>;

async function dockerApi(method: string, path: string, body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const request = httpRequest({ socketPath: "/var/run/docker.sock", path, method,
      headers: encoded === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(encoded) } }, (response) => {
      let content = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        content += chunk;
        if (Buffer.byteLength(content) > 2_097_152) request.destroy(new Error("docker response too large"));
      });
      response.on("end", () => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) { reject(new HostAdapterError(status === 404 ? "UNAVAILABLE" : "TARGET_CONFLICT")); return; }
        try { resolve(content ? JSON.parse(content) as unknown : undefined); }
        catch { reject(new HostAdapterError("UNAVAILABLE")); }
      });
    });
    request.setTimeout(60_000, () => request.destroy(new Error("docker operation timed out")));
    request.on("error", () => reject(new HostAdapterError("UNAVAILABLE")));
    request.end(encoded);
  });
}

async function inspectContainer(name: string): Promise<ContainerInspection> {
  return await dockerApi("GET", `/containers/${encodeURIComponent(name)}/json`) as ContainerInspection;
}

async function candidateRoot(commit: string): Promise<string> {
  if (!commitPattern.test(commit)) throw new HostAdapterError("IDENTITY_MISMATCH");
  const root = `/opt/quantum/builds/${commit}`;
  if (await realpath(root) !== root) throw new HostAdapterError("IDENTITY_MISMATCH");
  const observed = await execFileAsync("/usr/bin/git", ["-C", root, "rev-parse", "HEAD"], { timeout: 10_000 });
  if (observed.stdout.trim() !== commit) throw new HostAdapterError("IDENTITY_MISMATCH");
  const status = await execFileAsync("/usr/bin/git", ["-C", root, "status", "--porcelain", "--untracked-files=normal"], { timeout: 10_000 });
  if (status.stdout.trim()) throw new HostAdapterError("IDENTITY_MISMATCH");
  return root;
}

async function candidateImage(commit: string, app: GhlCandidateApp): Promise<string | undefined> {
  const inspected = await docker.run(["image", "inspect", `qcrm-candidate/${app}:${commit}`], {}, 15_000);
  if (inspected.exitCode === 1 && inspected.stderr.includes("No such")) return undefined;
  if (inspected.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
  const result = JSON.parse(inspected.stdout) as { Id?: string; Config?: { Labels?: Record<string, unknown> } }[];
  const image = result[0];
  if (result.length !== 1 || !image?.Id || !/^sha256:[0-9a-f]{64}$/u.test(image.Id) ||
    image.Config?.Labels?.["org.opencontainers.image.revision"] !== commit ||
    image.Config.Labels["com.quantum.candidate-app"] !== app) throw new HostAdapterError("IDENTITY_MISMATCH");
  return image.Id;
}

/** The only bootstrap build entry: exact clean commit and five fixed Dockerfile targets. */
export async function buildGhlCandidate(commit: string, app: GhlCandidateApp) {
  if (!ghlCandidateApps.includes(app)) throw new HostAdapterError("IDENTITY_MISMATCH");
  const root = await candidateRoot(commit);
  const existing = await candidateImage(commit, app);
  if (existing) return { app, commit, imageId: existing, reused: true };
  const lockDirectory = `/opt/quantum/config/staging/candidates/${commit}`;
  await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
  const lockPath = join(lockDirectory, `${app}.lock`);
  const lock = await open(lockPath, "wx", 0o600).catch(() => { throw new HostAdapterError("TARGET_CONFLICT"); });
  try {
    const dockerfile = app === "crm-web" ? "Dockerfile.web" : app === "crm-migrator" ? "Dockerfile.crm-migrator" : "Dockerfile.node";
    const args = ["build", "--file", join(root, "infra", "docker", dockerfile),
      "--tag", `qcrm-candidate/${app}:${commit}`, "--label", `org.opencontainers.image.revision=${commit}`,
      "--label", `com.quantum.candidate-app=${app}`,
      ...(app === "crm-migrator" ? [] : ["--build-arg", `APP=${app}`]), root];
    const built = await docker.run(args, {}, 3_600_000);
    const redactedOutput = `${built.stdout}\n${built.stderr}`.split(/\r?\n/u)
      .map((line) => /(?:password|authorization|bearer|secret|token)[=: ]/iu.test(line) ? "[sensitive build line redacted]" : line)
      .join("\n");
    await writeFile(join(lockDirectory, `${app}.build.log`), redactedOutput, { mode: 0o600 });
    if (built.exitCode !== 0) {
      await writeFile(join(lockDirectory, `${app}.json`), JSON.stringify({ app, commit, state: "FAILED", exitCode: built.exitCode }), { mode: 0o600 });
      throw new HostAdapterError("UNAVAILABLE");
    }
    const imageId = await candidateImage(commit, app);
    if (!imageId) throw new HostAdapterError("UNAVAILABLE");
    await writeFile(join(lockDirectory, `${app}.json`), JSON.stringify({ app, commit, imageId, state: "SUCCEEDED", completedAt: new Date().toISOString() }), { mode: 0o600 });
    return { app, commit, imageId, reused: false };
  } finally { await lock.close(); await unlink(lockPath); }
}

/** Read only the non-secret runtime fields of the already-authorized resident adapter. */
async function hostOptions(): Promise<TenantComposeRunnerOptions> {
  const host = await inspectContainer("quantum-platform-deploy-host-1");
  const get = (name: string): string => {
    const value = host.Config.Env.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
    if (!value || /[\0\r\n]/u.test(value)) throw new HostAdapterError("IDENTITY_MISMATCH");
    return value;
  };
  if (get("QCRM_ENV") !== "staging" || get("QCRM_DEPLOY_HOST_CONFIGURATION_ROOT") !== configurationRoot) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  return { environment: "staging", configurationRoot,
    composeTemplate: get("QCRM_DEPLOY_HOST_COMPOSE_TEMPLATE"), imageRegistry: get("QCRM_DEPLOY_HOST_IMAGE_REGISTRY"),
    tenantEdgeNetworkPrefix: get("QCRM_DEPLOY_HOST_TENANT_EDGE_NETWORK"),
    platformDatabaseNetwork: get("QCRM_DEPLOY_HOST_PLATFORM_DATABASE_NETWORK"),
    platformStorageNetwork: get("QCRM_DEPLOY_HOST_PLATFORM_STORAGE_NETWORK"),
    platformSessionNetwork: get("QCRM_DEPLOY_HOST_PLATFORM_SESSION_NETWORK"),
    platformOidcNetwork: get("QCRM_DEPLOY_HOST_PLATFORM_OIDC_NETWORK"),
    databaseSecretRoot: get("QCRM_DEPLOY_HOST_DATABASE_SECRET_ROOT"),
    storagePublicEndpoint: get("QCRM_DEPLOY_HOST_STORAGE_PUBLIC_ENDPOINT") };
}

export async function registeredGhlRequest(tenantId: string, exportId: string,
  mode: HostAdapterGhlImportRequest["mode"], attempt: number): Promise<HostAdapterGhlImportRequest> {
  if (!uuidPattern.test(tenantId) || !uuidPattern.test(exportId) || !Number.isSafeInteger(attempt) || attempt < 1) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const job = JSON.parse(await readFile(join(configurationRoot, "tenant", tenantId, "ghl-imports", `${exportId}.json`), "utf8")) as Record<string, unknown>;
  if (job.tenantProfileId !== tenantId || job.exportId !== exportId || typeof job.operationId !== "string" ||
    !uuidPattern.test(job.operationId) || typeof job.serverId !== "string" || !uuidPattern.test(job.serverId) ||
    typeof job.releaseId !== "string" || !uuidPattern.test(job.releaseId) ||
    typeof job.configurationRevision !== "string" || !/^[1-9][0-9]*$/u.test(job.configurationRevision)) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  return { action: "RUN_TENANT_GHL_IMPORT", operationId: job.operationId, tenantProfileId: tenantId,
    serverId: job.serverId, releaseId: job.releaseId, configurationRevision: BigInt(job.configurationRevision),
    manifestRef: `tenant/${tenantId}/configuration.json`, projectName: `qcrm-t-${tenantId}`, exportId, mode, attempt };
}

export async function runRegisteredGhlImport(tenantId: string, exportId: string,
  mode: HostAdapterGhlImportRequest["mode"], attempt: number) {
  const typedRequest = await registeredGhlRequest(tenantId, exportId, mode, attempt);
  return createTenantGhlImportRunner(await hostOptions()).run(typedRequest);
}

export function candidateContainerBody(previous: ContainerInspection, imageId: string) {
  if (!/^sha256:[0-9a-f]{64}$/u.test(imageId)) throw new HostAdapterError("IDENTITY_MISMATCH");
  return { ...previous.Config, Image: imageId, HostConfig: { ...previous.HostConfig, AutoRemove: false },
    NetworkingConfig: { EndpointsConfig: Object.fromEntries(Object.entries(previous.NetworkSettings.Networks)
      .map(([network, settings]) => [network, { Aliases: (settings.Aliases ?? []).filter((alias) => !/^[0-9a-f]{12,64}$/u.test(alias)) }])) } };
}

export async function replaceGhlCandidateComponent(tenantId: string, app: "api" | "crm-web", commit: string, imageId: string,
  api: CandidateDockerApi = dockerApi) {
  const project = `qcrm-t-${tenantId}`;
  const name = `${project}-${app}-1`;
  const before = await api("GET", `/containers/${encodeURIComponent(name)}/json`) as ContainerInspection;
  if (before.Name !== `/${name}` || before.Config.Labels["com.docker.compose.project"] !== project ||
    before.Config.Labels["com.docker.compose.service"] !== app) throw new HostAdapterError("IDENTITY_MISMATCH");
  if (before.Image === imageId && before.State.Health?.Status === "healthy") return { app, imageId, reused: true };
  const backupName = `${name}-before-ghl-${commit.slice(0, 12)}`;
  // A named predecessor is retained for recovery; no volume or data is deleted.
  let candidateId: string | undefined;
  let stopRequested = false;
  let renamed = false;
  try {
    stopRequested = true;
    await api("POST", `/containers/${before.Id}/stop?t=30`);
    await api("POST", `/containers/${before.Id}/rename?name=${encodeURIComponent(backupName)}`);
    renamed = true;
    const created = await api("POST", `/containers/create?name=${encodeURIComponent(name)}`, candidateContainerBody(before, imageId)) as { Id?: string };
    if (!created.Id || !/^[0-9a-f]{64}$/u.test(created.Id)) throw new HostAdapterError("UNAVAILABLE");
    candidateId = created.Id;
    await api("POST", `/containers/${candidateId}/start`);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const observed = await api("GET", `/containers/${encodeURIComponent(name)}/json`) as ContainerInspection;
      if (observed.Image !== imageId) throw new HostAdapterError("IDENTITY_MISMATCH");
      if (observed.State.Running && observed.State.Health?.Status === "healthy") {
        return { app, imageId, reused: false, previousContainer: backupName };
      }
      if (!observed.State.Running || observed.State.Health?.Status === "unhealthy") throw new HostAdapterError("UNAVAILABLE");
      await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    }
    throw new HostAdapterError("UNAVAILABLE");
  } catch (error) {
    if (candidateId) await api("DELETE", `/containers/${candidateId}?force=true&v=false`);
    if (renamed) await api("POST", `/containers/${before.Id}/rename?name=${encodeURIComponent(name)}`);
    if (stopRequested) await api("POST", `/containers/${before.Id}/start`);
    throw error;
  }
}

/** Target only the two business services; preserve their observed config and every other image. */
export async function deployGhlCandidate(commit: string, tenantId: string, exportId: string) {
  await candidateRoot(commit);
  await registeredGhlRequest(tenantId, exportId, "VERIFY", 1);
  const apiImage = await candidateImage(commit, "api");
  const webImage = await candidateImage(commit, "crm-web");
  if (!apiImage || !webImage) throw new HostAdapterError("UNAVAILABLE");
  return [await replaceGhlCandidateComponent(tenantId, "api", commit, apiImage),
    await replaceGhlCandidateComponent(tenantId, "crm-web", commit, webImage)];
}

async function fixedSyntheticFile(path: string, content: string): Promise<void> {
  try { await writeFile(path, content, { flag: "wx", mode: 0o400 }); }
  catch (error) {
    if ((error as { code?: string }).code !== "EEXIST" || await readFile(path, "utf8") !== content) {
      throw new HostAdapterError("TARGET_CONFLICT");
    }
  }
  await chown(path, 1000, 1000);
}

/** Two synthetic profiles in a separate PostgreSQL instance, never the platform server. */
export async function setupGhlIntegrationTest(commit: string) {
  const root = await candidateRoot(commit);
  const migratorImage = await candidateImage(commit, "crm-migrator");
  if (!migratorImage) throw new HostAdapterError("UNAVAILABLE");
  const postgresImage = (await inspectContainer("quantum-platform-foundation-platform-postgres-1")).Image;
  if (!/^sha256:[0-9a-f]{64}$/u.test(postgresImage)) throw new HostAdapterError("IDENTITY_MISMATCH");
  const suffix = commit.slice(0, 12);
  const name = `qcrm-ghl-test-pg-${suffix}`;
  const network = `qcrm-ghl-test-${suffix}`;
  const testRoot = `/opt/quantum/test-secrets/ghl/${commit}`;
  await mkdir(join(testRoot, "init"), { recursive: true, mode: 0o700 });
  await fixedSyntheticFile(join(testRoot, "postgres-password"), "test-only-ghl-postgres");
  await fixedSyntheticFile(join(testRoot, "init", "10-ghl.sql"), await readFile(join(root, "tests/integration/fixtures/ghl-postgres-bootstrap.sql"), "utf8"));
  const observedNetwork = await docker.run(["network", "inspect", network], {}, 15_000);
  if (observedNetwork.exitCode !== 0) {
    const created = await docker.run(["network", "create", "--internal", "--label", `com.quantum.ghl-test=${commit}`, network], {}, 15_000);
    if (created.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
  } else {
    const networks = JSON.parse(observedNetwork.stdout) as { Internal?: boolean; Labels?: Record<string, string> }[];
    if (networks[0]?.Internal !== true || networks[0].Labels?.["com.quantum.ghl-test"] !== commit) throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const observedPostgres = await docker.run(["container", "inspect", name], {}, 15_000);
  if (observedPostgres.exitCode !== 0) {
    const started = await docker.run(["run", "--detach", "--pull", "never", "--name", name,
      "--network", network, "--publish", "127.0.0.1::5432", "--label", `com.quantum.ghl-test=${commit}`,
      "--memory", "2g", "--cpus", "1", "--pids-limit", "256", "--log-driver", "none",
      "--tmpfs", "/var/lib/postgresql:rw,nosuid,size=1g",
      "--env", "POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password",
      "--mount", `type=bind,source=${join(testRoot, "postgres-password")},target=/run/secrets/postgres-password,readonly`,
      "--mount", `type=bind,source=${join(testRoot, "init")},target=/docker-entrypoint-initdb.d,readonly`, postgresImage], {}, 30_000);
    if (started.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
  }
  const postgres = await inspectContainer(name);
  if (postgres.Config.Labels["com.quantum.ghl-test"] !== commit || postgres.Image !== postgresImage) throw new HostAdapterError("IDENTITY_MISMATCH");
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const probe = await docker.run(["exec", name, "pg_isready", "-U", "postgres", "-d", "postgres"], {}, 5_000);
    if (probe.exitCode === 0) { ready = true; break; }
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
  }
  if (!ready) throw new HostAdapterError("UNAVAILABLE");
  const ports = (postgres.NetworkSettings as unknown as { Ports: Record<string, { HostIp: string; HostPort: string }[]> }).Ports;
  const published = ports["5432/tcp"]?.[0];
  if (!published || published.HostIp !== "127.0.0.1" || !/^\d{1,5}$/u.test(published.HostPort)) throw new HostAdapterError("IDENTITY_MISMATCH");
  for (const profile of ["a", "b"] as const) {
    const compact = `0000000000004000800000000000000${profile}`;
    const migrationUrl = `postgresql://qcrm_m_${compact}:test-only-ghl-migrator-${profile}@${name}:5432/qcrm_t_${compact}?sslmode=disable`;
    const secretFile = join(testRoot, `migrator-${profile}`);
    await fixedSyntheticFile(secretFile, migrationUrl);
    const migration = await docker.run(["run", "--rm", "--pull", "never", "--network", network,
      "--name", `qcrm-ghl-test-migrate-${suffix}-${profile}`, "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
      "--env", "QCRM_ENV=test", "--env", "QCRM_MIGRATION_DATABASE_URL_FILE=/run/secrets/qcrm_migration_database_url",
      "--mount", `type=bind,source=${secretFile},target=/run/secrets/qcrm_migration_database_url,readonly`, migratorImage], {}, 120_000);
    if (migration.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
    await mkdir("/run/secrets", { recursive: true, mode: 0o700 });
    await fixedSyntheticFile(`/run/secrets/ghl_import_test_${profile}_database_url`,
      `postgresql://qcrm_r_${compact}:test-only-ghl-runtime-${profile}@127.0.0.1:${published.HostPort}/qcrm_t_${compact}?sslmode=disable`);
  }
  return { state: "READY", container: name, network, profiles: 2, migratedImageId: migratorImage };
}
