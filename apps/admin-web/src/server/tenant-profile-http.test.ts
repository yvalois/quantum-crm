import type { AdminWebAuthConfig } from "@quantum-crm/config";
import { SecretValue } from "@quantum-crm/config";
import { describe, expect, it, vi } from "vitest";

import type { PlatformAuthRuntime } from "./platform-auth-http.js";
import {
  handleTenantProfileCreate,
  handlePendingTenantProfileDeletion,
  handleAutomaticTenantProvisioningRequest,
  handleTenantProfileList,
  handleTenantProvisioningRequest,
  handleTenantProfileUpdate,
} from "./tenant-profile-http.js";

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
const sessionHandle = "b".repeat(43);
const csrfToken = "c".repeat(43);
const profileId = "01995f7e-7b52-7000-8000-000000000101";
const profile = {
  id: profileId,
  name: "Acme Colombia",
  slug: "acme-colombia",
  adminContactName: "Ada Lovelace",
  adminContactEmail: "ada@example.test",
  status: "PENDING" as const,
  serverId: null,
  releaseId: null,
  version: "1",
  createdAt: "2026-09-20T15:00:00.000Z",
  updatedAt: "2026-09-20T15:00:00.000Z",
};

function runtime(platformApiFetch: typeof fetch = vi.fn(fetch)): PlatformAuthRuntime {
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
        csrfToken,
        authenticatedAt: new Date("2026-09-20T15:00:00.000Z"),
        createdAt: new Date("2026-09-20T15:00:00.000Z"),
        lastSeenAt: new Date("2026-09-20T15:00:00.000Z"),
        absoluteExpiresAt: new Date("2026-09-20T23:00:00.000Z"),
      })),
    },
  };
}

function sessionHeaders(extra: HeadersInit = {}): Headers {
  return new Headers({
    cookie: `__Host-qcrm_admin_session=${sessionHandle}`,
    ...Object.fromEntries(new Headers(extra).entries()),
  });
}

