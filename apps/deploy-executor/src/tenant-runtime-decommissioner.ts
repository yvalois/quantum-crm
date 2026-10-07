import { request } from "node:http";

export class TenantRuntimeDecommissioningError extends Error {
  public constructor(
    public readonly reason: "UNAVAILABLE" | "PERMISSION_DENIED" | "TARGET_CONFLICT",
  ) {
    super(`tenant runtime decommissioning failed: ${reason}`);
  }
}

export interface TenantRuntimeDecommissioner {
  readonly decommission: (command: {
    readonly operationId: string;
    readonly tenantProfileId: string;
    readonly serverId: string;
    readonly releaseId: string;
    readonly configurationRevision: bigint;
    readonly attempt: number;
  }) => Promise<void>;
}

export function createTenantRuntimeDecommissioner(options: {
  readonly socketPath: string;
  readonly requestTimeoutMilliseconds?: number;
}): TenantRuntimeDecommissioner {
  const timeout = options.requestTimeoutMilliseconds ?? 180_000;
  return Object.freeze({
    decommission: async (command: {
      readonly operationId: string;
      readonly tenantProfileId: string;
      readonly serverId: string;
      readonly releaseId: string;
      readonly configurationRevision: bigint;
      readonly attempt: number;
    }) => {
      const payload = JSON.stringify({
        action: "DECOMMISSION_TENANT_RUNTIME",
        operationId: command.operationId,
        tenantProfileId: command.tenantProfileId,
        serverId: command.serverId,
        releaseId: command.releaseId,
        manifestRef: `tenant/${command.tenantProfileId}/configuration.json`,
        configurationRevision: command.configurationRevision.toString(),
        attempt: command.attempt,
      });
      await new Promise<void>((resolve, reject) => {
        let client: ReturnType<typeof request> | undefined;
        const timer = setTimeout(() => {
          client?.destroy();
          reject(new TenantRuntimeDecommissioningError("UNAVAILABLE"));
        }, timeout);
        client = request(
          {
            socketPath: options.socketPath,
            path: "/v1/tenant-runtime/decommission",
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            },
          },
          (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => (body += chunk));
            response.on("end", () => {
              clearTimeout(timer);
              if (response.statusCode === 200) {
                try {
                  const result = JSON.parse(body) as { readonly decommissioned?: unknown };
                  if (result.decommissioned === true) resolve();
                  else reject(new TenantRuntimeDecommissioningError("UNAVAILABLE"));
                } catch {
                  reject(new TenantRuntimeDecommissioningError("UNAVAILABLE"));
                }
                return;
              }
              let reason: unknown;
              try {
                reason = (JSON.parse(body) as { readonly reason?: unknown }).reason;
              } catch {}
              reject(
                new TenantRuntimeDecommissioningError(
                  reason === "PERMISSION_DENIED" || reason === "TARGET_CONFLICT"
                    ? reason
                    : "UNAVAILABLE",
                ),
              );
            });
          },
        );
        client.once("error", () => {
          clearTimeout(timer);
          reject(new TenantRuntimeDecommissioningError("UNAVAILABLE"));
        });
        client.write(payload);
        client.end();
      });
    },
  });
}
