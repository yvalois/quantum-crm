import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { PlatformPostgresDatabase } from "@quantum-crm/database";
import {
  hydrateInfrastructureServer,
  hydrateProvisioningOperation,
  hydrateTenantProfile,
} from "@quantum-crm/platform-domain";
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
  const provisioningOperation = hydrateProvisioningOperation({
    id: "01995f7e-7b52-7000-8000-000000000401",
    tenantProfileId: tenantProfile.id,
    serverId: "01995f7e-7b52-7000-8000-000000000301",
    releaseId: "01995f7e-7b52-7000-8000-000000000302",
    requestedByOperatorId: "01995f7e-7b52-7000-8000-000000000101",
    idempotencyKey: "provision-acme-001",
    correlationId: "request-001",
    status: "PENDING",
    currentStep: "VALIDATE",
    attempt: 0,
    version: 1n,
    lease: null,
    createdAt: new Date("2026-09-20T12:00:00.000Z"),
    updatedAt: new Date("2026-09-20T12:00:00.000Z"),
  });
  const infrastructureServer = hydrateInfrastructureServer({
    id: "01995f7e-7b52-7000-8000-000000000301",
    code: "staging-primary",
    displayName: "Staging primary",
    provider: "Hostinger",
    region: "unknown",
    publicIpv4: "192.0.2.10",
    operatingSystem: "Ubuntu 24.04 LTS",
    architecture: "X86_64",
    status: "AVAILABLE",
    totalCapacity: { cpuMillicores: 4000, memoryMiB: 8192, storageMiB: 102400 },
    reservedCapacity: { cpuMillicores: 1000, memoryMiB: 2048, storageMiB: 20480 },
    operationCredentialRef: "secret://staging/servers/primary/ssh-key",
    confirmedAt: new Date("2026-09-20T12:00:00.000Z"),
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
        permissions: ["deployments:execute", "deployments:read", "tenants:manage", "tenants:read"],
        authorizationRevision: 1n,
      })),
    },
    infrastructureServers: {
      create: vi.fn(async () => infrastructureServer),
      findById: vi.fn(async () => infrastructureServer),
      list: vi.fn(async () => [infrastructureServer]),
      update: vi.fn(async (_id, expectedVersion) =>
        expectedVersion === 1n
          ? hydrateInfrastructureServer({
              ...infrastructureServer,
              status: "DRAINING",
              version: 2n,
            })
          : null,
      ),
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
    provisioningOperations: {
      request: vi.fn(async () => ({
        operation: provisioningOperation,
        tenantVersion: 2n,
        idempotentReplay: false,
      })),
      claimNext: vi.fn(async () => null),
      renewLease: vi.fn(async () => null),
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
        allowedPermissions: [
          "deployments:execute",
          "deployments:read",
          "tenants:read",
          "tenants:manage",
        ],
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

  it("lists infrastructure capacity without exposing the credential reference", async () => {
    const authorization = { authorization: "Bearer signed.token.value" };
    const response = await fetch(`${origin}/api/v1/infrastructure-servers?pageSize=10`, {
      headers: authorization,
    });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('"availableCapacity":{"cpuMillicores":3000');
    expect(body).toContain('"credentialConfigured":true');
    expect(body).not.toContain("secret://");
    expect(body).not.toContain("ssh-key");

    const created = await fetch(`${origin}/api/v1/infrastructure-servers`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({
        code: "staging-primary",
        displayName: "Staging primary",
        provider: "Hostinger",
        region: "unknown",
        publicIpv4: "192.0.2.10",
        operatingSystem: "Ubuntu 24.04 LTS",
        architecture: "X86_64",
        status: "AVAILABLE",
        totalCapacity: { cpuMillicores: 4000, memoryMiB: 8192, storageMiB: 102400 },
        reservedCapacity: { cpuMillicores: 1000, memoryMiB: 2048, storageMiB: 20480 },
        operationCredentialRef: "secret://staging/servers/primary/ssh-key",
        confirmedAt: "2026-09-20T12:00:00.000Z",
      }),
    });
    const createdBody = await created.text();
    expect(created.status).toBe(201);
    expect(created.headers.get("etag")).toBe('"1"');
    expect(created.headers.get("location")).toContain("01995f7e-7b52-7000-8000-000000000301");
    expect(createdBody).toContain('"credentialConfigured":true');
    expect(createdBody).not.toContain("secret://");
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

  it("accepts a typed idempotent provisioning request", async () => {
    const response = await fetch(
      `${origin}/api/v1/tenant-profiles/01995f7e-7b52-7000-8000-000000000201/provisioning-operations`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer signed.token.value",
          "content-type": "application/json",
          "idempotency-key": "provision-acme-001",
          "if-match": '"1"',
        },
        body: JSON.stringify({
          serverId: "01995f7e-7b52-7000-8000-000000000301",
          releaseId: "01995f7e-7b52-7000-8000-000000000302",
        }),
      },
    );
    expect(response.status).toBe(202);
    expect(response.headers.get("x-tenant-profile-etag")).toBe('"2"');
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: "tenant-provisioning-operation/v1",
      data: { status: "PENDING", currentStep: "VALIDATE" },
      meta: { idempotentReplay: false },
    });
  });
});
