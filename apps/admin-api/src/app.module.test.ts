import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { PlatformPostgresDatabase } from "@quantum-crm/database";
import { hydrateTenantProfile } from "@quantum-crm/platform-domain";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AppModule } from "./app.module.js";

let application: INestApplication;
let origin: string;

beforeAll(async () => {
  const tenantProfile = hydrateTenantProfile({
    id: "01995f7e-7b52-7000-8000-000000000201",
    name: "Acme",
    slug: "acme",
    adminContactName: "Ana",
    adminContactEmail: "admin@acme.test",
    status: "ACTIVE",
    version: 1n,
    createdAt: new Date("2026-09-20T12:00:00.000Z"),
    updatedAt: new Date("2026-09-20T12:00:00.000Z"),
  });
  const database: PlatformPostgresDatabase = {
    connect: vi.fn(async () => undefined),
    isReady: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
    onApplicationShutdown: vi.fn(async () => undefined),
    memberships: {
      findByOidcSubject: vi.fn(async () => ({
        id: "01995f7e-7b52-7000-8000-000000000101",
        oidcSubject: "operator-subject",
        status: "ACTIVE",
        permissions: ["tenants:manage", "tenants:read"],
        authorizationRevision: 1n,
      })),
    },
    tenantProfiles: {
      create: vi.fn(async () => tenantProfile),
      findById: vi.fn(async () => tenantProfile),
      list: vi.fn(async () => ({ items: [tenantProfile], nextCursor: null })),
      update: vi.fn(async (_id, expectedVersion) =>
        expectedVersion === 1n
          ? hydrateTenantProfile({ ...tenantProfile, name: "Acme Updated", version: 2n })
          : null,
      ),
    },
  };
  application = await NestFactory.create(
    AppModule.register(
      database,
      {
        verifyAccessToken: vi.fn(async () => ({
          verification: "oidc-access-token/v1",
          subject: "operator-subject",
          issuer: "https://identity.example.test/realms/quantum-platform",
          audiences: ["quantum-admin-api"],
          principalType: "human",
          multiFactorAuthenticated: true,
          authenticatedAt: new Date(Date.now() - 1_000),
        })),
      },
      {
        issuer: "https://identity.example.test/realms/quantum-platform",
        audience: "quantum-admin-api",
        allowedPermissions: ["tenants:read", "tenants:manage"],
      },
    ),
    { abortOnError: false, logger: false },
  );
  await application.listen(0, "127.0.0.1");
  const address = application.getHttpServer().address() as { readonly port: number };
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => application.close());

describe("admin API authentication boundary", () => {
  it("keeps health public while protecting platform routes by default", async () => {
    expect((await fetch(`${origin}/health/live`)).status).toBe(200);
    const denied = await fetch(`${origin}/api/v1/operators/me`);
    expect(denied.status).toBe(401);
    expect(denied.headers.get("content-type")).toContain("application/problem+json");
    await expect(denied.json()).resolves.toEqual({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
    });
  });

  it("returns bounded operator identity for a verified active membership", async () => {
    const response = await fetch(`${origin}/api/v1/operators/me`, {
      headers: { authorization: "Bearer signed.token.value" },
    });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("01995f7e-7b52-7000-8000-000000000101");
    expect(body).not.toContain("signed.token.value");
    expect(body).not.toContain("operator-subject");
  });

  it("validates, lists and conditionally updates protected tenant profiles", async () => {
    const authorization = { authorization: "Bearer signed.token.value" };
    const listed = await fetch(`${origin}/api/v1/tenant-profiles?status=ACTIVE&pageSize=10`, {
      headers: authorization,
    });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      schemaVersion: "tenant-profile-list/v1",
      data: [{ slug: "acme", status: "ACTIVE" }],
      meta: { pageSize: 10, nextCursor: null },
    });

    const fetched = await fetch(
      `${origin}/api/v1/tenant-profiles/01995f7e-7b52-7000-8000-000000000201`,
      { headers: authorization },
    );
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("etag")).toBe('"1"');

    const missingPrecondition = await fetch(
      `${origin}/api/v1/tenant-profiles/01995f7e-7b52-7000-8000-000000000201`,
      {
        method: "PATCH",
        headers: { ...authorization, "content-type": "application/json" },
        body: JSON.stringify({ name: "Acme Updated" }),
      },
    );
    expect(missingPrecondition.status).toBe(428);

    const updated = await fetch(
      `${origin}/api/v1/tenant-profiles/01995f7e-7b52-7000-8000-000000000201`,
      {
        method: "PATCH",
        headers: {
          ...authorization,
          "content-type": "application/json",
          "if-match": '"1"',
        },
        body: JSON.stringify({ name: "Acme Updated" }),
      },
    );
    expect(updated.status).toBe(200);
    expect(updated.headers.get("etag")).toBe('"2"');

    const stale = await fetch(
      `${origin}/api/v1/tenant-profiles/01995f7e-7b52-7000-8000-000000000201`,
      {
        method: "PATCH",
        headers: {
          ...authorization,
          "content-type": "application/json",
          "if-match": '"2"',
        },
        body: JSON.stringify({ name: "Stale" }),
      },
    );
    expect(stale.status).toBe(412);

    const invalid = await fetch(`${origin}/api/v1/tenant-profiles`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ slug: "invalid" }),
    });
    expect(invalid.status).toBe(400);
  });
});
