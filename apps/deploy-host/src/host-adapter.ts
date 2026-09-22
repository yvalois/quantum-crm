import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { unlink } from "node:fs/promises";

import {
  ProvisioningOperationValidationError,
  tenantContainerServiceNames,
  type TenantContainerServiceName,
} from "@quantum-crm/platform-domain";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const manifestPattern = /^tenant\/([0-9a-f-]{36})\/configuration\.json$/u;
const projectPattern = /^qcrm-t-[0-9a-f-]{36}$/u;
const allowedRequestKeys = new Set([
  "action",
  "operationId",
  "tenantProfileId",
  "serverId",
  "releaseId",
  "manifestRef",
  "configurationRevision",
  "attempt",
]);

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

export interface TenantComposeReconciler {
  readonly reconcile: (request: HostAdapterRequest) => Promise<HostAdapterResult>;
}

export interface HostAdapterServerOptions {
  readonly socketPath: string;
  readonly reconciler: TenantComposeReconciler;
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
  if ([...Object.keys(input)].some((key) => !allowedRequestKeys.has(key))) {
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
    if (request.method !== "POST" || request.url !== "/v1/tenant-containers/reconcile") {
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
      const validated = parseRequest(parsed);
      const result = await options.reconciler.reconcile(validated);
      writeJson(response, 200, parseResult(result, validated.projectName));
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
