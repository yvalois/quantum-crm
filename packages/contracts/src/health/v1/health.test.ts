import { describe, expect, it } from "vitest";

import { HealthStatusSchema, createHealthStatus } from "./health.js";

describe("health/v1 contract", () => {
  it("creates a strict readiness response", () => {
    expect(createHealthStatus({ service: "api", check: "ready" })).toEqual({
      schemaVersion: "health/v1",
      service: "api",
      check: "ready",
      status: "ok",
    });
  });

  it("rejects unknown fields", () => {
    expect(() =>
      HealthStatusSchema.parse({
        schemaVersion: "health/v1",
        service: "api",
        check: "live",
        status: "ok",
        secret: "must-not-pass",
      }),
    ).toThrow();
  });
});
