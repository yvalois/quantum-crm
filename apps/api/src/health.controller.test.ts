import { describe, expect, it, vi } from "vitest";

import { HealthController } from "./health.controller.js";

describe("api health controller", () => {
  const controller = new HealthController({ isReady: async () => true });

  it("returns its service identity for readiness", async () => {
    const response = { status: vi.fn() };
    await expect(controller.ready(response)).resolves.toMatchObject({
      schemaVersion: "health/v1",
      service: "api",
      check: "ready",
      status: "ok",
    });
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it("reports unavailable dependencies without affecting liveness", async () => {
    const unavailable = new HealthController({ isReady: async () => false });
    const response = { status: vi.fn() };

    await expect(unavailable.ready(response)).resolves.toMatchObject({ status: "not_ready" });
    expect(response.status).toHaveBeenCalledWith(503);
    expect(unavailable.live()).toMatchObject({ status: "ok" });
  });
});
