import type { ActivationDeliveryRepository } from "@quantum-crm/platform-domain";
import { describe, expect, it, vi } from "vitest";

import { ActivationDeliveryExecutor } from "./activation-delivery-executor.js";

const idempotencyKey = ["activation", "20260926"].join("-");

describe("ActivationDeliveryExecutor", () => {
  it("passes the URL only to the ephemeral callback and records a sanitized acknowledgement", async () => {
    const intent = {
      id: "019b0000-0000-7000-8000-000000000101",
      tenantProfileId: "019b0000-0000-7000-8000-000000000102",
      requestedByOperatorId: "019b0000-0000-7000-8000-000000000103",
      administratorSubject: "019b0000-0000-7000-8000-000000000104",
      generation: 1,
      expiresAt: new Date("2026-09-26T12:30:00.000Z"),
      correlationId: "activation-20260926",
      idempotencyKey,
      payloadHash: "a".repeat(64),
      status: "CLAIMED" as const,
      leaseOwner: "deploy-executor:test",
      leaseExpiresAt: new Date("2026-09-26T12:01:00.000Z"),
      resultCode: null,
      version: 2n,
      createdAt: new Date("2026-09-26T12:00:00.000Z"),
      updatedAt: new Date("2026-09-26T12:00:00.000Z"),
    };
    const complete = vi.fn(async () => null);
    const deliveries = {
      claimNext: vi.fn(async () => intent),
      complete,
      request: vi.fn(),
      reconcileInitialAdministrator: vi.fn(),
      findInitialAdministrator: vi.fn(),
      consumeInitialAdministrator: vi.fn(),
    } satisfies ActivationDeliveryRepository;
    const callback = vi.fn(async () => ({ accepted: true }));
    const executor = new ActivationDeliveryExecutor(
      deliveries,
      {
        reconcile: vi.fn(),
        issueActivation: vi.fn(async () => ({
          url: "https://identity.example/action?key=secret",
          expiresAt: "2026-09-26T12:30:00.000Z",
        })),
        activationStatus: vi.fn(),
      },
      { deliver: callback },
      "deploy-executor:test",
      () => new Date("2026-09-26T12:00:00.000Z"),
    );
    await expect(executor.runOnce()).resolves.toBe(true);
    expect(callback).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ status: "DELIVERED", resultCode: "DELIVERED" }),
    );
  });
  it("reserves a reconciled uncertain provider result without consuming the administrator", async () => {
    const intent = {
      id: "019b0000-0000-7000-8000-000000000111",
      tenantProfileId: "019b0000-0000-7000-8000-000000000112",
      requestedByOperatorId: "019b0000-0000-7000-8000-000000000113",
      administratorSubject: "019b0000-0000-7000-8000-000000000114",
      generation: 2,
      expiresAt: new Date("2026-09-26T12:30:00.000Z"),
      correlationId: "activation-retry-20260926",
      idempotencyKey: ["activation", "retry", "20260926"].join("-"),
      payloadHash: "a".repeat(64),
      status: "CLAIMED" as const,
      leaseOwner: "deploy-executor:test",
      leaseExpiresAt: new Date("2026-09-26T12:01:00.000Z"),
      resultCode: null,
      version: 2n,
      createdAt: new Date("2026-09-26T12:00:00.000Z"),
      updatedAt: new Date("2026-09-26T12:00:00.000Z"),
    };
    const complete = vi.fn(async () => null);
    const deliveries = {
      claimNext: vi.fn(async () => intent),
      complete,
      request: vi.fn(),
      reconcileInitialAdministrator: vi.fn(),
      findInitialAdministrator: vi.fn(),
      consumeInitialAdministrator: vi.fn(),
    } satisfies ActivationDeliveryRepository;
    const issueActivation = vi.fn(async () => {
      throw new Error("timeout");
    });
    const activationStatus = vi.fn(async () => "PENDING" as const);
    const executor = new ActivationDeliveryExecutor(
      deliveries,
      { reconcile: vi.fn(), issueActivation, activationStatus },
      { deliver: vi.fn() },
      "deploy-executor:test",
      () => new Date("2026-09-26T12:00:00.000Z"),
    );
    await expect(executor.runOnce()).resolves.toBe(true);
    expect(activationStatus).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ status: "DELIVERED", resultCode: "UNKNOWN_DELIVERY" }),
    );
    expect(complete).not.toHaveBeenCalledWith(expect.objectContaining({ status: "CONSUMED" }));
  });
  it("defers a provider-confirmed consumption until provisioning verifies the delivered generation", async () => {
    const intent = {
      id: "019b0000-0000-7000-8000-000000000121",
      tenantProfileId: "019b0000-0000-7000-8000-000000000122",
      requestedByOperatorId: "019b0000-0000-7000-8000-000000000123",
      administratorSubject: "019b0000-0000-7000-8000-000000000124",
      generation: 3,
      expiresAt: new Date("2026-09-26T12:30:00.000Z"),
      correlationId: "activation-consumed-20260926",
      idempotencyKey: "activation-consumed-20260926",
      payloadHash: "a".repeat(64),
      status: "CLAIMED" as const,
      leaseOwner: "deploy-executor:test",
      leaseExpiresAt: new Date("2026-09-26T12:01:00.000Z"),
      resultCode: null,
      version: 2n,
      createdAt: new Date("2026-09-26T12:00:00.000Z"),
      updatedAt: new Date("2026-09-26T12:00:00.000Z"),
    };
    const complete = vi.fn(async () => null);
    const deliveries = {
      claimNext: vi.fn(async () => intent),
      complete,
      request: vi.fn(),
      reconcileInitialAdministrator: vi.fn(),
      findInitialAdministrator: vi.fn(),
      consumeInitialAdministrator: vi.fn(),
    } satisfies ActivationDeliveryRepository;
    const executor = new ActivationDeliveryExecutor(
      deliveries,
      {
        reconcile: vi.fn(),
        issueActivation: vi.fn(async () => {
          throw new Error("timeout");
        }),
        activationStatus: vi.fn(async () => "CONSUMED" as const),
      },
      { deliver: vi.fn() },
      "deploy-executor:test",
      () => new Date("2026-09-26T12:00:00.000Z"),
    );
    await expect(executor.runOnce()).resolves.toBe(true);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "DELIVERED",
        resultCode: "CONSUMED_AFTER_UNKNOWN_DELIVERY",
      }),
    );
    expect(complete).not.toHaveBeenCalledWith(expect.objectContaining({ status: "CONSUMED" }));
  });
});
