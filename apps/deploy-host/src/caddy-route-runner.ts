import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  validateTenantHttpsRouteProvisioningCommand,
  type TenantHttpsRouteProvisioningCommand,
} from "@quantum-crm/platform-domain";

import { tenantEdgeServiceAlias } from "./compose-policy.js";
import {
  HostAdapterError,
  type HostAdapterDecommissionRequest,
  type HostAdapterHttpsRequest,
  type HostAdapterHttpsResult,
  type TenantHttpsRouteReconciler,
} from "./host-adapter.js";

const defaultTimeoutMilliseconds = 30_000;
const edgeProjectName = "quantum-edge";
const edgeServiceName = "edge-proxy";
const fixedEnvironment = Object.freeze({
  HOME: "/root",
  LC_ALL: "C",
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
});

export interface CaddyCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CaddyCommandRunner {
  readonly run: (
    args: readonly string[],
    environment: Readonly<Record<string, string>>,
    timeoutMilliseconds: number,
  ) => Promise<CaddyCommandResult>;
}

export interface TenantCaddyRouteRunnerOptions {
  readonly routeRoot: string;
  readonly dockerBinary?: string;
  readonly commandTimeoutMilliseconds?: number;
  readonly commandRunner?: CaddyCommandRunner;
}

export interface TenantCaddyRouteDecommissioner {
  readonly removeRoute: (
    request: HostAdapterDecommissionRequest,
  ) => Promise<{ readonly routeRemoved: boolean }>;
  readonly removeTenantNetwork: (
    request: HostAdapterDecommissionRequest,
  ) => Promise<{ readonly networkRemoved: boolean }>;
}

function createCommandRunner(binary: string): CaddyCommandRunner {
  if (!isAbsolute(binary) || /[\0\r\n]/u.test(binary)) {
    throw new Error("invalid docker binary");
  }
  return Object.freeze({
    run: (
      args: readonly string[],
      environment: Readonly<Record<string, string>>,
      timeoutMilliseconds: number,
    ) =>
      new Promise<CaddyCommandResult>((resolveResult, reject) => {
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
          finish(() => reject(new Error("caddy command timed out")));
        }, timeoutMilliseconds);
        if (!child.stdout || !child.stderr) {
          child.kill("SIGKILL");
          finish(() => reject(new Error("caddy command output unavailable")));
          return;
        }
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
          if (Buffer.byteLength(stdout) > 65_536) child.kill("SIGKILL");
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
          if (Buffer.byteLength(stderr) > 65_536) child.kill("SIGKILL");
        });
        child.once("error", (error) => finish(() => reject(error)));
        child.once("close", (exitCode) =>
          finish(() => resolveResult({ exitCode: exitCode ?? 1, stdout, stderr })),
        );
      }),
  });
}

function safeChildPath(rootDirectory: string, name: string): string {
  const root = resolve(rootDirectory);
  const target = resolve(root, name);
  const relation = relative(root, target);
  if (!relation || relation.startsWith(`..${sep}`) || relation === ".." || isAbsolute(relation)) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  return target;
}

async function assertRouteRoot(rootDirectory: string): Promise<void> {
  try {
    const metadata = await lstat(rootDirectory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new HostAdapterError("IDENTITY_MISMATCH");
    }
  } catch (error) {
    if (error instanceof HostAdapterError) throw error;
    const code = (error as { readonly code?: string }).code;
    if (code === "EACCES" || code === "EPERM") throw new HostAdapterError("PERMISSION_DENIED");
    throw new HostAdapterError("UNAVAILABLE");
  }
}

async function readRoute(path: string): Promise<string | undefined> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 65_536) {
      throw new HostAdapterError("IDENTITY_MISMATCH");
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof HostAdapterError) throw error;
    const code = (error as { readonly code?: string }).code;
    if (code === "ENOENT") return undefined;
    if (code === "EACCES" || code === "EPERM") throw new HostAdapterError("PERMISSION_DENIED");
    throw new HostAdapterError("UNAVAILABLE");
  }
}

