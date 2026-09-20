import { describe, expect, it } from "vitest";

import { ConfigurationError } from "./configuration-error.js";
import { parseOidcConfig, type OidcDefinition } from "./oidc-config.js";

const definition: OidcDefinition = { provider: "keycloak", boundary: "platform" };
const validEnvironment = {
  QCRM_OIDC_ISSUER: "https://identity.example.test/realms/quantum-platform",
  QCRM_OIDC_AUDIENCE: "quantum-admin-api",
  QCRM_OIDC_REQUIRED_ACR: "2",
};

describe("OIDC configuration", () => {
  it("derives a fixed Keycloak JWKS endpoint and safe limits", () => {
    const config = parseOidcConfig("admin-api", definition, "production", validEnvironment);

    expect(config).toEqual({
      schemaVersion: "oidc-config/v1",
      provider: "keycloak",
      boundary: "platform",
      issuer: "https://identity.example.test/realms/quantum-platform",
      audience: "quantum-admin-api",
      jwksUrl:
        "https://identity.example.test/realms/quantum-platform/protocol/openid-connect/certs",
      requiredAcr: "2",
      allowedAlgorithms: ["RS256"],
      maxTokenAgeSeconds: 300,
      clockToleranceSeconds: 5,
      jwksTimeoutMs: 5_000,
      jwksCooldownMs: 30_000,
      jwksCacheMaxAgeMs: 600_000,
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.allowedAlgorithms)).toBe(true);
  });

  it("allows HTTP only for local and test Keycloak", () => {
    expect(
      parseOidcConfig("admin-api", definition, "test", {
        ...validEnvironment,
        QCRM_OIDC_ISSUER: "http://keycloak:8080/realms/quantum-platform",
      }).issuer,
    ).toBe("http://keycloak:8080/realms/quantum-platform");

    expect(() =>
      parseOidcConfig("admin-api", definition, "production", {
        ...validEnvironment,
        QCRM_OIDC_ISSUER: "http://keycloak:8080/realms/quantum-platform",
      }),
    ).toThrow(new ConfigurationError("admin-api", ["QCRM_OIDC_ISSUER"]));
  });

  it.each([
    ["missing issuer", { QCRM_OIDC_ISSUER: undefined }, "QCRM_OIDC_ISSUER"],
    [
      "credentials in issuer",
      { QCRM_OIDC_ISSUER: "https://user:pass@identity.example.test/realms/platform" },
      "QCRM_OIDC_ISSUER",
    ],
    [
      "query in issuer",
      { QCRM_OIDC_ISSUER: "https://identity.example.test/realms/platform?target=elsewhere" },
      "QCRM_OIDC_ISSUER",
    ],
    [
      "non-Keycloak issuer",
      { QCRM_OIDC_ISSUER: "https://identity.example.test/tenant/platform" },
      "QCRM_OIDC_ISSUER",
    ],
    ["invalid audience", { QCRM_OIDC_AUDIENCE: "bad audience" }, "QCRM_OIDC_AUDIENCE"],
    ["invalid ACR", { QCRM_OIDC_REQUIRED_ACR: " " }, "QCRM_OIDC_REQUIRED_ACR"],
    [
      "excessive token age",
      { QCRM_OIDC_MAX_TOKEN_AGE_SECONDS: "901" },
      "QCRM_OIDC_MAX_TOKEN_AGE_SECONDS",
    ],
  ])("rejects %s without exposing its value", (_case, override, key) => {
    const environment = { ...validEnvironment, ...override };
    expect(() => parseOidcConfig("admin-api", definition, "production", environment)).toThrow(
      new ConfigurationError("admin-api", [key]),
    );

    try {
      parseOidcConfig("admin-api", definition, "production", environment);
    } catch (error) {
      const value = environment[key as keyof typeof environment];
      if (value?.trim()) {
        expect(String(error)).not.toContain(value);
      }
    }
  });
});
