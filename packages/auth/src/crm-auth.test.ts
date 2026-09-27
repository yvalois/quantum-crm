import { SecretValue } from "@quantum-crm/config";
import { describe, expect, it } from "vitest";

import { authenticateCrmMember, CrmAuthenticationError, requireCrmPermission } from "./crm-auth.js";

const tenantId = "01995f7e-7b52-7000-8000-000000000201";
const memberId = "01995f7e-7b52-7000-8000-000000000202";
const now = new Date("2026-09-22T12:00:00.000Z");

describe("CRM authentication", () => {
  it("accepts only an active member in the current realm and permission catalog", async () => {
    const context = await authenticateCrmMember({
      accessToken: new SecretValue("synthetic-token"),
      verifier: {
        verifyAccessToken: async () => ({
          verification: "oidc-access-token/v1",
          subject: "crm-member",
          issuer: "https://identity.example.test/realms/profile-a",
          audiences: ["quantum-crm-web"],
          principalType: "human",
          multiFactorAuthenticated: true,
          authenticatedAt: now,
        }),
      },
      memberships: {
        findAuthorizationByOidcSubject: async () => ({
          id: memberId,
          oidcSubject: "crm-member",
          status: "ACTIVE",
          permissions: ["iam:members:read", "crm:contacts:read"],
          authorizationRevision: 2n,
        }),
      },
      policy: {
        tenantId,
        issuer: "https://identity.example.test/realms/profile-a",
        audience: "quantum-crm-web",
        allowedPermissions: ["iam:members:read", "crm:contacts:read"],
      },
      correlationId: "corr-usr-01",
      now,
    });

    expect(context.tenantId).toBe(tenantId);
    expect(() => requireCrmPermission(context, "crm:contacts:read")).not.toThrow();
    expect(() => requireCrmPermission(context, "iam:members:create")).toThrow();
  });

  it("rejects a deactivated membership even when OIDC authentication is valid", async () => {
    await expect(
      authenticateCrmMember({
        accessToken: new SecretValue("synthetic-token"),
        verifier: {
          verifyAccessToken: async () => ({
            verification: "oidc-access-token/v1",
            subject: "crm-member",
            issuer: "https://identity.example.test/realms/profile-a",
            audiences: ["quantum-crm-web"],
            principalType: "human",
            multiFactorAuthenticated: true,
            authenticatedAt: now,
          }),
        },
        memberships: {
          findAuthorizationByOidcSubject: async () => ({
            id: memberId,
            oidcSubject: "crm-member",
            status: "DEACTIVATED",
            permissions: ["iam:members:read"],
            authorizationRevision: 3n,
          }),
        },
        policy: {
          tenantId,
          issuer: "https://identity.example.test/realms/profile-a",
          audience: "quantum-crm-web",
          allowedPermissions: ["iam:members:read"],
        },
        correlationId: "corr-usr-01",
        now,
      }),
    ).rejects.toEqual(new CrmAuthenticationError("MEMBERSHIP_REJECTED"));
  });

  it.each(["PROFILE", "TEAM", "ASSIGNED"] as const)(
    "preserves the server-resolved %s commercial scope",
    async (commercialScope) => {
      const context = await authenticateCrmMember({
        accessToken: new SecretValue("synthetic-token"),
        verifier: {
          verifyAccessToken: async () => ({
            verification: "oidc-access-token/v1",
            subject: "crm-member",
            issuer: "https://identity.example.test/realms/profile-a",
            audiences: ["quantum-crm-web"],
            principalType: "human",
            multiFactorAuthenticated: true,
            authenticatedAt: now,
          }),
        },
        memberships: {
          findAuthorizationByOidcSubject: async () => ({
            id: memberId,
            oidcSubject: "crm-member",
            status: "ACTIVE",
            permissions: ["crm:contacts:read"],
            authorizationRevision: 2n,
            commercialScope,
          }),
        },
        policy: {
          tenantId,
          issuer: "https://identity.example.test/realms/profile-a",
          audience: "quantum-crm-web",
          allowedPermissions: ["crm:contacts:read"],
        },
        correlationId: "corr-usr-06",
        now,
      });
      expect(context.commercialScope).toBe(commercialScope);
    },
  );

  it("narrows the legacy OWN scope to ASSIGNED", async () => {
    const context = await authenticateCrmMember({
      accessToken: new SecretValue("synthetic-token"),
      verifier: {
        verifyAccessToken: async () => ({
          verification: "oidc-access-token/v1",
          subject: "crm-member",
          issuer: "https://identity.example.test/realms/profile-a",
          audiences: ["quantum-crm-web"],
          principalType: "human",
          multiFactorAuthenticated: true,
          authenticatedAt: now,
        }),
      },
      memberships: {
        findAuthorizationByOidcSubject: async () => ({
          id: memberId,
          oidcSubject: "crm-member",
          status: "ACTIVE",
          permissions: ["crm:contacts:read"],
          authorizationRevision: 2n,
          commercialScope: "OWN",
        }),
      },
      policy: {
        tenantId,
        issuer: "https://identity.example.test/realms/profile-a",
        audience: "quantum-crm-web",
        allowedPermissions: ["crm:contacts:read"],
      },
      correlationId: "corr-usr-06-legacy",
      now,
    });
    expect(context.commercialScope).toBe("ASSIGNED");
  });
});
