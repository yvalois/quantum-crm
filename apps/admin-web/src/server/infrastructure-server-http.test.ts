import type { AdminWebAuthConfig } from "@quantum-crm/config";
import { SecretValue } from "@quantum-crm/config";
import { describe, expect, it, vi } from "vitest";

import type { PlatformAuthRuntime } from "./platform-auth-http.js";
import { handleInfrastructureServerList } from "./infrastructure-server-http.js";

const config: AdminWebAuthConfig = {
  schemaVersion: "admin-web-auth-config/v1",
  environment: "production",
  origin: "https://admin.example.test",
  adminApiOrigin: "http://admin-api:3002",
  issuer: "https://identity.example.test/realms/quantum-platform",
  clientId: "quantum-admin-web",
  clientSecret: new SecretValue("synthetic-client-secret"),
  redisUrl: new SecretValue("rediss://session-user:synthetic@redis:6379/1"),
  callbackUrl: "https://admin.example.test/api/auth/callback/keycloak",
  signedOutUrl: "https://admin.example.test/signed-out",
  requiredAcr: "2",
  loginTransactionTtlSeconds: 300,
  sessionIdleTtlSeconds: 1800,
  sessionAbsoluteTtlSeconds: 28800,
  secureCookies: true,
  sessionNamespace: "platform",
};

function runtime(platformApiFetch: typeof fetch): PlatformAuthRuntime {
  return {
    config,
    platformApiFetch,
    auth: {
      beginLogin: vi.fn(),
      completeLogin: vi.fn(),
      logout: vi.fn(),
      session: vi.fn(async () => ({
        subject: "operator",
        accessToken: new SecretValue("server-only-access-token"),
        accessTokenExpiresAt: new Date("2026-09-20T15:05:00.000Z"),
        refreshToken: new SecretValue("server-only-refresh-token"),
        idToken: new SecretValue("server-only-id-token"),
        csrfToken: "c".repeat(43),
        authenticatedAt: new Date("2026-09-20T15:00:00.000Z"),
        createdAt: new Date("2026-09-20T15:00:00.000Z"),
        lastSeenAt: new Date("2026-09-20T15:00:00.000Z"),
        absoluteExpiresAt: new Date("2026-09-20T23:00:00.000Z"),
      })),
    },
  };
}

describe("infrastructure server BFF boundary", () => {
  it("lists only available servers through the fixed internal endpoint", async () => {
    const upstream = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        schemaVersion: "infrastructure-server-list/v1",
        data: [
          {
            id: "01995f7e-7b52-7000-8000-000000000201",
            code: "primary-vps",
            displayName: "Quantum Primary",
            provider: "VPS",
            region: "us-east",
            publicIpv4: "192.0.2.10",
            operatingSystem: "Ubuntu 24.04",
            architecture: "X86_64",
            status: "AVAILABLE",
            totalCapacity: { cpuMillicores: 6000, memoryMiB: 24576, storageMiB: 262144 },
            reservedCapacity: { cpuMillicores: 1000, memoryMiB: 3072, storageMiB: 30720 },
            availableCapacity: { cpuMillicores: 5000, memoryMiB: 21504, storageMiB: 231424 },
            credentialConfigured: true,
            confirmedAt: "2026-09-20T15:00:00.000Z",
            version: "2",
            createdAt: "2026-09-20T15:00:00.000Z",
            updatedAt: "2026-09-20T15:00:00.000Z",
          },
        ],
        meta: { pageSize: 25 },
      }),
    );
    const response = await handleInfrastructureServerList(
      new Request(
        "https://admin.example.test/api/platform/infrastructure-servers?status=AVAILABLE&pageSize=25",
        { headers: { cookie: `__Host-qcrm_admin_session=${"b".repeat(43)}` } },
      ),
      runtime(upstream as typeof fetch),
    );

    expect(response.status).toBe(200);
    expect(upstream.mock.calls[0]?.[0].toString()).toBe(
      "http://admin-api:3002/api/v1/infrastructure-servers?pageSize=25&status=AVAILABLE",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects unknown query parameters without contacting the platform API", async () => {
    const upstream = vi.fn(fetch);
    const response = await handleInfrastructureServerList(
      new Request("https://admin.example.test/api/platform/infrastructure-servers?target=invalid", {
        headers: { cookie: `__Host-qcrm_admin_session=${"b".repeat(43)}` },
      }),
      runtime(upstream),
    );

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});