async function replaceAtomically(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    const code = (error as { readonly code?: string }).code;
    if (code === "EACCES" || code === "EPERM") throw new HostAdapterError("PERMISSION_DENIED");
    throw new HostAdapterError("UNAVAILABLE");
  }
}

async function restoreRoute(path: string, priorContent: string | undefined): Promise<void> {
  if (priorContent !== undefined) {
    await replaceAtomically(path, priorContent);
    return;
  }
  try {
    await unlink(path);
  } catch (error) {
    const code = (error as { readonly code?: string }).code;
    if (code !== "ENOENT") throw error;
  }
}

async function savePriorSnapshot(
  routeRoot: string,
  tenantProfileId: string,
  generation: bigint,
  content: string | undefined,
): Promise<void> {
  if (content === undefined) return;
  const history = safeChildPath(routeRoot, ".history");
  try {
    await mkdir(history, { recursive: true, mode: 0o700 });
    const metadata = await lstat(history);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new HostAdapterError("IDENTITY_MISMATCH");
    }
    await replaceAtomically(
      safeChildPath(history, `${tenantProfileId}-${generation.toString()}.caddy`),
      content,
    );
  } catch (error) {
    if (error instanceof HostAdapterError) throw error;
    const code = (error as { readonly code?: string }).code;
    if (code === "EACCES" || code === "EPERM") throw new HostAdapterError("PERMISSION_DENIED");
    throw new HostAdapterError("UNAVAILABLE");
  }
}

function routeCommand(request: HostAdapterHttpsRequest): TenantHttpsRouteProvisioningCommand {
  return validateTenantHttpsRouteProvisioningCommand({
    operationId: request.operationId,
    tenantProfileId: request.tenantProfileId,
    serverId: request.serverId,
    releaseId: request.releaseId,
    hostname: request.hostname,
    edgeNetworkName: request.edgeNetworkName,
    upstreamServices: request.upstreamServices,
    configurationRevision: request.configurationRevision,
    attempt: request.attempt,
  });
}

