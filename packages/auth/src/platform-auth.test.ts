import { SecretValue } from "@quantum-crm/config";
import { describe, expect, it } from "vitest";

import {
  authenticatePlatformOperator,
  PlatformAuthenticationError,
  PlatformAuthorizationError,
  requirePlatformPermission,
  type OidcAccessTokenVerifier,
  type PlatformMembershipReader,
  type VerifiedOidcIdentity,
} from "./platform-auth.js";

const operatorId = "01995f7e-7b52-7000-8000-000000000101";
const subject = "keycloak-platform-operator";
const policy = {
  issuer: "https://identity.example.test/realms/quantum-platform",
  audience: "quantum-admin-api",
} as const;
const accessToken = new SecretValue("synthetic-access-token");

function identity(override: Partial<VerifiedOidcIdentity> = {}): VerifiedOidcIdentity {
  return {
    verification: "oidc-access-token/v1",
    subject,
    issuer: policy.issuer,
    audiences: [policy.audience],
    principalType: "human",
    multiFactorAuthenticated: true,
    authenticatedAt: new Date("2026-09-20T12:00:00.000Z"),
    ...override,
  };
}

function dependencies(
  input: {
    readonly identity?: VerifiedOidcIdentity;
    readonly verifierError?: Error;
    readonly membership?: Awaited<ReturnType<PlatformMembershipReader["findByOidcSubject"]>>;
  } = {},
): {
  verifier: OidcAccessTokenVerifier;
  memberships: PlatformMembershipReader;
} {
  return {
    verifier: {
      verifyAccessToken: async () => {
        if (input.verifierError) {
          throw input.verifierError;
        }

        return input.identity ?? identity();
      },
    },
    memberships: {
      findByOidcSubject: async () =>
        input.membership === undefined
          ? {
              id: operatorId,
              oidcSubject: subject,
              status: "ACTIVE",
              permissions: ["tenants:read", "deployments:execute"],
              authorizationRevision: 2n,
            }
          : input.membership,
    },
  };
}

async function authenticate(deps = dependencies()) {
  return authenticatePlatformOperator({
    accessToken,
    ...deps,
    policy,
    correlationId: "correlation-adm-01",
    now: new Date("2026-09-20T12:01:00.000Z"),
  });
}

describe("platform authentication", () => {
  it("creates an immutable context without retaining the token", async () => {
    const context = await authenticate();

    expect(context).toEqual({
      schemaVersion: "platform-auth-context/v1",
      boundary: "platform",
      principal: { type: "human", id: operatorId, oidcSubject: subject },
      permissions: ["deployments:execute", "tenants:read"],
      authorizationRevision: 2n,
      authenticatedAt: "2026-09-20T12:00:00.000Z",
      correlationId: "correlation-adm-01",
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(
      JSON.stringify(context, (_, value) => (typeof value === "bigint" ? String(value) : value)),
    ).not.toContain("synthetic-access-token");
  });

  it.each([
    ["issuer", identity({ issuer: "https://identity.example.test/realms/customer" })],
    ["audience", identity({ audiences: ["customer-crm-api"] })],
    ["principal type", identity({ principalType: "service" })],
    ["future authentication", identity({ authenticatedAt: new Date("2026-09-20T12:02:01Z") })],
  ])("rejects an invalid platform %s", async (_case, invalidIdentity) => {
    await expect(authenticate(dependencies({ identity: invalidIdentity }))).rejects.toEqual(
      new PlatformAuthenticationError("IDENTITY_REJECTED"),
    );
  });

  it("normalizes verifier failures without exposing their details", async () => {
    const secretMessage = "provider-returned-sensitive-token";
    await expect(
      authenticate(dependencies({ verifierError: new Error(secretMessage) })),
    ).rejects.toEqual(new PlatformAuthenticationError("IDENTITY_REJECTED"));

    try {
      await authenticate(dependencies({ verifierError: new Error(secretMessage) }));
    } catch (error) {
      expect(String(error)).not.toContain(secretMessage);
    }
  });

  it("rejects malformed output from the verification boundary", async () => {
    await expect(
      authenticate(
        dependencies({
          identity: {
            ...identity(),
            audiences: undefined,
          } as unknown as VerifiedOidcIdentity,
        }),
      ),
    ).rejects.toEqual(new PlatformAuthenticationError("IDENTITY_REJECTED"));
  });

  it("requires MFA for every platform operator", async () => {
    await expect(
      authenticate(dependencies({ identity: identity({ multiFactorAuthenticated: false }) })),
    ).rejects.toEqual(new PlatformAuthenticationError("MFA_REQUIRED"));
  });

  it.each(["PENDING", "SUSPENDED"] as const)("rejects a %s platform membership", async (status) => {
    await expect(
      authenticate(
        dependencies({
          membership: {
            id: operatorId,
            oidcSubject: subject,
            status,
            permissions: ["tenants:read"],
            authorizationRevision: 1n,
          },
        }),
      ),
    ).rejects.toEqual(new PlatformAuthenticationError("MEMBERSHIP_REJECTED"));
  });

  it("rejects an identity without a platform membership", async () => {
    await expect(authenticate(dependencies({ membership: null }))).rejects.toEqual(
      new PlatformAuthenticationError("MEMBERSHIP_REJECTED"),
    );
  });

  it("denies an absent or malformed permission by default", async () => {
    const context = await authenticate();

    expect(() => requirePlatformPermission(context, "tenants:read")).not.toThrow();
    expect(() => requirePlatformPermission(context, "tenants:manage")).toThrow(
      new PlatformAuthorizationError(),
    );
    expect(() => requirePlatformPermission(context, "anything")).toThrow(
      new PlatformAuthorizationError(),
    );
  });
});
