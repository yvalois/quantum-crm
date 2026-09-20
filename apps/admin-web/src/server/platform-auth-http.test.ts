import type { AdminWebAuthConfig } from "@quantum-crm/config";
import { SecretValue } from "@quantum-crm/config";
import { describe, expect, it, vi } from "vitest";

import type { PlatformAuthRuntime } from "./platform-auth-http.js";
import {
  handlePlatformCallback,
  handlePlatformLogin,
  handlePlatformLogout,
  handlePlatformSession,
} from "./platform-auth-http.js";

const config: AdminWebAuthConfig = {
  schemaVersion: "admin-web-auth-config/v1",
  environment: "production",
  origin: "https://admin.example.test",
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
};
const loginHandle = new SecretValue("a".repeat(43));
const sessionHandle = new SecretValue("b".repeat(43));
const csrfToken = "c".repeat(43);

function runtime(): PlatformAuthRuntime {
  return {
    config,
    auth: {
      beginLogin: vi.fn(async () => ({
        authorizationUrl: new URL("https://identity.example.test/authorize?state=opaque"),
        transactionHandle: loginHandle,
      })),
      completeLogin: vi.fn(async () => ({ returnTo: "/tenants", sessionHandle })),
      session: vi.fn(async () => ({
        subject: "operator",
        accessToken: new SecretValue("server-only-access-token"),
        refreshToken: new SecretValue("server-only-refresh-token"),
        idToken: new SecretValue("server-only-id-token"),
        csrfToken,
        authenticatedAt: new Date("2026-09-20T15:00:00.000Z"),
        createdAt: new Date("2026-09-20T15:00:00.000Z"),
        lastSeenAt: new Date("2026-09-20T15:00:00.000Z"),
        absoluteExpiresAt: new Date("2026-09-20T23:00:00.000Z"),
      })),
      logout: vi.fn(async () => undefined),
    },
  };
}

describe("admin web authentication HTTP boundary", () => {
  it("starts login with a secure host-only opaque transaction cookie", async () => {
    const response = await handlePlatformLogin(
      new Request("https://admin.example.test/api/auth/login?returnTo=%2Ftenants"),
      runtime(),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/authorize?state=opaque");
    expect(response.headers.get("set-cookie")).toContain(
      `__Host-qcrm_admin_login=${loginHandle.expose()}; Path=/; Max-Age=300; HttpOnly; SameSite=Lax; Secure`,
    );
  });

  it("creates an opaque session cookie and never returns provider tokens", async () => {
    const response = await handlePlatformCallback(
      new Request(`${config.callbackUrl}?code=synthetic&state=opaque`, {
        headers: { cookie: `__Host-qcrm_admin_login=${loginHandle.expose()}` },
      }),
      runtime(),
    );
    const headers = [...response.headers.entries()].join("\n");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://admin.example.test/tenants");
    expect(headers).toContain(`__Host-qcrm_admin_session=${sessionHandle.expose()}`);
    expect(headers).not.toContain("server-only-access-token");
    expect(headers).not.toContain("server-only-refresh-token");
  });

  it("returns only bounded session metadata to same-origin code", async () => {
    const response = await handlePlatformSession(
      new Request("https://admin.example.test/api/auth/session", {
        headers: { cookie: `__Host-qcrm_admin_session=${sessionHandle.expose()}` },
      }),
      runtime(),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(csrfToken);
    expect(body).not.toContain("server-only-access-token");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("requires both exact Origin and CSRF token for logout", async () => {
    const authRuntime = runtime();
    const rejected = await handlePlatformLogout(
      new Request("https://admin.example.test/api/auth/logout", {
        method: "POST",
        headers: {
          cookie: `__Host-qcrm_admin_session=${sessionHandle.expose()}`,
          origin: "https://attacker.test",
          "x-csrf-token": csrfToken,
        },
      }),
      authRuntime,
    );
    expect(rejected.status).toBe(403);
    expect(authRuntime.auth.logout).not.toHaveBeenCalled();

    const accepted = await handlePlatformLogout(
      new Request("https://admin.example.test/api/auth/logout", {
        method: "POST",
        headers: {
          cookie: `__Host-qcrm_admin_session=${sessionHandle.expose()}`,
          origin: config.origin,
          "x-csrf-token": csrfToken,
        },
      }),
      authRuntime,
    );
    expect(accepted.status).toBe(303);
    expect(accepted.headers.get("location")).toBe(config.signedOutUrl);
    expect(accepted.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(authRuntime.auth.logout).toHaveBeenCalledWith(sessionHandle);
  });
});
