import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  createCommandRunner,
  planForTenant,
  type ComposeCommandRunner,
  type TenantComposeRunnerOptions,
} from "./compose-runner.js";
import {
  HostAdapterError,
  type HostAdapterGhlImportRequest,
  type HostAdapterGhlImportResult,
  type HostAdapterGhlImportReceipt,
  type TenantGhlImportRunner,
} from "./host-adapter.js";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const jobKeys = new Set([
  "schemaVersion",
  "operationId",
  "tenantProfileId",
  "serverId",
  "releaseId",
  "configurationRevision",
  "exportId",
  "workerImageId",
  "artifactSha256",
  "locationId",
  "currency",
  "developmentBackupException",
  "migratorImageId",
  "candidateCommit",
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
  /** Bootstrap-only extension; never accepted from the platform HTTP request. */
  readonly participantsCandidate?: {
    readonly commit: string;
    readonly workerImageId: string;
    readonly migratorImageId: string;
    readonly tokenFile: string;
  };
}

export async function protectedFile(
  root: string,
  path: string,
  maximumBytes: number,
): Promise<void> {
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
  if ((await realpath(rootPath)) !== rootPath) throw new HostAdapterError("IDENTITY_MISMATCH");
  for (const component of relation.split(sep)) {
    current = join(current, component);
    if ((await lstat(current)).isSymbolicLink()) throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const metadata = await lstat(target);
  if (
    !metadata.isFile() ||
    metadata.size < 1 ||
    metadata.size > maximumBytes ||
    (metadata.mode & 0o027) !== 0 ||
    (await realpath(target)) !== target
  ) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
}

export function parseApprovedJob(
  value: unknown,
  request: HostAdapterGhlImportRequest,
): ApprovedGhlImport {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const job = value as Record<string, unknown>;
  if (
    Object.keys(job).some((key) => !jobKeys.has(key)) ||
    job.schemaVersion !== 1 ||
    job.operationId !== request.operationId ||
    job.tenantProfileId !== request.tenantProfileId ||
    job.serverId !== request.serverId ||
    job.releaseId !== request.releaseId ||
    job.configurationRevision !== request.configurationRevision.toString() ||
    job.exportId !== request.exportId ||
    job.developmentBackupException !== true ||
    (job.candidateCommit !== undefined &&
      (typeof job.candidateCommit !== "string" || !/^[0-9a-f]{40}$/u.test(job.candidateCommit))) ||
    typeof job.workerImageId !== "string" ||
    !digestPattern.test(job.workerImageId) ||
    (job.migratorImageId !== undefined &&
      (typeof job.migratorImageId !== "string" || !digestPattern.test(job.migratorImageId))) ||
    (request.mode === "MIGRATE" && typeof job.migratorImageId !== "string") ||
    typeof job.artifactSha256 !== "string" ||
    !sha256Pattern.test(job.artifactSha256) ||
    typeof job.locationId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(job.locationId) ||
    typeof job.currency !== "string" ||
    !/^[A-Z]{3}$/u.test(job.currency)
  ) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  return {
    workerImageId: job.workerImageId,
    ...(typeof job.migratorImageId === "string" ? { migratorImageId: job.migratorImageId } : {}),
    artifactSha256: job.artifactSha256,
    locationId: job.locationId,
    currency: job.currency,
  };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const receiptResources = new Set([
  "CUSTOM_FIELDS",
  "TAGS",
  "CONTACTS",
  "PIPELINES",
  "OPPORTUNITIES",
  "CONVERSATIONS",
  "MESSAGES",
]);
const receiptCounters = {
  contacts: ["mappedContacts", "existingContacts", "mappedLabels", "existingLabels"],
  settings: ["mappedFields", "existingFields"],
  sales: [
    "mappedPipelines",
    "existingPipelines",
    "mappedStages",
    "existingStages",
    "mappedOpportunities",
    "existingOpportunities",
    "validOpportunityStages",
  ],
  conversations: [
    "threadCount",
    "messageCount",
    "mappedThreadCount",
    "mappedMessageCount",
    "unresolvedThreadCount",
    "unresolvedContactThreadCount",
    "inconsistentMessageCount",
    "invalidParentCount",
    "outboxCount",
  ],
} as const;
const attachmentCounters = [
  "total",
  "processed",
  "available",
  "rejected",
  "failed",
  "pending",
  "bytes",
] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Project only fixed event codes and numeric aggregates; never forward raw worker output. */
export function parseGhlImportReceipt(output: string): HostAdapterGhlImportReceipt | undefined {
  const progress = new Map<string, HostAdapterGhlImportReceipt["progress"][number]>();
  let status: HostAdapterGhlImportReceipt["status"];
  let consistent: boolean | undefined;
  let artifactRecords: number | undefined;
  let errorCode: "IMPORT_FAILED" | undefined;
  const counters: Record<string, number> = {};
  let recognized = false;
  const addProgress = (value: unknown): void => {
    const item = record(value);
    if (
      !item ||
      typeof item.resource !== "string" ||
      !receiptResources.has(item.resource) ||
      !count(item.processed) ||
      !count(item.created) ||
      !count(item.replayed) ||
      !count(item.conflicts) ||
      !count(item.total)
    )
      return;
    progress.set(item.resource, {
      resource: item.resource,
      processed: item.processed,
      created: item.created,
      replayed: item.replayed,
      conflicts: item.conflicts,
      total: item.total,
    });
  };
  for (const line of output.split(/\r?\n/u).slice(-128)) {
    if (Buffer.byteLength(line) > 32_768) continue;
    let event: Record<string, unknown> | undefined;
    try {
      event = record(JSON.parse(line) as unknown);
    } catch {
      continue;
    }
    if (
      !event ||
      ![
        "ghl_import_progress",
        "ghl_import_complete",
        "ghl_import_verification",
        "ghl_import_failed",
        "ghl_attachment_import_progress",
        "ghl_attachment_import_completed",
        "ghl_participants_complete",
      ].includes(String(event.event))
    )
      continue;
    recognized = true;
    if (event.event === "ghl_participants_complete") {
      for (const key of [
        "total",
        "created",
        "replayed",
        "sourceReferences",
        "resolvedReferences",
      ]) {
        if (count(event[key])) counters[`participants.${key}`] = event[key];
      }
      status = event.status === "COMPLETE" ? "COMPLETE" : "CONFLICTS";
      consistent =
        event.status === "COMPLETE" &&
        count(event.sourceReferences) &&
        event.sourceReferences === event.resolvedReferences;
      continue;
    }
    if (
      event.event === "ghl_attachment_import_progress" ||
      event.event === "ghl_attachment_import_completed"
    ) {
      for (const key of attachmentCounters) {
        if (count(event[key])) counters[`attachments.${key}`] = event[key];
      }
      continue;
    }
    if (event.event === "ghl_import_progress") addProgress(event);
    if (event.event === "ghl_import_failed" && event.code === "IMPORT_FAILED")
      errorCode = "IMPORT_FAILED";
    const operation = event.event === "ghl_import_verification" ? record(event.operation) : event;
    if (operation) {
      if (["RUNNING", "COMPLETE", "CONFLICTS", "FAILED"].includes(String(operation.status))) {
        status = operation.status as HostAdapterGhlImportReceipt["status"];
      }
      if (Array.isArray(operation.progress))
        for (const item of operation.progress.slice(0, 7)) addProgress(item);
    }
    if (event.event === "ghl_import_verification") {
      if (typeof event.consistent === "boolean") consistent = event.consistent;
      if (count(event.artifactRecords)) artifactRecords = event.artifactRecords;
      for (const [group, fields] of Object.entries(receiptCounters)) {
        const source = record(event[group]);
        if (!source) continue;
        for (const key of fields) {
          const value = source[key];
          if (count(value)) counters[`${group}.${key}`] = value;
        }
      }
    }
  }
  if (!recognized) return undefined;
  return {
    progress: [...progress.values()],
    ...(status ? { status } : {}),
    ...(consistent !== undefined ? { consistent } : {}),
    ...(artifactRecords !== undefined ? { artifactRecords } : {}),
    ...(Object.keys(counters).length ? { counters } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
}

/** A dedicated egress bridge belongs to one registered attempt, never another tenant's edge. */
async function attachmentEgressNetwork(
  runner: ComposeCommandRunner,
  name: string,
  labels: Readonly<Record<string, string>>,
): Promise<string> {
  const networkName = `${name}-egress`;
  let inspected = await runner.run(["network", "inspect", networkName], {}, 15_000);
  if (inspected.exitCode !== 0) {
    if (inspected.exitCode !== 1 || !/No such|not found/u.test(inspected.stderr))
      throw new HostAdapterError("UNAVAILABLE");
    await runner.run(
      [
        "network",
        "create",
        "--driver",
        "bridge",
        "--opt",
        "com.docker.network.bridge.enable_icc=false",
        ...Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]),
        networkName,
      ],
      {},
      15_000,
    );
    inspected = await runner.run(["network", "inspect", networkName], {}, 15_000);
  }
  const networks: unknown = inspected.exitCode === 0 ? JSON.parse(inspected.stdout) : null;
  const network =
    Array.isArray(networks) && networks.length === 1 ? record(networks[0]) : undefined;
  const observedLabels = record(network?.Labels);
  const networkOptions = record(network?.Options);
  const members = record(network?.Containers);
  if (
    !network ||
    network.Name !== networkName ||
    network.Driver !== "bridge" ||
    network.Internal !== false ||
    network.Attachable !== false ||
    network.Scope !== "local" ||
    networkOptions?.["com.docker.network.bridge.enable_icc"] !== "false" ||
    !observedLabels ||
    Object.entries(labels).some(([key, value]) => observedLabels[key] !== value) ||
    !members ||
    Object.values(members).some((member) => record(member)?.Name !== name)
  )
    throw new HostAdapterError("IDENTITY_MISMATCH");
  return networkName;
}

function observedContainer(
  output: string,
  imageId: string,
  name: string,
  labels: Readonly<Record<string, string>>,
): HostAdapterGhlImportResult {
  const value: unknown = JSON.parse(output);
  if (!Array.isArray(value) || value.length !== 1) throw new HostAdapterError("IDENTITY_MISMATCH");
  const container = value[0] as {
    readonly Name?: unknown;
    readonly Image?: unknown;
    readonly Config?: { readonly Labels?: Record<string, unknown> };
    readonly State?: {
      readonly Status?: unknown;
      readonly Running?: unknown;
      readonly ExitCode?: unknown;
    };
  };
  if (
    container.Name !== `/${name}` ||
    container.Image !== imageId ||
    Object.entries(labels).some(([key, value]) => container.Config?.Labels?.[key] !== value)
  )
    throw new HostAdapterError("IDENTITY_MISMATCH");
  if (container.State?.Running === true) return { state: "RUNNING", reconciled: true };
  if (container.State?.Status !== "exited" || !Number.isSafeInteger(container.State.ExitCode)) {
    throw new HostAdapterError("UNAVAILABLE");
  }
  const exitCode = container.State.ExitCode as number;
  return { state: exitCode === 0 ? "SUCCEEDED" : "FAILED", exitCode, reconciled: true };
}

/** A registered, immutable development import; no arbitrary commands or host paths. */
export function createTenantGhlImportRunner(
  options: TenantGhlImportRunnerOptions,
): TenantGhlImportRunner {
  const runner =
    options.commandRunner ?? createCommandRunner(options.dockerBinary ?? "/usr/bin/docker");
  const exportRoot = options.exportRoot ?? "/opt/quantum/exports/ghl";
  const exportKeyFile = options.exportKeyFile ?? "/opt/quantum/secrets/ghl-export/export-key";
  const inFlight = new Set<string>();
  return Object.freeze({
    run: async (request: HostAdapterGhlImportRequest): Promise<HostAdapterGhlImportResult> => {
      if (
        options.environment !== "staging" ||
        !uuidPattern.test(request.exportId) ||
        !uuidPattern.test(request.operationId) ||
        !uuidPattern.test(request.tenantProfileId) ||
        !["APPLY", "VERIFY", "MIGRATE", "ATTACHMENTS"].includes(request.mode) ||
        !Number.isSafeInteger(request.attempt) ||
        request.attempt < 1
      ) {
        throw new HostAdapterError("IDENTITY_MISMATCH");
      }
      if (inFlight.has(request.tenantProfileId)) throw new HostAdapterError("TARGET_CONFLICT");
      inFlight.add(request.tenantProfileId);
      try {
        const plan = await planForTenant(options, {
          ...request,
          action: "RECONCILE_TENANT_COMPOSE",
        });
        const jobFile = join(
          options.configurationRoot,
          "tenant",
          request.tenantProfileId,
          "ghl-imports",
          `${request.exportId}.json`,
        );
        await protectedFile(options.configurationRoot, jobFile, 16_384);
        const registered = await readFile(jobFile, "utf8");
        const approved = parseApprovedJob(JSON.parse(registered) as unknown, request);
        const candidate = options.participantsCandidate;
        if (
          candidate &&
          (!/^[0-9a-f]{40}$/u.test(candidate.commit) ||
            !digestPattern.test(candidate.workerImageId) ||
            !digestPattern.test(candidate.migratorImageId) ||
            !["VERIFY", "MIGRATE"].includes(request.mode))
        )
          throw new HostAdapterError("IDENTITY_MISMATCH");
        const participants = Boolean(candidate) && request.mode === "VERIFY";
        const attachments = request.mode === "ATTACHMENTS";
        const imageId =
          request.mode === "MIGRATE"
            ? (candidate?.migratorImageId ?? approved.migratorImageId)
            : (candidate?.workerImageId ?? approved.workerImageId);
        if (!imageId) throw new HostAdapterError("IDENTITY_MISMATCH");
        const registryHash = createHash("sha256").update(registered).digest("hex");
        const artifactFile = join(exportRoot, request.exportId, "records.qcrm");
        const databaseFile =
          request.mode === "MIGRATE"
            ? plan.environment.QCRM_CRM_MIGRATION_DATABASE_URL_SECRET_FILE
            : plan.environment.QCRM_CRM_DATABASE_URL_SECRET_FILE;
        if (!databaseFile) throw new HostAdapterError("IDENTITY_MISMATCH");
        await protectedFile(exportRoot, artifactFile, 256 * 1024 * 1024);
        await protectedFile(resolve(exportKeyFile, ".."), exportKeyFile, 16_384);
        await protectedFile(options.databaseSecretRoot, databaseFile, 16_384);
        const filesEnvironment: Record<string, string> = {};
        const filesMounts: string[] = [];
        if (participants && candidate) {
          await protectedFile(resolve(candidate.tokenFile, ".."), candidate.tokenFile, 16_384);
          filesEnvironment.QCRM_GHL_MIGRATION_TOKEN_FILE = "/run/secrets/qcrm_ghl_migration_token";
          filesMounts.push(
            "--mount",
            `type=bind,source=${candidate.tokenFile},target=/run/secrets/qcrm_ghl_migration_token,readonly`,
          );
        }
        if (attachments) {
          for (const role of ["UPLOAD", "DELIVERY", "PROCESSOR"] as const) {
            for (const kind of ["ACCESS", "SECRET"] as const) {
              const key = `QCRM_FILES_S3_${role}_${kind}_KEY`;
              const path = plan.environment[`${key}_SECRET_FILE`];
              if (!path) throw new HostAdapterError("IDENTITY_MISMATCH");
              await protectedFile(options.databaseSecretRoot, path, 256);
              const target = `/run/secrets/qcrm_files_s3_${role.toLowerCase()}_${kind.toLowerCase()}_key`;
              filesEnvironment[`${key}_FILE`] = target;
              filesMounts.push("--mount", `type=bind,source=${path},target=${target},readonly`);
            }
          }
          for (const key of [
            "QCRM_FILES_INCOMING_BUCKET",
            "QCRM_FILES_OBJECTS_BUCKET",
            "QCRM_FILES_S3_PUBLIC_ENDPOINT",
          ] as const) {
            const value = plan.environment[key];
            if (!value) throw new HostAdapterError("IDENTITY_MISMATCH");
            filesEnvironment[key] = value;
          }
          Object.assign(filesEnvironment, {
            QCRM_FILES_S3_ENDPOINT: "http://platform-storage:8333",
            QCRM_FILES_S3_REGION: "us-east-1",
            QCRM_FILES_CLAMAV_HOST: "platform-clamav",
            QCRM_FILES_CLAMAV_PORT: "3310",
            QCRM_FILES_CLAMAV_TIMEOUT_MS: "30000",
            QCRM_FILES_CLAMAV_MAX_SIGNATURE_AGE_SECONDS: "172800",
            QCRM_FILES_WORKER_POLL_INTERVAL_MS: "250",
            QCRM_FILES_WORKER_LEASE_SECONDS: "300",
          });
        }
        if ((await sha256File(artifactFile)) !== approved.artifactSha256)
          throw new HostAdapterError("IDENTITY_MISMATCH");
        const name = `qcrm-ghl-${request.operationId}-${candidate ? `participants-${candidate.commit}-` : ""}${request.mode.toLowerCase()}-${request.attempt}`;
        const labels = {
          "com.quantum.operation-id": request.operationId,
          "com.quantum.tenant-id": request.tenantProfileId,
          "com.quantum.ghl-export-id": request.exportId,
          "com.quantum.ghl-job-sha256": registryHash,
          "com.quantum.ghl-import-mode": request.mode,
          ...(candidate ? { "com.quantum.ghl-participants-commit": candidate.commit } : {}),
        };
        const observe = async (output: string): Promise<HostAdapterGhlImportResult> => {
          const state = observedContainer(output, imageId, name, labels);
          if (request.mode === "MIGRATE") return state;
          const logs = await runner.run(["logs", "--tail", "128", name], {}, 15_000);
          const receipt =
            logs.exitCode === 0
              ? parseGhlImportReceipt(`${logs.stdout}\n${logs.stderr}`)
              : undefined;
          return receipt ? { ...state, receipt } : state;
        };
        const inspect = await runner.run(["container", "inspect", name], {}, 15_000);
        if (inspect.exitCode === 0) return await observe(inspect.stdout);
        if (inspect.exitCode !== 1 || !inspect.stderr.includes("No such"))
          throw new HostAdapterError("UNAVAILABLE");
        const networks = [
          options.platformDatabaseNetwork,
          ...(attachments ? [options.platformStorageNetwork] : []),
        ];
        for (const networkName of networks) {
          const network = await runner.run(["network", "inspect", networkName], {}, 15_000);
          const networkValue: unknown = network.exitCode === 0 ? JSON.parse(network.stdout) : null;
          if (
            !Array.isArray(networkValue) ||
            networkValue.length !== 1 ||
            (networkValue[0] as { Internal?: unknown }).Internal !== true
          )
            throw new HostAdapterError("IDENTITY_MISMATCH");
        }
        const running = await runner.run(
          [
            "ps",
            "-q",
            "--filter",
            `label=com.quantum.tenant-id=${request.tenantProfileId}`,
            "--filter",
            "label=com.quantum.ghl-export-id",
          ],
          {},
          15_000,
        );
        if (running.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
        if (running.stdout.trim()) throw new HostAdapterError("TARGET_CONFLICT");
        if (attachments || participants)
          networks.push(await attachmentEgressNetwork(runner, name, labels));
        const environment: Readonly<Record<string, string>> =
          request.mode === "MIGRATE"
            ? {
                QCRM_ENV: "staging",
                QCRM_MIGRATION_DATABASE_URL_FILE: "/run/secrets/qcrm_migration_database_url",
              }
            : {
                QCRM_ENV: "staging",
                QCRM_TENANT_ID: request.tenantProfileId,
                QCRM_GHL_IMPORT_OPERATION_ID: request.operationId,
                QCRM_GHL_IMPORT_EXPORT_ID: request.exportId,
                QCRM_GHL_IMPORT_ARTIFACT_SHA256: approved.artifactSha256,
                QCRM_GHL_IMPORT_ARTIFACT_FILE: "/run/ghl-import/records.qcrm",
                QCRM_GHL_EXPORT_KEY_FILE: "/run/secrets/qcrm_ghl_export_key",
                QCRM_DATABASE_URL_FILE: "/run/secrets/qcrm_database_url",
                QCRM_GHL_LOCATION_ID: approved.locationId,
                QCRM_GHL_IMPORT_CURRENCY: approved.currency,
                QCRM_GHL_IMPORT_MODE: participants
                  ? "PARTICIPANTS"
                  : attachments
                    ? "APPLY"
                    : request.mode,
                QCRM_GHL_IMPORT_DEVELOPMENT_EXCEPTION: "true",
                ...filesEnvironment,
              };
        const args = [
          "run",
          "--detach",
          "--pull",
          "never",
          "--name",
          name,
          ...networks.flatMap((network) => ["--network", network]),
          "--read-only",
          "--init",
          "--user",
          "1000:1000",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--pids-limit",
          "128",
          "--cpus",
          "1",
          "--memory",
          attachments ? "3g" : "2g",
          "--log-driver",
          request.mode === "MIGRATE" ? "none" : "json-file",
          ...(request.mode === "MIGRATE"
            ? []
            : ["--log-opt", "max-size=1m", "--log-opt", "max-file=1"]),
          "--tmpfs",
          "/tmp:rw,noexec,nosuid,size=64m",
          ...Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]),
          ...(request.mode === "MIGRATE"
            ? [
                "--mount",
                `type=bind,source=${databaseFile},target=/run/secrets/qcrm_migration_database_url,readonly`,
              ]
            : [
                "--mount",
                `type=bind,source=${artifactFile},target=/run/ghl-import/records.qcrm,readonly`,
                "--mount",
                `type=bind,source=${exportKeyFile},target=/run/secrets/qcrm_ghl_export_key,readonly`,
                "--mount",
                `type=bind,source=${databaseFile},target=/run/secrets/qcrm_database_url,readonly`,
              ]),
          ...filesMounts,
          ...Object.entries(environment).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
          ...(request.mode === "MIGRATE"
            ? [imageId]
            : [
                "--entrypoint",
                "node",
                imageId,
                attachments
                  ? "dist/ghl-migration-attachments-cli.js"
                  : "dist/ghl-migration-import-cli.js",
              ]),
        ];
        const launched = await runner.run(args, {}, 30_000);
        // Observe even a failed/uncertain launch before allowing any further attempt.
        const after = await runner.run(["container", "inspect", name], {}, 15_000);
        if (after.exitCode === 0)
          return {
            ...(await observe(after.stdout)),
            reconciled: launched.exitCode !== 0,
          };
        throw new HostAdapterError("UNAVAILABLE");
      } catch (error) {
        if (error instanceof HostAdapterError) throw error;
        const code = (error as { readonly code?: string }).code;
        if (code === "EACCES" || code === "EPERM") throw new HostAdapterError("PERMISSION_DENIED");
        if (error instanceof SyntaxError) throw new HostAdapterError("IDENTITY_MISMATCH");
        throw new HostAdapterError("UNAVAILABLE");
      } finally {
        inFlight.delete(request.tenantProfileId);
      }
    },
  });
}
