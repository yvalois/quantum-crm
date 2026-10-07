import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  tenantContainerServiceNames,
  type TenantContainerServiceName,
} from "@quantum-crm/platform-domain";

import {
  ComposePolicyValidationError,
  createTenantComposePlan,
  parseTenantConfigurationManifest,
  tenantEdgeNetworkName,
  type ComposePolicyRequest,
  type TenantComposePlan,
} from "./compose-policy.js";
import {
  HostAdapterError,
  type HostAdapterMigrationRequest,
  type HostAdapterRequest,
  type HostAdapterDecommissionRequest,
  type TenantCrmMigrationReconciler,
  type TenantRuntimeDecommissioner,
  type TenantComposeReconciler,
} from "./host-adapter.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const defaultTimeoutMilliseconds = 120_000;
const fixedEnvironment = Object.freeze({
  HOME: "/home/node",
  LC_ALL: "C",
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
});

export interface ComposeCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ComposeCommandRunner {
  readonly run: (
    args: readonly string[],
    environment: Readonly<Record<string, string>>,
    timeoutMilliseconds: number,
  ) => Promise<ComposeCommandResult>;
}

export interface TenantComposeRunnerOptions {
  readonly configurationRoot: string;
  readonly composeTemplate: string;
  readonly imageRegistry: string;
  readonly environment: "preview" | "staging" | "production";
  readonly tenantEdgeNetworkPrefix: string;
  readonly platformDatabaseNetwork: string;
  readonly platformStorageNetwork: string;
  readonly platformSessionNetwork: string;
  readonly platformOidcNetwork: string;
  readonly databaseSecretRoot: string;
  readonly storagePublicEndpoint: string;
  readonly dockerBinary?: string;
  readonly commandTimeoutMilliseconds?: number;
  readonly commandRunner?: ComposeCommandRunner;
}

interface ComposePsEntry {
  readonly Service?: unknown;
  readonly State?: unknown;
  readonly Health?: unknown;
}

export function createCommandRunner(binary: string): ComposeCommandRunner {
  if (!isAbsolute(binary) || /[\0\r\n]/u.test(binary)) {
    throw new Error("invalid docker binary");
  }
  return Object.freeze({
    run: (
      args: readonly string[],
      environment: Readonly<Record<string, string>>,
      timeoutMilliseconds: number,
    ) =>
      new Promise<ComposeCommandResult>((resolveResult, reject) => {
        const child = spawn(binary, [...args], {
          env: { ...fixedEnvironment, ...environment },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const finish = (callback: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          callback();
        };
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(() => reject(new Error("docker compose command timed out")));
        }, timeoutMilliseconds);
        if (!child.stdout || !child.stderr) {
          child.kill("SIGKILL");
          finish(() => reject(new Error("docker compose output unavailable")));
          return;
        }
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
          if (Buffer.byteLength(stdout) > 262_144) child.kill("SIGKILL");
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
          if (Buffer.byteLength(stderr) > 262_144) child.kill("SIGKILL");
        });
        child.once("error", (error) => finish(() => reject(error)));
        child.once("close", (exitCode) =>
          finish(() => resolveResult({ exitCode: exitCode ?? 1, stdout, stderr })),
        );
      }),
  });
}

function safeChildPath(rootDirectory: string, relativePath: string): string {
  if (!relativePath || relativePath.includes("\\") || relativePath.startsWith("/")) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const root = resolve(rootDirectory);
  const target = resolve(root, relativePath);
  const relation = relative(root, target);
  if (!relation || relation.startsWith(`..${sep}`) || relation === ".." || isAbsolute(relation)) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  return target;
}

async function readManifest(rootDirectory: string, request: HostAdapterRequest): Promise<unknown> {
  const manifestPath = safeChildPath(rootDirectory, request.manifestRef);
  try {
    const metadata = await lstat(manifestPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new HostAdapterError("IDENTITY_MISMATCH");
    }
    const content = await readFile(manifestPath, "utf8");
    if (Buffer.byteLength(content) > 65_536) throw new HostAdapterError("IDENTITY_MISMATCH");
    try {
      return JSON.parse(content) as unknown;
    } catch {
      throw new HostAdapterError("IDENTITY_MISMATCH");
    }
  } catch (error) {
    if (error instanceof HostAdapterError) throw error;
    const code = (error as { readonly code?: string }).code;
    if (code === "ENOENT" || code === "EACCES" || code === "EPERM") {
      throw new HostAdapterError(
        code === "EACCES" || code === "EPERM" ? "PERMISSION_DENIED" : "UNAVAILABLE",
      );
    }
    throw new HostAdapterError("UNAVAILABLE");
  }
}

async function assertSecretFile(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size < 1 ||
      metadata.size > 16_384
    ) {
      throw new HostAdapterError("IDENTITY_MISMATCH");
    }
  } catch (error) {
    if (error instanceof HostAdapterError) throw error;
    const code = (error as { readonly code?: string }).code;
    if (code === "EACCES" || code === "EPERM") throw new HostAdapterError("PERMISSION_DENIED");
    if (code === "ENOENT") throw new HostAdapterError("UNAVAILABLE");
    throw new HostAdapterError("UNAVAILABLE");
  }
}

