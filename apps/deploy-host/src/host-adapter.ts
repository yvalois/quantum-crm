import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { unlink } from "node:fs/promises";

import {
  ProvisioningOperationValidationError,
  tenantContainerServiceNames,
  tenantHttpsUpstreamServiceNames,
  platformReleaseArtifactNames,
  type PlatformReleaseArtifactName,
  type TenantContainerServiceName,
  type TenantHttpsUpstreamServiceName,
} from "@quantum-crm/platform-domain";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const manifestPattern = /^tenant\/([0-9a-f-]{36})\/configuration\.json$/u;
const projectPattern = /^qcrm-t-[0-9a-f-]{36}$/u;
const allowedContainerRequestKeys = new Set([
  "action",
  "operationId",
  "tenantProfileId",
  "serverId",
  "releaseId",
  "manifestRef",
  "configurationRevision",
  "attempt",
]);
const allowedHttpsRequestKeys = new Set([
  "action",
  "operationId",
  "tenantProfileId",
  "serverId",
  "releaseId",
  "hostname",
  "edgeNetworkName",
  "upstreamServices",
  "configurationRevision",
  "attempt",
]);
const allowedFoundationReleaseRequestKeys = new Set(["action", "artifacts"]);
const hostnamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[0-9-]+\.nip\.io$/u;
const edgeNetworkPattern = /^qcrm-tenant-edge-[0-9a-f-]{36}$/u;

export type HostAdapterFailureReason =
  "UNAVAILABLE" | "PERMISSION_DENIED" | "TARGET_CONFLICT" | "IDENTITY_MISMATCH";

export interface HostAdapterRequest {
  readonly action: "RECONCILE_TENANT_COMPOSE";
  readonly operationId: string;
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly releaseId: string;
  readonly manifestRef: string;
  readonly configurationRevision: bigint;
  readonly attempt: number;
  readonly projectName: string;
}

export interface HostAdapterResult {
  readonly projectName: string;
  readonly services: readonly TenantContainerServiceName[];
  readonly ready: boolean;
  readonly reconciled: boolean;
}

export interface HostAdapterHttpsRequest {
  readonly action: "RECONCILE_TENANT_HTTPS";
  readonly operationId: string;
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly releaseId: string;
  readonly hostname: string;
  readonly edgeNetworkName: string;
  readonly upstreamServices: readonly TenantHttpsUpstreamServiceName[];
  readonly configurationRevision: bigint;
  readonly attempt: number;
}

export interface HostAdapterHttpsResult {
  readonly hostname: string;
  readonly edgeNetworkName: string;
  readonly routeGeneration: bigint;
  readonly configured: boolean;
  readonly reconciled: boolean;
}

export interface TenantComposeReconciler {
  readonly reconcile: (request: HostAdapterRequest) => Promise<HostAdapterResult>;
}

export interface HostAdapterMigrationRequest extends Omit<HostAdapterRequest, "action"> {
  readonly action: "MIGRATE_TENANT_CRM_DATABASE";
}

export interface TenantCrmMigrationReconciler {
  readonly migrate: (request: HostAdapterMigrationRequest) => Promise<{
    readonly migrated: boolean;
    readonly reconciled: boolean;
  }>;
}

export interface HostAdapterFoundationReleaseRequest {
  readonly action: "RECONCILE_PLATFORM_FOUNDATION_RELEASE";
  readonly artifacts: readonly {
    readonly name: PlatformReleaseArtifactName;
    readonly digest: string;
  }[];
}

export interface PlatformFoundationReleaseDeployer {
  readonly deploy: (request: HostAdapterFoundationReleaseRequest) => Promise<void>;
}

export interface TenantHttpsRouteReconciler {
  readonly reconcile: (request: HostAdapterHttpsRequest) => Promise<HostAdapterHttpsResult>;
}

