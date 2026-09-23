import { describe, expect, it } from "vitest";

import { tenantOidcIdentity, TenantOidcIdentityValidationError } from "./tenant-oidc-identity.js";

describe("tenant OIDC identity", () => {
  it("derives isolated, stable names and private references for each profile", () => {
    const first = tenantOidcIdentity("01995f7e-7b52-7000-8000-000000000201");
    const second = tenantOidcIdentity("01995f7e-7b52-7000-8000-000000000202");

    expect(first).toEqual({
      tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
      realmName: "qcrm-01995f7e7b5270008000000000000201",
      crmWebClientId: "quantum-crm-web",
      apiAudience: "quantum-crm-api",
      clientSecretRef: "tenant/01995f7e-7b52-7000-8000-000000000201/oidc-client-secret",
      sessionRedisUrlSecretRef: "tenant/01995f7e-7b52-7000-8000-000000000201/session-redis-url",
    });
    expect(second.realmName).not.toBe(first.realmName);
    expect(second.clientSecretRef).not.toBe(first.clientSecretRef);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("rejects an identifier that cannot be the source of a realm", () => {
    expect(() => tenantOidcIdentity("tenant-controlled-by-request")).toThrow(
      new TenantOidcIdentityValidationError("tenantProfileId"),
    );
  });
});
