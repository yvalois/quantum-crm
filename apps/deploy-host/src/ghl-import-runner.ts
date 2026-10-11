import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { createCommandRunner, planForTenant, type TenantComposeRunnerOptions } from "./compose-runner.js";
import {
  HostAdapterError,
  type HostAdapterGhlImportRequest,
  type HostAdapterGhlImportResult,
  type TenantGhlImportRunner,
} from "./host-adapter.js";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const jobKeys = new Set([
  "schemaVersion", "operationId", "tenantProfileId", "serverId", "releaseId",
  "configurationRevision", "exportId", "workerImageId", "artifactSha256", "locationId",
  "currency", "developmentBackupException", "migratorImageId", "candidateCommit",
]);

interface ApprovedGhlImport {
  readonly workerImageId: string;
  readonly migratorImageId?: string;
  readonly artifactSha256: string;
  readonly locationId: string;
  readonly currency: string;
}

export interface TenantGhlImportRunnerOptions extends TenantComposeRunnerOptions {
  /** Host-controlled roots only; never accepted from an HTTP request. */
  readonly exportRoot?: string;
  readonly exportKeyFile?: string;
}

export async function protectedFile(root: string, path: string, maximumBytes: number): Promise<void> {
  const rootPath = resolve(root);
  const target = resolve(path);
  if (/[\0\r\n,]/u.test(rootPath) || /[\0\r\n,]/u.test(target)) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const relation = relative(rootPath, target);
  if (!relation || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  // Reject symlinks in every component, including a substituted export directory.
  let current = rootPath;
  if (await realpath(rootPath) !== rootPath) throw new HostAdapterError("IDENTITY_MISMATCH");
  for (const component of relation.split(sep)) {
    current = join(current, component);
    if ((await lstat(current)).isSymbolicLink()) throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const metadata = await lstat(target);
  if (
    !metadata.isFile() || metadata.size < 1 || metadata.size > maximumBytes ||
    (metadata.mode & 0o027) !== 0 || await realpath(target) !== target
  ) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
}

function parseApprovedJob(value: unknown, request: HostAdapterGhlImportRequest): ApprovedGhlImport {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const job = value as Record<string, unknown>;
  if (
    Object.keys(job).some((key) => !jobKeys.has(key)) || job.schemaVersion !== 1 ||
    job.operationId !== request.operationId || job.tenantProfileId !== request.tenantProfileId ||
    job.serverId !== request.serverId || job.releaseId !== request.releaseId ||
    job.configurationRevision !== request.configurationRevision.toString() ||
    job.exportId !== request.exportId || job.developmentBackupException !== true ||
    (job.candidateCommit !== undefined && (typeof job.candidateCommit !== "string" || !/^[0-9a-f]{40}$/u.test(job.candidateCommit))) ||
    typeof job.workerImageId !== "string" || !digestPattern.test(job.workerImageId) ||
    (job.migratorImageId !== undefined && (typeof job.migratorImageId !== "string" || !digestPattern.test(job.migratorImageId))) ||
    (request.mode === "MIGRATE" && typeof job.migratorImageId !== "string") ||
    typeof job.artifactSha256 !== "string" || !sha256Pattern.test(job.artifactSha256) ||
    typeof job.locationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(job.locationId) ||
    typeof job.currency !== "string" || !/^[A-Z]{3}$/u.test(job.currency)
  ) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  return { workerImageId: job.workerImageId, ...(typeof job.migratorImageId === "string" ? { migratorImageId: job.migratorImageId } : {}), artifactSha256: job.artifactSha256,
    locationId: job.locationId, currency: job.currency };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function observedContainer(
  output: string, imageId: string, name: string, labels: Readonly<Record<string, string>>,
): HostAdapterGhlImportResult {
  const value: unknown = JSON.parse(output);
  if (!Array.isArray(value) || value.length !== 1) throw new HostAdapterError("IDENTITY_MISMATCH");
  const container = value[0] as { readonly Name?: unknown; readonly Image?: unknown;
    readonly Config?: { readonly Labels?: Record<string, unknown> };
    readonly State?: { readonly Status?: unknown; readonly Running?: unknown; readonly ExitCode?: unknown } };
  if (
    container.Name !== `/${name}` || container.Image !== imageId ||
    Object.entries(labels).some(([key, value]) => container.Config?.Labels?.[key] !== value)
  ) throw new HostAdapterError("IDENTITY_MISMATCH");
  if (container.State?.Running === true) return { state: "RUNNING", reconciled: true };
  if (container.State?.Status !== "exited" || !Number.isSafeInteger(container.State.ExitCode)) {
    throw new HostAdapterError("UNAVAILABLE");
  }
  const exitCode = container.State.ExitCode as number;
  return { state: exitCode === 0 ? "SUCCEEDED" : "FAILED", exitCode, reconciled: true };
}

/** A registered, immutable development import; no arbitrary commands or host paths. */
export function createTenantGhlImportRunner(options: TenantGhlImportRunnerOptions): TenantGhlImportRunner {
  const runner = options.commandRunner ?? createCommandRunner(options.dockerBinary ?? "/usr/bin/docker");
  const exportRoot = options.exportRoot ?? "/opt/quantum/exports/ghl";
  const exportKeyFile = options.exportKeyFile ?? "/opt/quantum/secrets/ghl-export/export-key";
  const inFlight = new Set<string>();
  return Object.freeze({ run: async (request: HostAdapterGhlImportRequest): Promise<HostAdapterGhlImportResult> => {
    if (options.environment !== "staging" || !uuidPattern.test(request.exportId) ||
      !uuidPattern.test(request.operationId) || !uuidPattern.test(request.tenantProfileId)) {
      throw new HostAdapterError("IDENTITY_MISMATCH");
    }
    if (inFlight.has(request.tenantProfileId)) throw new HostAdapterError("TARGET_CONFLICT");
    inFlight.add(request.tenantProfileId);
    try {
      const plan = await planForTenant(options, { ...request, action: "RECONCILE_TENANT_COMPOSE" });
      const jobFile = join(options.configurationRoot, "tenant", request.tenantProfileId, "ghl-imports", `${request.exportId}.json`);
      await protectedFile(options.configurationRoot, jobFile, 16_384);
      const registered = await readFile(jobFile, "utf8");
      const approved = parseApprovedJob(JSON.parse(registered) as unknown, request);
      const imageId = request.mode === "MIGRATE" ? approved.migratorImageId : approved.workerImageId;
      if (!imageId) throw new HostAdapterError("IDENTITY_MISMATCH");
      const registryHash = createHash("sha256").update(registered).digest("hex");
      const artifactFile = join(exportRoot, request.exportId, "records.qcrm");
      const databaseFile = request.mode === "MIGRATE"
        ? plan.environment.QCRM_CRM_MIGRATION_DATABASE_URL_SECRET_FILE
        : plan.environment.QCRM_CRM_DATABASE_URL_SECRET_FILE;
      if (!databaseFile) throw new HostAdapterError("IDENTITY_MISMATCH");
      await protectedFile(exportRoot, artifactFile, 256 * 1024 * 1024);
      await protectedFile(resolve(exportKeyFile, ".."), exportKeyFile, 16_384);
      await protectedFile(options.databaseSecretRoot, databaseFile, 16_384);
      if (await sha256File(artifactFile) !== approved.artifactSha256) throw new HostAdapterError("IDENTITY_MISMATCH");
      const name = `qcrm-ghl-${request.operationId}-${request.mode.toLowerCase()}-${request.attempt}`;
      const labels = { "com.quantum.operation-id": request.operationId,
        "com.quantum.tenant-id": request.tenantProfileId, "com.quantum.ghl-export-id": request.exportId,
        "com.quantum.ghl-job-sha256": registryHash, "com.quantum.ghl-import-mode": request.mode };
      const inspect = await runner.run(["container", "inspect", name], {}, 15_000);
      if (inspect.exitCode === 0) return observedContainer(inspect.stdout, imageId, name, labels);
      if (inspect.exitCode !== 1 || !inspect.stderr.includes("No such")) throw new HostAdapterError("UNAVAILABLE");
      // Only an internal network is allowed; the job cannot contact GHL or a channel provider.
      const network = await runner.run(["network", "inspect", options.platformDatabaseNetwork], {}, 15_000);
      const networkValue: unknown = network.exitCode === 0 ? JSON.parse(network.stdout) : null;
      if (!Array.isArray(networkValue) || networkValue.length !== 1 ||
        (networkValue[0] as { Internal?: unknown }).Internal !== true) throw new HostAdapterError("IDENTITY_MISMATCH");
      const running = await runner.run(["ps", "-q", "--filter", `label=com.quantum.tenant-id=${request.tenantProfileId}`,
        "--filter", "label=com.quantum.ghl-export-id"], {}, 15_000);
      if (running.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
      if (running.stdout.trim()) throw new HostAdapterError("TARGET_CONFLICT");
      const environment: Readonly<Record<string, string>> = request.mode === "MIGRATE"
        ? { QCRM_ENV: "staging", QCRM_MIGRATION_DATABASE_URL_FILE: "/run/secrets/qcrm_migration_database_url" }
        : { QCRM_ENV: "staging", QCRM_TENANT_ID: request.tenantProfileId,
        QCRM_GHL_IMPORT_OPERATION_ID: request.operationId, QCRM_GHL_IMPORT_EXPORT_ID: request.exportId,
        QCRM_GHL_IMPORT_ARTIFACT_SHA256: approved.artifactSha256,
        QCRM_GHL_IMPORT_ARTIFACT_FILE: "/run/ghl-import/records.qcrm",
        QCRM_GHL_EXPORT_KEY_FILE: "/run/secrets/qcrm_ghl_export_key",
        QCRM_DATABASE_URL_FILE: "/run/secrets/qcrm_database_url",
        QCRM_GHL_LOCATION_ID: approved.locationId, QCRM_GHL_IMPORT_CURRENCY: approved.currency,
        QCRM_GHL_IMPORT_MODE: request.mode, QCRM_GHL_IMPORT_DEVELOPMENT_EXCEPTION: "true" };
      const args = ["run", "--detach", "--pull", "never", "--name", name,
        "--network", options.platformDatabaseNetwork, "--read-only", "--init", "--user", "1000:1000",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "128",
        "--cpus", "1", "--memory", "2g", "--log-driver", "none",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
        ...Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]),
        ...(request.mode === "MIGRATE"
          ? ["--mount", `type=bind,source=${databaseFile},target=/run/secrets/qcrm_migration_database_url,readonly`]
          : ["--mount", `type=bind,source=${artifactFile},target=/run/ghl-import/records.qcrm,readonly`,
            "--mount", `type=bind,source=${exportKeyFile},target=/run/secrets/qcrm_ghl_export_key,readonly`,
            "--mount", `type=bind,source=${databaseFile},target=/run/secrets/qcrm_database_url,readonly`]),
        ...Object.entries(environment).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
        ...(request.mode === "MIGRATE" ? [imageId] : ["--entrypoint", "node", imageId, "dist/ghl-migration-import-cli.js"])];
      const launched = await runner.run(args, {}, 30_000);
      // Observe even a failed/uncertain launch before allowing any further attempt.
      const after = await runner.run(["container", "inspect", name], {}, 15_000);
      if (after.exitCode === 0) return { ...observedContainer(after.stdout, imageId, name, labels), reconciled: launched.exitCode !== 0 };
      throw new HostAdapterError("UNAVAILABLE");
    } catch (error) {
      if (error instanceof HostAdapterError) throw error;
      const code = (error as { readonly code?: string }).code;
      if (code === "EACCES" || code === "EPERM") throw new HostAdapterError("PERMISSION_DENIED");
      if (error instanceof SyntaxError) throw new HostAdapterError("IDENTITY_MISMATCH");
      throw new HostAdapterError("UNAVAILABLE");
    } finally { inFlight.delete(request.tenantProfileId); }
  } });
}