describe("tenant profile BFF boundary", () => {
  it("forwards only validated list filters to the fixed internal route", async () => {
    const upstream = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        schemaVersion: "tenant-profile-list/v1",
        data: [profile],
        meta: { pageSize: 25, nextCursor: null },
      }),
    );
    const response = await handleTenantProfileList(
      new Request(
        "https://admin.example.test/api/platform/tenant-profiles?search=Acme&pageSize=25",
        { headers: sessionHeaders() },
      ),
      runtime(upstream as typeof fetch),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(upstream.mock.calls[0]?.[0].toString()).toBe(
      "http://admin-api:3002/api/v1/tenant-profiles?search=Acme&pageSize=25",
    );
    expect(upstream.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer server-only-access-token",
    });
    expect(body).not.toContain("server-only-access-token");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects unknown, duplicate and invalid list parameters before calling upstream", async () => {
    const upstream = vi.fn(fetch);
    for (const query of [
      "target=http://attacker.test",
      "pageSize=25&pageSize=50",
      "status=UNKNOWN",
    ]) {
      const response = await handleTenantProfileList(
        new Request(`https://admin.example.test/api/platform/tenant-profiles?${query}`, {
          headers: sessionHeaders(),
        }),
        runtime(upstream),
      );
      expect(response.status).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("requires exact Origin and CSRF before creating a profile", async () => {
    const upstream = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(
        { schemaVersion: "tenant-profile/v1", data: profile },
        { status: 201, headers: { etag: '"1"' } },
      ),
    );
    const body = JSON.stringify({
      name: profile.name,
      slug: profile.slug,
      adminContactName: profile.adminContactName,
      adminContactEmail: profile.adminContactEmail,
    });
    const rejected = await handleTenantProfileCreate(
      new Request("https://admin.example.test/api/platform/tenant-profiles", {
        method: "POST",
        headers: sessionHeaders({
          "content-type": "application/json",
          origin: "https://attacker.test",
          "x-csrf-token": csrfToken,
        }),
        body,
      }),
      runtime(upstream as typeof fetch),
    );
    expect(rejected.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();

    const accepted = await handleTenantProfileCreate(
      new Request("https://admin.example.test/api/platform/tenant-profiles", {
        method: "POST",
        headers: sessionHeaders({
          "content-type": "application/json",
          origin: config.origin,
          "x-csrf-token": csrfToken,
        }),
        body,
      }),
      runtime(upstream as typeof fetch),
    );
    expect(accepted.status).toBe(201);
    expect(accepted.headers.get("etag")).toBe('"1"');
    expect(upstream.mock.calls[0]?.[0].toString()).toBe(
      "http://admin-api:3002/api/v1/tenant-profiles",
    );
  });

  it("forwards optimistic concurrency and bounds upstream errors", async () => {
    const conflict = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 412 }),
    );
    const response = await handleTenantProfileUpdate(
      new Request(`https://admin.example.test/api/platform/tenant-profiles/${profileId}`, {
        method: "PATCH",
        headers: sessionHeaders({
          "content-type": "application/json",
          origin: config.origin,
          "x-csrf-token": csrfToken,
          "if-match": '"1"',
        }),
        body: JSON.stringify({ name: "Acme Actualizada" }),
      }),
      runtime(conflict as typeof fetch),
      profileId,
    );

    expect(response.status).toBe(412);
    expect(conflict.mock.calls[0]?.[1]?.headers).toMatchObject({ "if-match": '"1"' });
    expect(await response.text()).not.toContain("server-only-access-token");
  });

  it("requires CSRF, a current ETag and an exact confirmation before deleting a draft", async () => {
    const upstream = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }),
    );
    const request = new Request(
      `https://admin.example.test/api/platform/tenant-profiles/${profileId}`,
      {
        method: "DELETE",
        headers: sessionHeaders({
          "content-type": "application/json",
          origin: config.origin,
          "x-csrf-token": csrfToken,
          "if-match": '"1"',
        }),
        body: JSON.stringify({ confirmationSlug: "acme-colombia" }),
      },
    );
    const response = await handlePendingTenantProfileDeletion(
      request,
      runtime(upstream as typeof fetch),
      profileId,
    );
    expect(response.status).toBe(204);
    expect(upstream.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("fails closed on malformed successful responses", async () => {
    const malformed = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ unexpected: true }),
    );
    const response = await handleTenantProfileList(
      new Request("https://admin.example.test/api/platform/tenant-profiles", {
        headers: sessionHeaders(),
      }),
      runtime(malformed as typeof fetch),
    );

    expect(response.status).toBe(503);
  });

  it("requests provisioning with CSRF, current profile version and idempotency", async () => {
    const serverId = "01995f7e-7b52-7000-8000-000000000201";
    const releaseId = "01995f7e-7b52-7000-8000-000000000301";
    const upstream = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(
        {
          schemaVersion: "tenant-provisioning-operation/v1",
          data: {
            id: "01995f7e-7b52-7000-8000-000000000401",
            tenantProfileId: profileId,
            serverId,
            releaseId,
            requestedCapacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10240 },
            capacityReservation: { id: "01995f7e-7b52-7000-8000-000000000501" },
            status: "PENDING",
            currentStep: "VALIDATE",
            attempt: 0,
            version: "1",
            failureCode: null,
            createdAt: "2026-09-20T15:00:00.000Z",
            updatedAt: "2026-09-20T15:00:00.000Z",
          },
          meta: { idempotentReplay: false },
        },
        { status: 202, headers: { "x-tenant-profile-etag": '"2"' } },
      ),
    );
    const response = await handleTenantProvisioningRequest(
      new Request(
        `https://admin.example.test/api/platform/tenant-profiles/${profileId}/provisioning-operations`,
        {
          method: "POST",
          headers: sessionHeaders({
            "content-type": "application/json",
            origin: config.origin,
            "x-csrf-token": csrfToken,
            "if-match": '"1"',
            "idempotency-key": "provision-01995f7e",
          }),
          body: JSON.stringify({
            serverId,
            releaseId,
            requestedCapacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10240 },
          }),
        },
      ),
      runtime(upstream as typeof fetch),
      profileId,
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("x-tenant-profile-etag")).toBe('"2"');
    expect(upstream.mock.calls[0]?.[0].toString()).toBe(
      `http://admin-api:3002/api/v1/tenant-profiles/${profileId}/provisioning-operations`,
    );
    expect(upstream.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(upstream.mock.calls[0]?.[1]?.headers).toMatchObject({
      "if-match": '"1"',
      "idempotency-key": "provision-01995f7e",
    });
  });

  it("requests automatic provisioning without accepting operator placement", async () => {
    const upstream = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(
        {
          schemaVersion: "tenant-provisioning-operation/v1",
          data: {
            id: "01995f7e-7b52-7000-8000-000000000401",
            tenantProfileId: profileId,
            serverId: "01995f7e-7b52-7000-8000-000000000201",
            releaseId: "01995f7e-7b52-7000-8000-000000000301",
            requestedCapacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10240 },
            capacityReservation: { id: "01995f7e-7b52-7000-8000-000000000501" },
            status: "PENDING",
            currentStep: "VALIDATE",
            attempt: 0,
            version: "1",
            failureCode: null,
            createdAt: "2026-09-20T15:00:00.000Z",
            updatedAt: "2026-09-20T15:00:00.000Z",
          },
          meta: { idempotentReplay: false },
        },
        { status: 202, headers: { "x-tenant-profile-etag": '"2"' } },
      ),
    );
    const response = await handleAutomaticTenantProvisioningRequest(
      new Request(
        `https://admin.example.test/api/platform/tenant-profiles/${profileId}/provisioning-operations/automatic`,
        {
          method: "POST",
          headers: sessionHeaders({
            "content-type": "application/json",
            origin: config.origin,
            "x-csrf-token": csrfToken,
            "if-match": '"1"',
            "idempotency-key": "auto-provision-01995f7e",
          }),
          body: "{}",
        },
      ),
      runtime(upstream as typeof fetch),
      profileId,
    );

    expect(response.status).toBe(202);
    expect(upstream.mock.calls[0]?.[0].toString()).toBe(
      `http://admin-api:3002/api/v1/tenant-profiles/${profileId}/provisioning-operations/automatic`,
    );
    expect(upstream.mock.calls[0]?.[1]?.body).toBe("{}");
  });

  it("rejects provisioning without the exact CSRF token before calling upstream", async () => {
    const upstream = vi.fn(fetch);
    const response = await handleTenantProvisioningRequest(
      new Request(
        `https://admin.example.test/api/platform/tenant-profiles/${profileId}/provisioning-operations`,
        {
          method: "POST",
          headers: sessionHeaders({
            "content-type": "application/json",
            origin: config.origin,
            "x-csrf-token": "invalid-token",
            "if-match": '"1"',
            "idempotency-key": "provision-01995f7e",
          }),
          body: JSON.stringify({
            serverId: "01995f7e-7b52-7000-8000-000000000201",
            releaseId: "01995f7e-7b52-7000-8000-000000000301",
            requestedCapacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10240 },
          }),
        },
      ),
      runtime(upstream),
      profileId,
    );

    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
});
