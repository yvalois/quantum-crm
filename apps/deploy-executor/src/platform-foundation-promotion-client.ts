import { request } from "node:http";

import type { PlatformReleaseArtifact } from "@quantum-crm/platform-domain";

export class PlatformFoundationPromotionClientError extends Error {
  public constructor(
    public readonly reason:
      "UNAVAILABLE" | "IDENTITY_MISMATCH" | "TARGET_CONFLICT" | "PERMISSION_DENIED",
  ) {
    super(`platform foundation promotion failed: ${reason}`);
    this.name = "PlatformFoundationPromotionClientError";
  }
}

export interface PlatformFoundationPromotionClient {
  readonly reconcile: (artifacts: readonly PlatformReleaseArtifact[]) => Promise<void>;
}

export function createPlatformFoundationPromotionClient(
  socketPath: string,
): PlatformFoundationPromotionClient {
  if (!socketPath.startsWith("/") || socketPath.length > 255)
    throw new Error("invalid deploy host socket path");
  return Object.freeze({
    reconcile: async (artifacts: readonly PlatformReleaseArtifact[]) => {
      const payload = JSON.stringify({
        action: "RECONCILE_PLATFORM_FOUNDATION_RELEASE",
        artifacts,
      });
      await new Promise<void>((resolve, reject) => {
        let client: ReturnType<typeof request> | undefined;
        const timeout = setTimeout(() => {
          client?.destroy();
          reject(new PlatformFoundationPromotionClientError("UNAVAILABLE"));
        }, 120_000);
        client = request(
          {
            socketPath,
            path: "/v1/platform-foundation/reconcile",
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
              clearTimeout(timeout);
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
                new PlatformFoundationPromotionClientError(
                  reason === "IDENTITY_MISMATCH" ||
                    reason === "TARGET_CONFLICT" ||
                    reason === "PERMISSION_DENIED"
                    ? reason
                    : "UNAVAILABLE",
                ),
              );
            });
          },
        );
        client.once("error", () => {
          clearTimeout(timeout);
          reject(new PlatformFoundationPromotionClientError("UNAVAILABLE"));
        });
        client.write(payload);
        client.end();
      });
    },
  });
}
