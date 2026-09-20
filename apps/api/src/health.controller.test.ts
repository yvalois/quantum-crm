import { describe, expect, it } from "vitest";

import { HealthController } from "./health.controller.js";

describe("api health controller", () => {
  const controller = new HealthController();

  it("returns its service identity for readiness", () => {
    expect(controller.ready()).toMatchObject({
      schemaVersion: "health/v1",
      service: "api",
      check: "ready",
      status: "ok",
    });
  });
});
