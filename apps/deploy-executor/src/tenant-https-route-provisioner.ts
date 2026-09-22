import { request } from "node:http";

import {
  TenantHttpsRouteValidationError,
  validateTenantHttpsRouteProvisioningCommand,
  type TenantHttpsRouteProvisioner,
  type TenantHttpsRouteProvisioningCommand,
  type TenantHttpsRouteProvisioningResult,
} from "@quantum-crm/platform-domain";

export type TenantHttpsRouteProvisioningFailureReason =
  "UNAVAILABLE" | "PERMISSION_DENIED" | "TARGET_CONFLICT" | "IDENTITY_MISMATCH";

export class TenantHttpsRouteProvisioningError extends Error {
  public constructor(public readonly reason: TenantHttpsRouteProvisioningFailureReason) {
    super(`tenant HTTPS route provisioning failed: ${reason}`);
    this.name = "TenantHttpsRouteProvisioningError";
  }
}

export interface TenantHttpsRouteProvisionerOptions {
  readonly socketPath: string;
  readonly requestTimeoutMilliseconds?: number;
}

interface HostAdapterHttpsResponse {
  readonly hostname?: unknown;
  readonly edgeNetworkName?: unknown;
  readonly routeGeneration?: unknown;
  readonly configured?: unknown;
  readonly reconciled?: unknown;
  readonly reason?: unknown;
}

function parseFailureReason(value: unknown): TenantHttpsRouteProvisioningFailureReason {
  if (
    value === "UNAVAILABLE" ||
    value === "PERMISSION_DENIED" ||
    value === "TARGET_CONFLICT" ||
    value === "IDENTITY_MISMATCH"
  ) {
    return value;
  }
  return "UNAVAILABLE";
}

function parseResult(
  value: HostAdapterHttpsResponse,
  command: TenantHttpsRouteProvisioningCommand,
): TenantHttpsRouteProvisioningResult {
  if (
    value.hostname !== command.hostname ||
    value.edgeNetworkName !== command.edgeNetworkName ||
    typeof value.routeGeneration !== "string" ||
    !/^[1-9][0-9]*$/u.test(value.routeGeneration) ||
    typeof value.configured !== "boolean" ||
    typeof value.reconciled !== "boolean"
  ) {
    throw new TenantHttpsRouteProvisioningError("IDENTITY_MISMATCH");
  }
  return Object.freeze({
    hostname: value.hostname,
    edgeNetworkName: value.edgeNetworkName,
    routeGeneration: BigInt(value.routeGeneration),
    configured: value.configured,
    reconciled: value.reconciled,
  });
}

export function createTenantHttpsRouteProvisioner(
  options: TenantHttpsRouteProvisionerOptions,
): TenantHttpsRouteProvisioner {
  if (!options.socketPath.startsWith("/") || options.socketPath.length > 255) {
    throw new Error("invalid deploy host socket path");
  }
  const timeout = options.requestTimeoutMilliseconds ?? 30_000;
  return Object.freeze({
    provision: async (
      unvalidatedCommand: TenantHttpsRouteProvisioningCommand,
    ): Promise<TenantHttpsRouteProvisioningResult> => {
      let command: TenantHttpsRouteProvisioningCommand;
      try {
        command = validateTenantHttpsRouteProvisioningCommand(unvalidatedCommand);
      } catch (error) {
        if (error instanceof TenantHttpsRouteValidationError) throw error;
        throw new TenantHttpsRouteProvisioningError("IDENTITY_MISMATCH");
      }
      const payload = JSON.stringify({
        action: "RECONCILE_TENANT_HTTPS",
        operationId: command.operationId,
        tenantProfileId: command.tenantProfileId,
        serverId: command.serverId,
        releaseId: command.releaseId,
        hostname: command.hostname,
        edgeNetworkName: command.edgeNetworkName,
        upstreamServices: command.upstreamServices,
        configurationRevision: command.configurationRevision.toString(),
        attempt: command.attempt,
      });
      return await new Promise((resolve, reject) => {
        let client: ReturnType<typeof request> | undefined;
        const timer = setTimeout(() => {
          client?.destroy();
          reject(new TenantHttpsRouteProvisioningError("UNAVAILABLE"));
        }, timeout);
        let body = "";
        client = request(
          {
            socketPath: options.socketPath,
            path: "/v1/tenant-https/reconcile",
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            },
          },
          (response) => {
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              body += chunk;
              if (body.length > 32_768) response.destroy(new Error("response too large"));
            });
            response.on("end", () => {
              clearTimeout(timer);
              let parsed: HostAdapterHttpsResponse;
              try {
                parsed = JSON.parse(body) as HostAdapterHttpsResponse;
              } catch {
                reject(new TenantHttpsRouteProvisioningError("IDENTITY_MISMATCH"));
                return;
              }
              if (response.statusCode === 200) {
                try {
                  resolve(parseResult(parsed, command));
                } catch (error) {
                  reject(error);
                }
                return;
              }
              reject(new TenantHttpsRouteProvisioningError(parseFailureReason(parsed.reason)));
            });
          },
        );
        client.once("error", () => {
          clearTimeout(timer);
          reject(new TenantHttpsRouteProvisioningError("UNAVAILABLE"));
        });
        client.write(payload);
        client.end();
      });
    },
  });
}