export interface HostAdapterServerOptions {
  readonly socketPath: string;
  readonly reconciler: TenantComposeReconciler;
  readonly httpsRouteReconciler?: TenantHttpsRouteReconciler;
  readonly migrationReconciler?: TenantCrmMigrationReconciler;
  readonly foundationReleaseDeployer?: PlatformFoundationReleaseDeployer;
  readonly requestTimeoutMilliseconds?: number;
}

export class HostAdapterError extends Error {
  public constructor(
    public readonly reason: HostAdapterFailureReason,
    message = `host adapter request failed: ${reason}`,
  ) {
    super(message);
    this.name = "HostAdapterError";
  }
}

function parseRequest(value: unknown): HostAdapterRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const input = value as Record<string, unknown>;
  if ([...Object.keys(input)].some((key) => !allowedContainerRequestKeys.has(key))) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  if (input.action !== "RECONCILE_TENANT_COMPOSE") {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const operationId = input.operationId;
  const tenantProfileId = input.tenantProfileId;
  const serverId = input.serverId;
  const releaseId = input.releaseId;
  if (
    typeof operationId !== "string" ||
    !uuidPattern.test(operationId) ||
    typeof tenantProfileId !== "string" ||
    !uuidPattern.test(tenantProfileId) ||
    typeof serverId !== "string" ||
    !uuidPattern.test(serverId) ||
    typeof releaseId !== "string" ||
    !uuidPattern.test(releaseId)
  ) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  if (typeof input.manifestRef !== "string") {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const manifest = manifestPattern.exec(input.manifestRef);
  if (!manifest || manifest[1] !== input.tenantProfileId) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  if (
    typeof input.configurationRevision !== "string" ||
    !/^[1-9][0-9]*$/u.test(input.configurationRevision)
  ) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  if (
    typeof input.attempt !== "number" ||
    !Number.isSafeInteger(input.attempt) ||
    input.attempt < 1
  ) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  return Object.freeze({
    action: "RECONCILE_TENANT_COMPOSE",
    operationId,
    tenantProfileId,
    serverId,
    releaseId,
    manifestRef: input.manifestRef,
    configurationRevision: BigInt(input.configurationRevision),
    attempt: input.attempt,
    projectName: `qcrm-t-${tenantProfileId}`,
  });
}

function parseMigrationRequest(value: unknown): HostAdapterMigrationRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const input = value as Record<string, unknown>;
  if (input.action !== "MIGRATE_TENANT_CRM_DATABASE") {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const base = parseRequest({ ...input, action: "RECONCILE_TENANT_COMPOSE" });
  return Object.freeze({ ...base, action: "MIGRATE_TENANT_CRM_DATABASE" as const });
}

function parseFoundationReleaseRequest(value: unknown): HostAdapterFoundationReleaseRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const input = value as Record<string, unknown>;
  if (
    [...Object.keys(input)].some((key) => !allowedFoundationReleaseRequestKeys.has(key)) ||
    input.action !== "RECONCILE_PLATFORM_FOUNDATION_RELEASE" ||
    !Array.isArray(input.artifacts) ||
    input.artifacts.length !== platformReleaseArtifactNames.length
  ) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const artifacts = input.artifacts.map((artifact) => {
    if (typeof artifact !== "object" || artifact === null || Array.isArray(artifact)) {
      throw new HostAdapterError("IDENTITY_MISMATCH");
    }
    const record = artifact as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      typeof record.name !== "string" ||
      !platformReleaseArtifactNames.includes(record.name as PlatformReleaseArtifactName) ||
      typeof record.digest !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(record.digest)
    ) {
      throw new HostAdapterError("IDENTITY_MISMATCH");
    }
    return Object.freeze({ name: record.name as PlatformReleaseArtifactName, digest: record.digest });
  });
  if (
    new Set(artifacts.map((artifact) => artifact.name)).size !== platformReleaseArtifactNames.length ||
    platformReleaseArtifactNames.some((name) => !artifacts.some((artifact) => artifact.name === name))
  ) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  return Object.freeze({ action: "RECONCILE_PLATFORM_FOUNDATION_RELEASE" as const, artifacts });
}

