import { describe, expect, it } from "vitest";

import type { OidcAccessTokenVerifier } from "@quantum-crm/auth";

import { BootstrapServiceGuard } from "./bootstrap-service-security.js";

const policy = { clientId: "quantum-crm-bootstrap" as const, audience: "quantum-crm-api" as const };

describe("BootstrapServiceGuard", () => {
  it("accepts only the tenant bootstrap service identity", async () => {
    const verifier: OidcAccessTokenVerifier = { verifyAccessToken: async () => ({ verification: "oidc-access-token/v1", subject: "service-account-quantum-crm-bootstrap", issuer: "https://identity.example.test/realms/qcrm-01995f7e7b5270008000000000000201", audiences: ["quantum-crm-api"], principalType: "service", clientId: "quantum-crm-bootstrap", servicePermissions: ["iam:bootstrap-initial-administrator"], multiFactorAuthenticated: false, authenticatedAt: new Date() }) };
    await expect(new BootstrapServiceGuard(verifier, policy).assertAuthorized("Bearer synthetic-token")).resolves.toBeUndefined();
  });

  it("rejects a human or insufficient service token", async () => {
    const verifier: OidcAccessTokenVerifier = { verifyAccessToken: async () => ({ verification: "oidc-access-token/v1", subject: "member", issuer: "https://identity.example.test/realms/qcrm-01995f7e7b5270008000000000000201", audiences: ["quantum-crm-api"], principalType: "human", multiFactorAuthenticated: true, authenticatedAt: new Date() }) };
    await expect(new BootstrapServiceGuard(verifier, policy).assertAuthorized("Bearer synthetic-token")).rejects.toMatchObject({ status: 401 });
  });
});
