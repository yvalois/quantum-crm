import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { PlatformPostgresDatabase } from "@quantum-crm/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AppModule } from "./app.module.js";

let application: INestApplication;
let origin: string;

beforeAll(async () => {
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
        permissions: ["tenants:read"],
        authorizationRevision: 1n,
      })),
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
        allowedPermissions: ["tenants:read"],
      },
    ),
    { logger: false },
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
});
