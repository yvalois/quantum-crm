import { describe, expect, it } from "vitest";

import { createInternalHealthServer } from "./health-server.js";

describe("internal health server", () => {
  it("distinguishes liveness from readiness", async () => {
    let ready = false;
    const server = createInternalHealthServer({
      serviceName: "worker",
      host: "127.0.0.1",
      port: 0,
      isReady: () => ready,
    });
    const address = await server.start();

    try {
      const liveResponse = await fetch(`http://${address.host}:${address.port}/health/live`);
      expect(liveResponse.status).toBe(200);

      const notReadyResponse = await fetch(`http://${address.host}:${address.port}/health/ready`);
      expect(notReadyResponse.status).toBe(503);

      ready = true;
      const readyResponse = await fetch(`http://${address.host}:${address.port}/health/ready`);
      expect(readyResponse.status).toBe(200);
      await expect(readyResponse.json()).resolves.toMatchObject({
        service: "worker",
        check: "ready",
        status: "ok",
      });
    } finally {
      await server.close();
    }
  });

  it("fails readiness closed when its asynchronous probe throws", async () => {
    const server = createInternalHealthServer({
      serviceName: "worker",
      host: "127.0.0.1",
      port: 0,
      isReady: async () => Promise.reject(new Error("dependency unavailable")),
    });
    const address = await server.start();

    try {
      const response = await fetch(`http://${address.host}:${address.port}/health/ready`);
      expect(response.status).toBe(503);
    } finally {
      await server.close();
    }
  });
});
