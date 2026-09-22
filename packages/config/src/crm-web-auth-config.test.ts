import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseCrmWebAuthConfig } from "./crm-web-auth-config.js";
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
  QCRM_TENANT_ID: "01995f7e-7b52-7000-8000-000000000101",
  QCRM_CRM_WEB_ORIGIN: "https://crm.example.test",
  QCRM_CRM_API_ORIGIN: "http://api:3001",
  QCRM_OIDC_ISSUER: "https://identity.example.test/realms/acme-colombia",
  QCRM_OIDC_CLIENT_ID: "quantum-crm-web",
  QCRM_OIDC_CLIENT_SECRET_FILE: clientSecretPath,
  QCRM_SESSION_REDIS_URL_FILE: redisSecretPath,
};

describe("CRM web authentication configuration", () => {
  it("derives the callback and session namespace from server configuration", () => {
    const config = parseCrmWebAuthConfig(valid, fileSystem);

    expect(config).toMatchObject({
      origin: "https://crm.example.test",
      crmApiOrigin: "http://api:3001",
      callbackUrl: "https://crm.example.test/api/auth/callback/keycloak",
      sessionNamespace: "crm:01995f7e-7b52-7000-8000-000000000101",
      secureCookies: true,
    });
    expect(JSON.stringify(config)).not.toContain("synthetic-client-secret");
  });

  it.each([
    ["missing tenant", { QCRM_TENANT_ID: undefined }, "QCRM_TENANT_ID"],
    ["invalid CRM origin", { QCRM_CRM_WEB_ORIGIN: "https://crm.example.test/path" }, "QCRM_CRM_WEB_ORIGIN"],
    ["missing CRM API", { QCRM_CRM_API_ORIGIN: undefined }, "QCRM_CRM_API_ORIGIN"],
    ["missing client secret", { QCRM_OIDC_CLIENT_SECRET_FILE: undefined }, "QCRM_OIDC_CLIENT_SECRET_FILE"],
    ["missing Redis secret", { QCRM_SESSION_REDIS_URL_FILE: undefined }, "QCRM_SESSION_REDIS_URL_FILE"],
  ])("rejects %s", (_case, override, key) => {
    expect(() => parseCrmWebAuthConfig({ ...valid, ...override }, fileSystem)).toThrow(
      new ConfigurationError("crm-web", [key]),
    );
  });
});