function routeContent(request: TenantHttpsRouteProvisioningCommand): string {
  if (request.upstreamServices.length !== 1 || request.upstreamServices[0] !== "crm-web") {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const crmWeb = tenantEdgeServiceAlias(request.tenantProfileId, "crm-web");
  return `${request.hostname} {\n\timport static_headers\n\treverse_proxy ${crmWeb}:3000 {\n\t\thealth_uri /api/health/ready\n\t\thealth_interval 10s\n\t\thealth_timeout 3s\n\t\ttransport http {\n\t\t\tdial_timeout 3s\n\t\t\tresponse_header_timeout 30s\n\t\t}\n\t}\n}\n`;
}

function caddyContainerId(result: CaddyCommandResult): string {
  if (result.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
  const identifiers = result.stdout
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  if (identifiers.length !== 1 || !/^[0-9a-f]{64}$/u.test(identifiers[0] as string)) {
    throw new HostAdapterError("UNAVAILABLE");
  }
  return identifiers[0] as string;
}

async function attachCaddyToTenantNetwork(
  runner: CaddyCommandRunner,
  timeout: number,
  edgeNetworkName: string,
): Promise<string> {
  const environment = Object.freeze({});
  const caddyId = caddyContainerId(
    await runner.run(
      [
        "ps",
        "--no-trunc",
        "--filter",
        `label=com.docker.compose.project=${edgeProjectName}`,
        "--filter",
        `label=com.docker.compose.service=${edgeServiceName}`,
        "--format",
        "{{.ID}}",
      ],
      environment,
      timeout,
    ),
  );
  const connected = await runner.run(
    ["network", "connect", edgeNetworkName, caddyId],
    environment,
    timeout,
  );
  if (connected.exitCode === 0) return caddyId;
  const inspected = await runner.run(
    ["network", "inspect", edgeNetworkName, "--format", "{{json .Containers}}"],
    environment,
    timeout,
  );
  if (inspected.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
  try {
    const containers = JSON.parse(inspected.stdout) as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(containers, caddyId)) {
      throw new HostAdapterError("UNAVAILABLE");
    }
  } catch (error) {
    if (error instanceof HostAdapterError) throw error;
    throw new HostAdapterError("UNAVAILABLE");
  }
  return caddyId;
}

async function caddyCommand(
  runner: CaddyCommandRunner,
  timeout: number,
  containerId: string,
  command: "validate" | "reload",
): Promise<void> {
  const args =
    command === "validate"
      ? [
          "exec",
          containerId,
          "caddy",
          "validate",
          "--config",
          "/etc/caddy/Caddyfile",
          "--adapter",
          "caddyfile",
        ]
      : [
          "exec",
          containerId,
          "caddy",
          "reload",
          "--config",
          "/etc/caddy/Caddyfile",
          "--adapter",
          "caddyfile",
          "--address",
          "127.0.0.1:2019",
        ];
  const result = await runner.run(args, Object.freeze({}), timeout);
  if (result.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
}

async function removeCaddyRoute(
  options: TenantCaddyRouteRunnerOptions,
  runner: CaddyCommandRunner,
  timeout: number,
  request: HostAdapterDecommissionRequest,
): Promise<{ readonly routeRemoved: boolean }> {
  await assertRouteRoot(options.routeRoot);
  const path = safeChildPath(options.routeRoot, `${request.tenantProfileId}.caddy`);
  const priorContent = await readRoute(path);
  if (priorContent === undefined) return Object.freeze({ routeRemoved: true });
  const containerId = caddyContainerId(
    await runner.run(
      [
        "ps",
        "--no-trunc",
        "--filter",
        `label=com.docker.compose.project=${edgeProjectName}`,
        "--filter",
        `label=com.docker.compose.service=${edgeServiceName}`,
        "--format",
        "{{.ID}}",
      ],
      Object.freeze({}),
      timeout,
    ),
  );
  await unlink(path).catch((error: unknown) => {
    const code = (error as { readonly code?: string }).code;
    if (code === "ENOENT") return;
    if (code === "EACCES" || code === "EPERM") throw new HostAdapterError("PERMISSION_DENIED");
    throw new HostAdapterError("UNAVAILABLE");
  });
  try {
    await caddyCommand(runner, timeout, containerId, "validate");
    await caddyCommand(runner, timeout, containerId, "reload");
  } catch (error) {
    await replaceAtomically(path, priorContent).catch(() => undefined);
    await caddyCommand(runner, timeout, containerId, "reload").catch(() => undefined);
    throw error;
  }
  return Object.freeze({ routeRemoved: true });
}

async function removeTenantNetwork(
  runner: CaddyCommandRunner,
  timeout: number,
  request: HostAdapterDecommissionRequest,
): Promise<{ readonly networkRemoved: boolean }> {
  const inspected = await runner.run(
    ["network", "inspect", request.edgeNetworkName],
    Object.freeze({}),
    timeout,
  );
  if (inspected.exitCode === 1) return Object.freeze({ networkRemoved: true });
  if (inspected.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");

  const caddyId = caddyContainerId(
    await runner.run(
      [
        "ps",
        "--no-trunc",
        "--filter",
        `label=com.docker.compose.project=${edgeProjectName}`,
        "--filter",
        `label=com.docker.compose.service=${edgeServiceName}`,
        "--format",
        "{{.ID}}",
      ],
      Object.freeze({}),
      timeout,
    ),
  );
  const disconnected = await runner.run(
    ["network", "disconnect", request.edgeNetworkName, caddyId],
    Object.freeze({}),
    timeout,
  );
  if (disconnected.exitCode !== 0) {
    const observed = await runner.run(
      ["network", "inspect", request.edgeNetworkName, "--format", "{{json .Containers}}"],
      Object.freeze({}),
      timeout,
    );
    if (observed.exitCode !== 0 || observed.stdout.includes(caddyId)) {
      throw new HostAdapterError("UNAVAILABLE");
    }
  }
  const removed = await runner.run(
    ["network", "rm", request.edgeNetworkName],
    Object.freeze({}),
    timeout,
  );
  if (removed.exitCode === 0) return Object.freeze({ networkRemoved: true });
  const observedAfterRemove = await runner.run(
    ["network", "inspect", request.edgeNetworkName],
    Object.freeze({}),
    timeout,
  );
  if (observedAfterRemove.exitCode === 1) return Object.freeze({ networkRemoved: true });
  throw new HostAdapterError("TARGET_CONFLICT");
}

export function createTenantCaddyRouteDecommissioner(
  options: TenantCaddyRouteRunnerOptions,
): TenantCaddyRouteDecommissioner {
  if (
    !isAbsolute(options.routeRoot) ||
    options.routeRoot === "/" ||
    /[\0\r\n]/u.test(options.routeRoot)
  ) {
    throw new Error("invalid tenant route root");
  }
  const runner =
    options.commandRunner ?? createCommandRunner(options.dockerBinary ?? "/usr/bin/docker");
  const timeout = options.commandTimeoutMilliseconds ?? defaultTimeoutMilliseconds;
  return Object.freeze({
    removeRoute: async (request: HostAdapterDecommissionRequest) =>
      removeCaddyRoute(options, runner, timeout, request),
    removeTenantNetwork: async (request: HostAdapterDecommissionRequest) =>
      removeTenantNetwork(runner, timeout, request),
  });
}

export function createTenantCaddyRouteReconciler(
  options: TenantCaddyRouteRunnerOptions,
): TenantHttpsRouteReconciler {
  if (
    !isAbsolute(options.routeRoot) ||
    options.routeRoot === "/" ||
    /[\0\r\n]/u.test(options.routeRoot)
  ) {
    throw new Error("invalid tenant route root");
  }
  const runner =
    options.commandRunner ?? createCommandRunner(options.dockerBinary ?? "/usr/bin/docker");
  const timeout = options.commandTimeoutMilliseconds ?? defaultTimeoutMilliseconds;
  let tail: Promise<void> = Promise.resolve();

  return Object.freeze({
    reconcile: async (request: HostAdapterHttpsRequest): Promise<HostAdapterHttpsResult> => {
      let releaseQueue!: () => void;
      const next = new Promise<void>((resolve) => {
        releaseQueue = resolve;
      });
      const previous = tail;
      tail = next;
      await previous;
      try {
        const command = routeCommand(request);
        await assertRouteRoot(options.routeRoot);
        const path = safeChildPath(options.routeRoot, `${command.tenantProfileId}.caddy`);
        const content = routeContent(command);
        const priorContent = await readRoute(path);
        const containerId = await attachCaddyToTenantNetwork(
          runner,
          timeout,
          command.edgeNetworkName,
        );
        if (priorContent !== content) {
          await savePriorSnapshot(
            options.routeRoot,
            command.tenantProfileId,
            command.configurationRevision,
            priorContent,
          );
          await replaceAtomically(path, content);
          try {
            await caddyCommand(runner, timeout, containerId, "validate");
          } catch (error) {
            await restoreRoute(path, priorContent).catch(() => undefined);
            throw error;
          }
          try {
            await caddyCommand(runner, timeout, containerId, "reload");
          } catch (error) {
            await restoreRoute(path, priorContent).catch(() => undefined);
            await caddyCommand(runner, timeout, containerId, "reload").catch(() => undefined);
            throw error;
          }
        }
        return Object.freeze({
          hostname: command.hostname,
          edgeNetworkName: command.edgeNetworkName,
          routeGeneration: command.configurationRevision,
          configured: true,
          reconciled: true,
        });
      } catch (error) {
        if (error instanceof HostAdapterError) throw error;
        throw new HostAdapterError("UNAVAILABLE");
      } finally {
        releaseQueue();
      }
    },
  });
}