function parseComposePs(stdout: string): ReadonlySet<TenantContainerServiceName> {
  const text = stdout.trim();
  if (!text) return new Set();
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    const entries: ComposePsEntry[] = [];
    for (const line of text.split(/\r?\n/u).filter((line) => line.trim().length > 0)) {
      try {
        entries.push(JSON.parse(line) as ComposePsEntry);
      } catch {
        throw new HostAdapterError("UNAVAILABLE");
      }
    }
    value = entries;
  }
  const entries = Array.isArray(value) ? value : [value];
  const ready = new Set<TenantContainerServiceName>();
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new HostAdapterError("UNAVAILABLE");
    }
    const candidate = entry as ComposePsEntry;
    if (
      typeof candidate.Service !== "string" ||
      !tenantContainerServiceNames.includes(candidate.Service as TenantContainerServiceName) ||
      candidate.State !== "running" ||
      candidate.Health !== "healthy"
    ) {
      continue;
    }
    ready.add(candidate.Service as TenantContainerServiceName);
  }
  return ready;
}

function requestFor(request: HostAdapterRequest): ComposePolicyRequest {
  return {
    tenantProfileId: request.tenantProfileId,
    serverId: request.serverId,
    releaseId: request.releaseId,
    projectName: request.projectName,
  };
}

function composeArgs(plan: TenantComposePlan, command: "config" | "up" | "ps"): string[] {
  const prefix = ["compose", "-f", plan.templatePath, "--project-name", plan.projectName];
  if (command === "config") return [...prefix, "config", "--quiet"];
  if (command === "up") return [...prefix, "up", "-d", "--remove-orphans"];
  return [...prefix, "ps", "--format", "json"];
}

function composeDownArgs(plan: TenantComposePlan): string[] {
  return [
    "compose",
    "-f",
    plan.templatePath,
    "--project-name",
    plan.projectName,
    "down",
    "--remove-orphans",
  ];
}

function migrationComposeArgs(plan: TenantComposePlan): string[] {
  return [
    "compose",
    "-f",
    plan.templatePath,
    "--project-name",
    plan.projectName,
    "run",
    "--rm",
    "--no-deps",
    "crm-migrator",
  ];
}

async function planForTenant(
  options: TenantComposeRunnerOptions,
  request: HostAdapterRequest,
): Promise<TenantComposePlan> {
  try {
    const manifest = parseTenantConfigurationManifest(
      await readManifest(options.configurationRoot, request),
      requestFor(request),
    );
    return createTenantComposePlan(requestFor(request), manifest, {
      templatePath: options.composeTemplate,
      imageRegistry: options.imageRegistry,
      environment: options.environment,
      tenantEdgeNetwork: tenantEdgeNetworkName(
        options.tenantEdgeNetworkPrefix,
        request.tenantProfileId,
      ),
      platformDatabaseNetwork: options.platformDatabaseNetwork,
      platformStorageNetwork: options.platformStorageNetwork,
      platformSessionNetwork: options.platformSessionNetwork,
      platformOidcNetwork: options.platformOidcNetwork,
      storagePublicEndpoint: options.storagePublicEndpoint,
      storageSecretRoot: options.databaseSecretRoot,
      crmDatabaseSecretFile: safeChildPath(
        options.databaseSecretRoot,
        `${request.tenantProfileId}/runtime-url`,
      ),
      crmMigrationDatabaseSecretFile: safeChildPath(
        options.databaseSecretRoot,
        `${request.tenantProfileId}/migrator-url`,
      ),
      crmOidcClientSecretFile: safeChildPath(
        options.databaseSecretRoot,
        `${request.tenantProfileId}/oidc-client-secret`,
      ),
      iamBootstrapClientSecretFile: safeChildPath(
        options.databaseSecretRoot,
        `${request.tenantProfileId}/iam-bootstrap-client-secret`,
      ),
      crmSessionRedisUrlSecretFile: safeChildPath(
        options.databaseSecretRoot,
        `${request.tenantProfileId}/session-redis-url`,
      ),
    });
  } catch (error) {
    if (error instanceof HostAdapterError) throw error;
    if (error instanceof ComposePolicyValidationError)
      throw new HostAdapterError("IDENTITY_MISMATCH");
    throw new HostAdapterError("UNAVAILABLE");
  }
}

