import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { PlatformPostgresDatabase } from "@quantum-crm/database";
import {
  hydrateInfrastructureServer,
  hydratePlatformRelease,
  hydrateProvisioningOperation,
  platformReleaseArtifactNames,
  hydrateTenantProfile,
} from "@quantum-crm/platform-domain";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AppModule } from "./app.module.js";

let application: INestApplication;
let origin: string;
let platformRelease: ReturnType<typeof hydratePlatformRelease>;

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
    requestedCapacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10240 },
    status: "PENDING",
    currentStep: "VALIDATE",
    attempt: 0,
    version: 1n,
    lease: null,
    createdAt: new Date("2026-09-20T12:00:00.000Z"),
    updatedAt: new Date("2026-09-20T12:00:00.000Z"),
    capacityReservation: {
      id: "01995f7e-7b52-7000-8000-000000000501",
      capacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10240 },
    },
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
  platformRelease = hydratePlatformRelease({
    id: "01995f7e-7b52-7000-8000-000000000302",
    semanticVersion: "1.0.0-candidate.1",
    commitSha: "a".repeat(40),
    releaseNotes: "Release candidata.",
    compatibility: {
      configurationSchemaVersion: 1,
      agentContractVersion: "agent/v1",
      databaseMigrationRequired: false,
    },
    artifacts: platformReleaseArtifactNames.map((name, index) => ({
      name,
      digest: `sha256:${index.toString(16).padStart(64, "0")}`,
    })),
    status: "CANDIDATE",
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
    releases: {
      create: vi.fn(async () => platformRelease),
      findById: vi.fn(async () => platformRelease),
      list: vi.fn(async () => [platformRelease]),
      updateStatus: vi.fn(async (_id, expectedVersion) =>
        expectedVersion === 1n
          ? hydratePlatformRelease({
              ...platformRelease,
              status: "VALIDATED",
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
      completeValidation: vi.fn(async () => null),
      completeDatabase: vi.fn(async () => null),
      completeSecrets: vi.fn(async () => null),
      completeStorage: vi.fn(async () => null),
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

  it("registers, lists and validates an immutable release", async () => {
    const authorization = { authorization: "Bearer signed.token.value" };
    const listed = await fetch(`${origin}/api/v1/releases?status=CANDIDATE&pageSize=10`, {
      headers: authorization,
    });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      schemaVersion: "platform-release-list/v1",
      data: [{ semanticVersion: "1.0.0-candidate.1", status: "CANDIDATE" }],
    });

    const created = await fetch(`${origin}/api/v1/releases`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({
        id: platformRelease.id,
        semanticVersion: platformRelease.semanticVersion,
        commitSha: platformRelease.commitSha,
        releaseNotes: platformRelease.releaseNotes,
        compatibility: platformRelease.compatibility,
        artifacts: platformRelease.artifacts,
      }),
    });
    expect(created.status).toBe(201);
    expect(created.headers.get("etag")).toBe('"1"');

    const validated = await fetch(`${origin}/api/v1/releases/${platformRelease.id}/status`, {
      method: "PATCH",
      headers: {
        ...authorization,
        "content-type": "application/json",
        "if-match": '"1"',
      },
      body: JSON.stringify({ status: "VALIDATED" }),
    });
    expect(validated.status).toBe(200);
    expect(validated.headers.get("etag")).toBe('"2"');
    await expect(validated.json()).resolves.toMatchObject({
      data: { status: "VALIDATED" },
    });
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
          requestedCapacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10240 },
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
