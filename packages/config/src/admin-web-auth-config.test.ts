import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseAdminWebAuthConfig } from "./admin-web-auth-config.js";
import { ConfigurationError } from "./configuration-error.js";
import type { SecretFileSystem } from "./secret-value.js";

const clientSecretPath = resolve(".test-secrets/qcrm_oidc_client_secret");
const redisSecretPath = resolve(".test-secrets/qcrm_session_redis_url");
const values = new Map([
  [clientSecretPath, "synthetic-client-secret"],
  [redisSecretPath, "redis://session-user:synthetic@redis:6379/1"],
]);
const fileSystem: SecretFileSystem = {
  lstat: (path) => ({
    size: new TextEncoder().encode(values.get(path) ?? "").byteLength,
    isFile: () => values.has(path),
    isSymbolicLink: () => false,
  }),
  readFile: (path) => new TextEncoder().encode(values.get(path) ?? ""),
  realpath: (path) => path,
};
const valid = {
  QCRM_ENV: "test",
  QCRM_ADMIN_WEB_ORIGIN: "https://admin.example.test",
  QCRM_ADMIN_API_ORIGIN: "http://admin-api:3002",
  QCRM_OIDC_ISSUER: "https://identity.example.test/realms/quantum-platform",
  QCRM_OIDC_CLIENT_ID: "quantum-admin-web",
  QCRM_OIDC_CLIENT_SECRET_FILE: clientSecretPath,
  QCRM_SESSION_REDIS_URL_FILE: redisSecretPath,
};

describe("admin web authentication configuration", () => {
  it("loads secrets once and derives fixed callback URLs", () => {
    const config = parseAdminWebAuthConfig(valid, fileSystem);

    expect(config).toMatchObject({
      origin: "https://admin.example.test",
      adminApiOrigin: "http://admin-api:3002",
      issuer: "https://identity.example.test/realms/quantum-platform",
      callbackUrl: "https://admin.example.test/api/auth/callback/keycloak",
      signedOutUrl: "https://admin.example.test/signed-out",
      requiredAcr: "2",
      secureCookies: true,
    });
    expect(config.clientSecret.expose()).toBe("synthetic-client-secret");
    expect(config.redisUrl.expose()).toContain("redis://");
    expect(JSON.stringify(config)).not.toContain("synthetic-client-secret");
  });

  it.each([
    [
      "HTTP origin",
      { QCRM_ENV: "production", QCRM_ADMIN_WEB_ORIGIN: "http://admin.example.test" },
      "QCRM_ADMIN_WEB_ORIGIN",
    ],
    [
      "origin path",
      { QCRM_ADMIN_WEB_ORIGIN: "https://admin.example.test/path" },
      "QCRM_ADMIN_WEB_ORIGIN",
    ],
    [
      "wrong issuer",
      { QCRM_OIDC_ISSUER: "https://identity.example.test/customer" },
      "QCRM_OIDC_ISSUER",
    ],
    ["missing admin API", { QCRM_ADMIN_API_ORIGIN: undefined }, "QCRM_ADMIN_API_ORIGIN"],
    [
      "admin API path",
      { QCRM_ADMIN_API_ORIGIN: "http://admin-api:3002/internal" },
      "QCRM_ADMIN_API_ORIGIN",
    ],
    ["client id", { QCRM_OIDC_CLIENT_ID: "bad client" }, "QCRM_OIDC_CLIENT_ID"],
    [
      "missing client secret",
      { QCRM_OIDC_CLIENT_SECRET_FILE: undefined },
      "QCRM_OIDC_CLIENT_SECRET_FILE",
    ],
    [
      "missing Redis secret",
      { QCRM_SESSION_REDIS_URL_FILE: undefined },
      "QCRM_SESSION_REDIS_URL_FILE",
    ],
  ])("rejects %s", (_case, override, key) => {
    expect(() => parseAdminWebAuthConfig({ ...valid, ...override }, fileSystem)).toThrow(
      new ConfigurationError("admin-web", [key]),
    );
  });

  it("permits HTTP only for disposable local environments", () => {
    expect(
      parseAdminWebAuthConfig(
        {
          ...valid,
          QCRM_ENV: "test",
          QCRM_ADMIN_WEB_ORIGIN: "http://admin-web.example.test",
          QCRM_OIDC_ISSUER: "http://keycloak:8080/realms/quantum-platform",
        },
        fileSystem,
      ).secureCookies,
    ).toBe(false);
  });
});