async function ensureTenantEdgeNetwork(
  runner: ComposeCommandRunner,
  environment: Readonly<Record<string, string>>,
  timeout: number,
  networkName: string,
): Promise<void> {
  const inspected = await runner.run(["network", "inspect", networkName], environment, timeout);
  if (inspected.exitCode === 0) return;
  if (inspected.exitCode !== 1) throw new HostAdapterError("UNAVAILABLE");
  const created = await runner.run(
    ["network", "create", "--driver", "bridge", networkName],
    environment,
    timeout,
  );
  if (created.exitCode === 0) return;
  const observedAfterRace = await runner.run(
    ["network", "inspect", networkName],
    environment,
    timeout,
  );
  if (observedAfterRace.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
}

export function createTenantComposeReconciler(
  options: TenantComposeRunnerOptions,
): TenantComposeReconciler {
  const runner =
    options.commandRunner ?? createCommandRunner(options.dockerBinary ?? "/usr/bin/docker");
  const timeout = options.commandTimeoutMilliseconds ?? defaultTimeoutMilliseconds;
  const inFlight = new Map<
    string,
    Promise<Awaited<ReturnType<TenantComposeReconciler["reconcile"]>>>
  >();

  const reconcile = async (request: HostAdapterRequest) => {
    if (!uuidPattern.test(request.tenantProfileId)) {
      throw new HostAdapterError("IDENTITY_MISMATCH");
    }
    const existing = inFlight.get(request.projectName);
    if (existing) {
      throw new HostAdapterError("TARGET_CONFLICT");
    }
    const operation = (async () => {
      const plan = await planForTenant(options, request);
      await assertSecretFile(plan.environment.QCRM_CRM_DATABASE_URL_SECRET_FILE as string);
      await assertSecretFile(
        plan.environment.QCRM_CRM_MIGRATION_DATABASE_URL_SECRET_FILE as string,
      );
      await assertSecretFile(plan.environment.QCRM_CRM_OIDC_CLIENT_SECRET_FILE as string);
      await assertSecretFile(plan.environment.QCRM_CRM_SESSION_REDIS_URL_SECRET_FILE as string);
      await assertSecretFile(
        plan.environment.QCRM_FILES_S3_UPLOAD_ACCESS_KEY_SECRET_FILE as string,
      );
      await assertSecretFile(
        plan.environment.QCRM_FILES_S3_UPLOAD_SECRET_KEY_SECRET_FILE as string,
      );
      const environment = plan.environment;
      await ensureTenantEdgeNetwork(
        runner,
        environment,
        timeout,
        plan.environment.QCRM_TENANT_EDGE_NETWORK as string,
      );
      for (const command of ["config", "up"] as const) {
        const result = await runner.run(composeArgs(plan, command), environment, timeout);
        if (result.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
      }
      const observed = await runner.run(composeArgs(plan, "ps"), environment, timeout);
      if (observed.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
      const readyServices = parseComposePs(observed.stdout);
      const ready = tenantContainerServiceNames.every((service) => readyServices.has(service));
      return Object.freeze({
        projectName: plan.projectName,
        services: Object.freeze([...tenantContainerServiceNames]),
        ready,
        reconciled: true,
      });
    })();
    inFlight.set(request.projectName, operation);
    try {
      return await operation;
    } finally {
      if (inFlight.get(request.projectName) === operation) inFlight.delete(request.projectName);
    }
  };

  return Object.freeze({ reconcile });
}

/** Runs only the one-shot CRM migrator; it never reconciles or starts tenant services. */
export function createTenantCrmMigrationReconciler(
  options: TenantComposeRunnerOptions,
): TenantCrmMigrationReconciler {
  const runner =
    options.commandRunner ?? createCommandRunner(options.dockerBinary ?? "/usr/bin/docker");
  const timeout = options.commandTimeoutMilliseconds ?? defaultTimeoutMilliseconds;
  return Object.freeze({
    migrate: async (request: HostAdapterMigrationRequest) => {
      const composeRequest: HostAdapterRequest = { ...request, action: "RECONCILE_TENANT_COMPOSE" };
      const plan = await planForTenant(options, composeRequest);
      await assertSecretFile(
        plan.environment.QCRM_CRM_MIGRATION_DATABASE_URL_SECRET_FILE as string,
      );
      const result = await runner.run(migrationComposeArgs(plan), plan.environment, timeout);
      if (result.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
      return Object.freeze({ migrated: true, reconciled: true });
    },
  });
}

/**
 * Stops and removes exactly the compose project derived from a verified tenant
 * deployment identity. The external edge network is intentionally retained here:
 * its removal is performed only after Caddy has withdrawn the tenant route.
 */
export function createTenantComposeDecommissioner(
  options: TenantComposeRunnerOptions,
): Pick<TenantRuntimeDecommissioner, "decommission"> {
  const runner =
    options.commandRunner ?? createCommandRunner(options.dockerBinary ?? "/usr/bin/docker");
  const timeout = options.commandTimeoutMilliseconds ?? defaultTimeoutMilliseconds;

  return Object.freeze({
    decommission: async (request: HostAdapterDecommissionRequest) => {
      const composeRequest: HostAdapterRequest = {
        ...request,
        action: "RECONCILE_TENANT_COMPOSE",
      };
      const plan = await planForTenant(options, composeRequest);
      const result = await runner.run(composeDownArgs(plan), plan.environment, timeout);
      if (result.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
      return Object.freeze({
        projectName: plan.projectName,
        edgeNetworkName: request.edgeNetworkName,
        containersRemoved: true,
        routeRemoved: false,
        networkRemoved: false,
        decommissioned: false,
      });
    },
  });
}
