import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseProcessConfig, parseServiceConfig, processDefinitions } from "./process-config.js";
import { ConfigurationError } from "./configuration-error.js";
import type { SecretFileSystem } from "./secret-value.js";

const validDatabaseUrl = "postgresql://runtime:test-only-not-a-secret@postgres:5432/profile_a";

const secretFileSystem: SecretFileSystem = {
  lstat: () => ({
    size: validDatabaseUrl.length,
    isFile: () => true,
    isSymbolicLink: () => false,
  }),
  readFile: () => new TextEncoder().encode(validDatabaseUrl),
  realpath: (path) => path,
};

const definition = {
  serviceName: "worker",
  defaultHost: "127.0.0.1",
  defaultPort: 3101,
} as const;

describe("process configuration", () => {
  it("accepts every approved environment", () => {
    for (const environment of ["local", "test", "preview", "staging", "production"]) {
      expect(
        parseProcessConfig(definition, {
          QCRM_ENV: environment,
          QCRM_HOST: "127.0.0.1",
          QCRM_PORT: "3101",
        }).environment,
      ).toBe(environment);
    }
  });

  it("uses safe local defaults", () => {
    expect(parseProcessConfig(definition, {})).toEqual({
      schemaVersion: "process-config/v1",
      serviceName: "worker",
      environment: "local",
      host: "127.0.0.1",
      port: 3101,
      shutdownTimeoutMs: 10_000,
    });
  });

  it("rejects an unknown QCRM key without exposing its value", () => {
    expect(() =>
      parseProcessConfig(definition, {
        QCRM_UNEXPECTED: "sensitive-value",
      }),
    ).toThrow(new ConfigurationError("worker", ["QCRM_UNEXPECTED"]));

    try {
      parseProcessConfig(definition, { QCRM_UNEXPECTED: "sensitive-value" });
    } catch (error) {
      expect(String(error)).not.toContain("sensitive-value");
    }
  });

  it("rejects an invalid port", () => {
    expect(() => parseProcessConfig(definition, { QCRM_PORT: "0" })).toThrow(
      new ConfigurationError("worker", ["QCRM_PORT"]),
    );
  });

  it("requires host and port outside local and test", () => {
    for (const environment of ["preview", "staging", "production"]) {
      expect(() => parseProcessConfig(definition, { QCRM_ENV: environment })).toThrow(
        new ConfigurationError("worker", ["QCRM_HOST", "QCRM_PORT"]),
      );
    }
  });

  it("rejects placeholders without exposing their values", () => {
    expect(() =>
      parseProcessConfig(definition, {
        QCRM_HOST: "CHANGE_ME",
      }),
    ).toThrow(new ConfigurationError("worker", ["QCRM_HOST"]));

    try {
      parseProcessConfig(definition, { QCRM_HOST: "CHANGE_ME" });
    } catch (error) {
      expect(String(error)).not.toContain("CHANGE_ME");
    }
  });

  it("returns an immutable configuration object", () => {
    expect(Object.isFrozen(parseProcessConfig(definition, {}))).toBe(true);
  });

  it("keeps an exhaustive definition for every Node process", () => {
    expect(processDefinitions).toEqual({
      api: {
        serviceName: "api",
        defaultHost: "0.0.0.0",
        defaultPort: 3001,
        database: { target: "crm", requiresTenant: true },
      },
      "admin-api": {
        serviceName: "admin-api",
        defaultHost: "0.0.0.0",
        defaultPort: 3002,
        database: { target: "platform", requiresTenant: false },
        oidc: { provider: "keycloak", boundary: "platform" },
      },
      worker: {
        serviceName: "worker",
        defaultHost: "127.0.0.1",
        defaultPort: 3101,
        database: { target: "crm", requiresTenant: true },
      },
      "deploy-executor": {
        serviceName: "deploy-executor",
        defaultHost: "127.0.0.1",
        defaultPort: 3102,
        database: { target: "platform", requiresTenant: false, requiresAdmin: true },
        requiresTenantSecretDirectory: true,
        requiresStorageAdmin: true,
      },
      "agent-runtime": {
        serviceName: "agent-runtime",
        defaultHost: "127.0.0.1",
        defaultPort: 3103,
      },
    });
  });

  it("keeps the non-secret example valid for worker", () => {
    const environment = Object.fromEntries(
      readFileSync(join(process.cwd(), ".env.example"), "utf8")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );

    expect(parseServiceConfig("worker", environment, secretFileSystem)).toMatchObject({
      serviceName: "worker",
      environment: "local",
      host: "127.0.0.1",
      port: 3101,
      database: {
        target: "crm",
        tenantId: "00000000-0000-4000-8000-000000000001",
      },
    });
  });

  it("keeps the non-secret admin-api example valid", () => {
    const environment = Object.fromEntries(
      readFileSync(join(process.cwd(), "infra/config/admin-api.env.example"), "utf8")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );

    expect(parseServiceConfig("admin-api", environment, secretFileSystem)).toMatchObject({
      serviceName: "admin-api",
      environment: "local",
      host: "0.0.0.0",
      port: 3002,
      database: { target: "platform" },
      oidc: {
        provider: "keycloak",
        boundary: "platform",
        issuer: "http://keycloak:8080/realms/quantum-platform",
        audience: "quantum-admin-api",
        requiredAcr: "2",
      },
    });
  });
});