function parseHttpsRequest(value: unknown): HostAdapterHttpsRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  const input = value as Record<string, unknown>;
  if ([...Object.keys(input)].some((key) => !allowedHttpsRequestKeys.has(key))) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  if (input.action !== "RECONCILE_TENANT_HTTPS") throw new HostAdapterError("IDENTITY_MISMATCH");
  const operationId = input.operationId;
  const tenantProfileId = input.tenantProfileId;
  const serverId = input.serverId;
  const releaseId = input.releaseId;
  const hostname = input.hostname;
  const edgeNetworkName = input.edgeNetworkName;
  if (
    typeof operationId !== "string" ||
    !uuidPattern.test(operationId) ||
    typeof tenantProfileId !== "string" ||
    !uuidPattern.test(tenantProfileId) ||
    typeof serverId !== "string" ||
    !uuidPattern.test(serverId) ||
    typeof releaseId !== "string" ||
    !uuidPattern.test(releaseId) ||
    typeof hostname !== "string" ||
    !hostnamePattern.test(hostname) ||
    typeof edgeNetworkName !== "string" ||
    edgeNetworkName !== `qcrm-tenant-edge-${tenantProfileId}` ||
    !edgeNetworkPattern.test(edgeNetworkName)
  ) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  if (
    !Array.isArray(input.upstreamServices) ||
    input.upstreamServices.length === 0 ||
    input.upstreamServices.length > tenantHttpsUpstreamServiceNames.length ||
    new Set(input.upstreamServices).size !== input.upstreamServices.length ||
    input.upstreamServices.some(
      (service) =>
        typeof service !== "string" ||
        !tenantHttpsUpstreamServiceNames.includes(service as TenantHttpsUpstreamServiceName),
    )
  ) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  if (
    typeof input.configurationRevision !== "string" ||
    !/^[1-9][0-9]*$/u.test(input.configurationRevision) ||
    typeof input.attempt !== "number" ||
    !Number.isSafeInteger(input.attempt) ||
    input.attempt < 1
  ) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  return Object.freeze({
    action: "RECONCILE_TENANT_HTTPS",
    operationId,
    tenantProfileId,
    serverId,
    releaseId,
    hostname,
    edgeNetworkName,
    upstreamServices: Object.freeze(
      [...input.upstreamServices].sort() as TenantHttpsUpstreamServiceName[],
    ),
    configurationRevision: BigInt(input.configurationRevision),
    attempt: input.attempt,
  });
}

function parseResult(value: HostAdapterResult, projectName: string): HostAdapterResult {
  if (
    typeof value !== "object" ||
    value === null ||
    value.projectName !== projectName ||
    !projectPattern.test(value.projectName) ||
    !Array.isArray(value.services) ||
    value.services.length !== tenantContainerServiceNames.length ||
    tenantContainerServiceNames.some((service) => !value.services.includes(service)) ||
    typeof value.ready !== "boolean" ||
    typeof value.reconciled !== "boolean"
  ) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  return Object.freeze({
    projectName: value.projectName,
    services: Object.freeze([...value.services].sort() as TenantContainerServiceName[]),
    ready: value.ready,
    reconciled: value.reconciled,
  });
}

function parseHttpsResult(
  value: HostAdapterHttpsResult,
  request: HostAdapterHttpsRequest,
): HostAdapterHttpsResult {
  if (
    typeof value !== "object" ||
    value === null ||
    value.hostname !== request.hostname ||
    value.edgeNetworkName !== request.edgeNetworkName ||
    typeof value.routeGeneration !== "bigint" ||
    value.routeGeneration < 1n ||
    typeof value.configured !== "boolean" ||
    typeof value.reconciled !== "boolean"
  ) {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  return Object.freeze({
    hostname: value.hostname,
    edgeNetworkName: value.edgeNetworkName,
    routeGeneration: value.routeGeneration,
    configured: value.configured,
    reconciled: value.reconciled,
  });
}

async function readBody(request: IncomingMessage, maximumBytes: number): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (Buffer.byteLength(body) > maximumBytes) {
      throw new HostAdapterError("IDENTITY_MISMATCH");
    }
  }
  return body;
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function statusFor(reason: HostAdapterFailureReason): number {
  return reason === "UNAVAILABLE" ? 503 : reason === "PERMISSION_DENIED" ? 403 : 409;
}

