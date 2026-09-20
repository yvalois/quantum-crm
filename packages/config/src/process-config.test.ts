import { describe, expect, it } from "vitest";

import { ConfigurationError, parseProcessConfig } from "./process-config.js";

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
        }).environment,
      ).toBe(environment);
    }
  });

  it("uses safe local defaults", () => {
    expect(parseProcessConfig(definition, {})).toEqual({
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
});
