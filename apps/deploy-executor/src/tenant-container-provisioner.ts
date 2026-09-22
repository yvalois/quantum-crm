import { request } from "node:http";

import {
  ProvisioningOperationValidationError,
  type TenantContainerProvisioner,
  type TenantContainerProvisioningCommand,
  type TenantContainerProvisioningResult,
} from "@quantum-crm/platform-domain";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const manifestPattern = /^tenant\/([0-9a-f-]{36})\/configuration\.json$/u;
const projectPattern = /^qcrm-t-[0-9a-f-]{36}$/u;
const serviceNames = ["crm-web", "portal-web", "api", "worker", "agent-runtime"] as const;

export type TenantContainerProvisioningFailureReason =
  "UNAVAILABLE" | "PERMISSION_DENIED" | "TARGET_CONFLICT" | "IDENTITY_MISMATCH";

export class TenantContainerProvisioningError extends Error {
  public constructor(public readonly reason: TenantContainerProvisioningFailureReason) {
    super(`tenant container provisioning failed: ${reason}`);
    this.name = "TenantContainerProvisioningError";
  }
}

export interface TenantContainerProvisionerOptions {
  readonly socketPath: string;
  readonly requestTimeoutMilliseconds?: number;
}

interface HostAdapterResponse {
  readonly projectName?: unknown;
  readonly services?: unknown;
  readonly ready?: unknown;
  readonly reconciled?: unknown;
  readonly reason?: unknown;
}

function validateCommand(command: TenantContainerProvisioningCommand): void {
  for (const [name, value] of [
    ["operationId", command.operationId],
    ["tenantProfileId", command.tenantProfileId],
    ["serverId", command.serverId],
    ["releaseId", command.releaseId],
  ] as const) {
    if (!uuidPattern.test(value)) throw new ProvisioningOperationValidationError(name);
  }
  const match = manifestPattern.exec(command.manifestRef);
  if (!match || match[1] !== command.tenantProfileId) {
    throw new ProvisioningOperationValidationError("manifestRef");
  }
  if (!Number.isSafeInteger(command.attempt) || command.attempt < 1) {
    throw new ProvisioningOperationValidationError("attempt");
  }
  if (command.configurationRevision < 1n) {
    throw new ProvisioningOperationValidationError("configurationRevision");
  }
}

function parseFailureReason(value: unknown): TenantContainerProvisioningFailureReason {
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

function parseResult(value: HostAdapterResponse): TenantContainerProvisioningResult {
  const services = Array.isArray(value.services) ? value.services : undefined;
  if (
    typeof value.projectName !== "string" ||
    !projectPattern.test(value.projectName) ||
    !services ||
    !services.every((service): service is string => typeof service === "string") ||
    !serviceNames.every((service) => services.includes(service)) ||
    typeof value.ready !== "boolean" ||
    typeof value.reconciled !== "boolean"
  ) {
    throw new TenantContainerProvisioningError("IDENTITY_MISMATCH");
  }
  return Object.freeze({
    projectName: value.projectName,
    services: Object.freeze([...services].sort()),
    ready: value.ready,
    reconciled: value.reconciled,
  });
}

export function createTenantContainerProvisioner(
  options: TenantContainerProvisionerOptions,
): TenantContainerProvisioner {
  if (!options.socketPath.startsWith("/") || options.socketPath.length > 255) {
    throw new Error("invalid deploy host socket path");
  }
  const timeout = options.requestTimeoutMilliseconds ?? 15_000;

  return Object.freeze({
    provision: async (
      command: TenantContainerProvisioningCommand,
    ): Promise<TenantContainerProvisioningResult> => {
      validateCommand(command);
      const payload = JSON.stringify({
        action: "RECONCILE_TENANT_COMPOSE",
        operationId: command.operationId,
        tenantProfileId: command.tenantProfileId,
        serverId: command.serverId,
        releaseId: command.releaseId,
        manifestRef: command.manifestRef,
        configurationRevision: command.configurationRevision.toString(),
        attempt: command.attempt,
      });

      return await new Promise((resolve, reject) => {
        let client: ReturnType<typeof request> | undefined;
        const timer = setTimeout(() => {
          client?.destroy();
          reject(new TenantContainerProvisioningError("UNAVAILABLE"));
        }, timeout);
        let body = "";
        client = request(
          {
            socketPath: options.socketPath,
            path: "/v1/tenant-containers/reconcile",
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
              let parsed: HostAdapterResponse;
              try {
                parsed = JSON.parse(body) as HostAdapterResponse;
              } catch {
                reject(new TenantContainerProvisioningError("IDENTITY_MISMATCH"));
                return;
              }
              if (response.statusCode === 200) {
                try {
                  resolve(parseResult(parsed));
                } catch (error) {
                  reject(error);
                }
                return;
              }
              reject(new TenantContainerProvisioningError(parseFailureReason(parsed.reason)));
            });
          },
        );
        client.once("error", () => {
          clearTimeout(timer);
          reject(new TenantContainerProvisioningError("UNAVAILABLE"));
        });
        client.write(payload);
        client.end();
      });
    },
  });
}