export function createHostAdapterServer(options: HostAdapterServerOptions) {
  if (
    !options.socketPath.startsWith("/") ||
    options.socketPath.length > 255 ||
    options.socketPath === "/" ||
    /[\0\r\n]/u.test(options.socketPath)
  ) {
    throw new Error("invalid host adapter socket path");
  }
  const timeout = options.requestTimeoutMilliseconds ?? 15_000;
  const server = createServer(async (request, response) => {
    const isContainerRequest = request.url === "/v1/tenant-containers/reconcile";
    const isHttpsRequest = request.url === "/v1/tenant-https/reconcile";
    const isMigrationRequest = request.url === "/v1/tenant-database/migrate";
    const isFoundationReleaseRequest = request.url === "/v1/platform-foundation/reconcile";
    if (
      request.method !== "POST" ||
      (!isContainerRequest && !isHttpsRequest && !isMigrationRequest && !isFoundationReleaseRequest)
    ) {
      writeJson(response, 404, { reason: "IDENTITY_MISMATCH" });
      return;
    }
    request.setTimeout(timeout, () => request.destroy());
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(request, 65_536)) as unknown;
      } catch (error) {
        if (error instanceof HostAdapterError) throw error;
        throw new HostAdapterError("IDENTITY_MISMATCH");
      }
      if (isContainerRequest) {
        const validated = parseRequest(parsed);
        const result = await options.reconciler.reconcile(validated);
        writeJson(response, 200, parseResult(result, validated.projectName));
        return;
      }
      if (isMigrationRequest) {
        if (!options.migrationReconciler) throw new HostAdapterError("UNAVAILABLE");
        const validated = parseMigrationRequest(parsed);
        const result = await options.migrationReconciler.migrate(validated);
        if (!result.migrated) throw new HostAdapterError("UNAVAILABLE");
        writeJson(response, 200, { migrated: true, reconciled: result.reconciled });
        return;
      }
      if (isFoundationReleaseRequest) {
        if (!options.foundationReleaseDeployer) throw new HostAdapterError("UNAVAILABLE");
        await options.foundationReleaseDeployer.deploy(parseFoundationReleaseRequest(parsed));
        writeJson(response, 200, { reconciled: true });
        return;
      }
      if (!options.httpsRouteReconciler) throw new HostAdapterError("UNAVAILABLE");
      const validated = parseHttpsRequest(parsed);
      const result = await options.httpsRouteReconciler.reconcile(validated);
      const responseValue = parseHttpsResult(result, validated);
      writeJson(response, 200, {
        ...responseValue,
        routeGeneration: responseValue.routeGeneration.toString(),
      });
    } catch (error) {
      const failure =
        error instanceof HostAdapterError
          ? error
          : error instanceof ProvisioningOperationValidationError
            ? new HostAdapterError("IDENTITY_MISMATCH")
            : new HostAdapterError("UNAVAILABLE");
      writeJson(response, statusFor(failure.reason), {
        reason: failure.reason,
      });
    }
  });

  return Object.freeze({
    listen: async (): Promise<void> => {
      await unlink(options.socketPath).catch((error: unknown) => {
        if ((error as { readonly code?: string }).code !== "ENOENT") throw error;
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen({ path: options.socketPath, mode: 0o660 }, () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
    },
    close: async (): Promise<void> => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  });
}
