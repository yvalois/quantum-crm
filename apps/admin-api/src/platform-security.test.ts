import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PlatformAuthContext } from "@quantum-crm/auth";
import { describe, expect, it, vi } from "vitest";

import {
  PLATFORM_AUTH_CONTEXT,
  PlatformAuthenticationGuard,
  PlatformAuthorizationGuard,
} from "./platform-security.js";

function executionContext(request: Record<PropertyKey, unknown>): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const policy = {
  issuer: "https://identity.example.test/realms/quantum-platform",
  audience: "quantum-admin-api",
  allowedPermissions: ["tenants:read"],
};

describe("platform HTTP guards", () => {
  it("authenticates a bearer token and stores only the verified platform context", async () => {
    const request: Record<PropertyKey, unknown> = {
      headers: { authorization: "Bearer signed.token.value", "x-correlation-id": "request-1" },
    };
    const guard = new PlatformAuthenticationGuard(
      new Reflector(),
      {
        verifyAccessToken: vi.fn(async () => ({
          verification: "oidc-access-token/v1",
          subject: "operator-subject",
          issuer: policy.issuer,
          audiences: [policy.audience],
          principalType: "human",
          multiFactorAuthenticated: true,
          authenticatedAt: new Date(Date.now() - 1_000),
        })),
      },
      {
        findByOidcSubject: vi.fn(async () => ({
          id: "01995f7e-7b52-7000-8000-000000000101",
          oidcSubject: "operator-subject",
          status: "ACTIVE",
          permissions: ["tenants:read"],
          authorizationRevision: 3n,
        })),
      },
      policy,
    );

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(true);
    expect((request[PLATFORM_AUTH_CONTEXT] as PlatformAuthContext).principal.id).toBe(
      "01995f7e-7b52-7000-8000-000000000101",
    );
    expect(request[PLATFORM_AUTH_CONTEXT]).not.toHaveProperty("accessToken");
  });

  it("denies missing credentials and absent permissions before the controller", async () => {
    const authentication = new PlatformAuthenticationGuard(
      new Reflector(),
      { verifyAccessToken: vi.fn() },
      { findByOidcSubject: vi.fn() },
      policy,
    );
    await expect(
      authentication.canActivate(executionContext({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const reflector = {
      getAllAndOverride: vi.fn(() => "tenants:read"),
    } as unknown as Reflector;
    const authorization = new PlatformAuthorizationGuard(reflector);
    const request = {
      [PLATFORM_AUTH_CONTEXT]: {
        schemaVersion: "platform-auth-context/v1",
        boundary: "platform",
        principal: {
          type: "human",
          id: "01995f7e-7b52-7000-8000-000000000101",
          oidcSubject: "operator",
        },
        permissions: [],
        authorizationRevision: 1n,
        authenticatedAt: "2026-09-20T15:00:00.000Z",
        correlationId: "request-1",
      },
    };
    expect(() => authorization.canActivate(executionContext(request))).toThrow(ForbiddenException);
  });
});
