import { request } from "node:http";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export class TenantCrmMigrationProvisioningError extends Error {
  public constructor(
    public readonly reason:
      "UNAVAILABLE" | "PERMISSION_DENIED" | "TARGET_CONFLICT" | "IDENTITY_MISMATCH",
  ) {
    super(`CRM migration failed: ${reason}`);
  }
}
export interface TenantCrmMigrationProvisioner {
  readonly migrate: (command: {
    readonly operationId: string;
    readonly tenantProfileId: string;
    readonly serverId: string;
    readonly releaseId: string;
    readonly attempt: number;
  }) => Promise<void>;
}
type TenantCrmMigrationCommand = Parameters<TenantCrmMigrationProvisioner["migrate"]>[0];
export function createTenantCrmMigrationProvisioner(
  socketPath: string,
): TenantCrmMigrationProvisioner {
  if (!socketPath.startsWith("/") || socketPath.length > 255)
    throw new Error("invalid deploy host socket path");
  return Object.freeze({
    migrate: async (command: TenantCrmMigrationCommand) => {
      if (
        ![command.operationId, command.tenantProfileId, command.serverId, command.releaseId].every(
          (value) => uuidPattern.test(value),
        ) ||
        !Number.isInteger(command.attempt) ||
        command.attempt < 1
      )
        throw new TenantCrmMigrationProvisioningError("IDENTITY_MISMATCH");
      const payload = JSON.stringify({
        action: "MIGRATE_TENANT_CRM_DATABASE",
        ...command,
        manifestRef: `tenant/${command.tenantProfileId}/configuration.json`,
        configurationRevision: "1",
      });
      await new Promise<void>((resolve, reject) => {
        let client: ReturnType<typeof request> | undefined;
        const timer = setTimeout(() => {
          client?.destroy();
          reject(new TenantCrmMigrationProvisioningError("UNAVAILABLE"));
        }, 180_000);
        client = request(
          {
            socketPath,
            path: "/v1/tenant-database/migrate",
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            },
          },
          (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              body += chunk;
            });
            response.on("end", () => {
              clearTimeout(timer);
              if (response.statusCode === 200) {
                resolve();
                return;
              }
              let reason: unknown;
              try {
                reason = (JSON.parse(body) as { readonly reason?: unknown }).reason;
              } catch {
                reason = "UNAVAILABLE";
              }
              reject(
                new TenantCrmMigrationProvisioningError(
                  reason === "PERMISSION_DENIED" ||
                    reason === "TARGET_CONFLICT" ||
                    reason === "IDENTITY_MISMATCH"
                    ? reason
                    : "UNAVAILABLE",
                ),
              );
            });
          },
        );
        client.once("error", () => {
          clearTimeout(timer);
          reject(new TenantCrmMigrationProvisioningError("UNAVAILABLE"));
        });
        client.write(payload);
        client.end();
      });
    },
  });
}
