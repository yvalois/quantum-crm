import { describe, expect, it } from "vitest";

import {
  ActivationDeliveryWaiters,
  activationDeliveryCallbackRoute,
  activationDeliveryRoute,
} from "./activation-delivery.controller.js";

describe("activation delivery waiters", () => {
  const access = {
    url: "https://identity.example.test/action",
    temporaryPassword: "Qq7!TemporaryPassword",
  } as const;
  const key = {
    correlationId: "activation-test-001",
    operatorId: "01995f7e-7b52-7000-8000-000000000101",
    tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
    generation: 1,
  } as const;

  it("releases a URL only to the exact original waiter", async () => {
    const waiters = new ActivationDeliveryWaiters();
    const pending = waiters.wait(key, 1_000);
    expect(
      waiters.deliver({ ...key, operatorId: "01995f7e-7b52-7000-8000-000000000102" }, access),
    ).toBe(false);
    expect(waiters.deliver(key, access)).toBe(true);
    await expect(pending).resolves.toEqual(access);
  });

  it("forgets an absent or expired waiter instead of retaining a link", async () => {
    const waiters = new ActivationDeliveryWaiters();
    await expect(waiters.wait(key, 1)).resolves.toBeNull();
    expect(waiters.deliver(key, access)).toBe(false);
  });
});

describe("activation delivery callback route", () => {
  it("is outside the tenant UUID controller", () => {
    expect(activationDeliveryCallbackRoute).toBe("api/v1/internal/activation-deliveries");
    expect(activationDeliveryCallbackRoute.startsWith(`${activationDeliveryRoute}/`)).toBe(false);
  });
});
