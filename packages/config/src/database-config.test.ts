import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { ConfigurationError } from "./configuration-error.js";
import { expectedDatabaseSecretPath } from "./database-config.js";
import { parseServiceConfig } from "./process-config.js";
import {
  loadSecretFile,
  SecretFileError,
  SecretValue,
  type SecretFileSystem,
} from "./secret-value.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const canary = "test-only-canary-value";
const validUrl = `postgresql://runtime:${canary}@postgres:5432/profile_a`;

function fileSystemFor(
  content: string,
  options: {
    readonly symbolicLink?: boolean;
    readonly size?: number;
    readonly realpath?: string;
  } = {},
): SecretFileSystem {
  return {
    lstat: () => ({
      size: options.size ?? new TextEncoder().encode(content).byteLength,
      isFile: () => true,
      isSymbolicLink: () => options.symbolicLink ?? false,
    }),
    readFile: () => new TextEncoder().encode(content),
    realpath: (path) => options.realpath ?? path,
  };
}

function crmEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  return {
    QCRM_ENV: "production",
    QCRM_HOST: "0.0.0.0",
    QCRM_PORT: "3001",
    QCRM_TENANT_ID: tenantId,
    QCRM_DATABASE_URL_FILE: expectedDatabaseSecretPath,
    QCRM_OIDC_ISSUER: "https://identity.example.test/realms/profile-a",
    QCRM_OIDC_AUDIENCE: "quantum-crm-web",
    QCRM_OIDC_REQUIRED_ACR: "1",
    QCRM_IAM_BOOTSTRAP_CLIENT_ID: "quantum-crm-bootstrap",
    ...overrides,
  };
}

describe("database configuration", () => {
  it("loads an immutable CRM binding from the authorized secret file", () => {
    const config = parseServiceConfig("api", crmEnvironment(), fileSystemFor(validUrl));

    expect(config.database).toMatchObject({
      schemaVersion: "database-config/v1",
      target: "crm",
      tenantId,
      poolMax: 5,
      connectionTimeoutMs: 5_000,
      statementTimeoutMs: 15_000,
      lockTimeoutMs: 5_000,
      idleInTransactionTimeoutMs: 10_000,
    });
    expect(config.database?.connectionUrl.expose()).toBe(validUrl);
    expect(Object.isFrozen(config.database)).toBe(true);
  });

  it("redacts a secret from strings, JSON and inspection", () => {
    const secret = new SecretValue(canary);

    expect(String(secret)).toBe("[REDACTED]");
    expect(JSON.stringify({ secret })).toBe('{"secret":"[REDACTED]"}');
    expect(inspect(secret)).toBe("[REDACTED]");
  });

  it("rejects inline database URLs and does not expose their value", () => {
    const environment = crmEnvironment({ QCRM_DATABASE_URL: validUrl });

    expect(() => parseServiceConfig("api", environment, fileSystemFor(validUrl))).toThrow(
      new ConfigurationError("api", ["QCRM_DATABASE_URL"]),
    );

    try {
      parseServiceConfig("api", environment, fileSystemFor(validUrl));
    } catch (error) {
      expect(String(error)).not.toContain(canary);
    }
  });

  it("rejects a tenant ID for the platform database", () => {
    expect(() =>
      parseServiceConfig(
        "admin-api",
        {
          QCRM_ENV: "production",
          QCRM_HOST: "0.0.0.0",
          QCRM_PORT: "3002",
          QCRM_TENANT_ID: tenantId,
          QCRM_DATABASE_URL_FILE: expectedDatabaseSecretPath,
        },
        fileSystemFor(validUrl),
      ),
    ).toThrow(new ConfigurationError("admin-api", ["QCRM_TENANT_ID"]));
  });

  it("rejects database configuration on a process without database access", () => {
    expect(() =>
      parseServiceConfig(
        "agent-runtime",
        {
          QCRM_DATABASE_URL_FILE: expectedDatabaseSecretPath,
        },
        fileSystemFor(validUrl),
      ),
    ).toThrow(new ConfigurationError("agent-runtime", ["QCRM_DATABASE_URL_FILE"]));
  });

  it("rejects an unauthorized protected path", () => {
    expect(() =>
      parseServiceConfig(
        "api",
        crmEnvironment({ QCRM_DATABASE_URL_FILE: "/tmp/not-authorized" }),
        fileSystemFor(validUrl),
      ),
    ).toThrow(new ConfigurationError("api", ["QCRM_DATABASE_URL_FILE"]));
  });

  it("rejects symlinks and oversized secret files without exposing paths", () => {
    expect(() =>
      loadSecretFile("database URL", expectedDatabaseSecretPath, {
        environment: "production",
        expectedProtectedPath: expectedDatabaseSecretPath,
        fileSystem: fileSystemFor(validUrl, { symbolicLink: true }),
      }),
    ).toThrow(new SecretFileError("database URL"));

    expect(() =>
      loadSecretFile("database URL", expectedDatabaseSecretPath, {
        environment: "production",
        expectedProtectedPath: expectedDatabaseSecretPath,
        fileSystem: fileSystemFor(validUrl, { size: 16_385 }),
      }),
    ).toThrow(new SecretFileError("database URL"));
  });

  it("rejects malformed URLs without exposing their content", () => {
    const malformed = `https://runtime:${canary}@postgres/profile_a`;

    try {
      parseServiceConfig("api", crmEnvironment(), fileSystemFor(malformed));
      throw new Error("Expected malformed database URL to fail");
    } catch (error) {
      expect(error).toEqual(new ConfigurationError("api", ["QCRM_DATABASE_URL_FILE"]));
      expect(String(error)).not.toContain(canary);
    }
  });
});
