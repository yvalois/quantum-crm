import { describe, expect, it, vi } from "vitest";

import { createAdminApiActivationDeliveryCallback } from "./admin-api-activation-delivery-callback.js";

describe("admin API activation callback", () => {
  it("uses the fixed callback outside the tenant-profile route", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ accepted: false }), { status: 202 }));
    try {
      await createAdminApiActivationDeliveryCallback({
        origin: "http://admin-api:3002",
        principal: "deploy-executor",
        audience: "quantum-admin-api-activation-callback",
        token: "a".repeat(32),
      }).deliver({
        intentId: "019b0000-0000-7000-8000-000000000101",
        tenantProfileId: "019b0000-0000-7000-8000-000000000102",
        operatorId: "019b0000-0000-7000-8000-000000000103",
        generation: 1,
        correlationId: "activation-20260927",
        url: "https://identity.example.test/action",
      });
      expect(fetchSpy).toHaveBeenCalledWith(
        new URL("http://admin-api:3002/api/v1/internal/activation-deliveries/callback"),
        expect.any(Object),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
