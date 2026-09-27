import { describe, expect, it } from "vitest";

import { activationDeliveryResultCodes, activationDeliveryTtlMilliseconds, ActivationDeliveryValidationError, completeActivationDelivery, createActivationDeliveryIntent, transitionActivationDelivery } from "./activation-delivery.js";

const now = new Date("2026-09-26T12:00:00.000Z");
const intent = createActivationDeliveryIntent({ id: "019b0000-0000-7000-8000-000000000101", tenantProfileId: "019b0000-0000-7000-8000-000000000102", requestedByOperatorId: "019b0000-0000-7000-8000-000000000103", administratorSubject: "019b0000-0000-7000-8000-000000000104", generation: 1, expiresAt: new Date(now.getTime() + activationDeliveryTtlMilliseconds), correlationId: "activation-20260926", idempotencyKey: "activation-20260926", payloadHash: "a".repeat(64), createdAt: now });

describe("activation delivery intent", () => {
  it("declares the durable consumption result code", () => {
    expect(activationDeliveryResultCodes).toContain("CONSUMED");
  });

  it("uses exactly thirty minutes and requires claim before delivery", () => {
    expect(intent.expiresAt.getTime() - intent.createdAt.getTime()).toBe(activationDeliveryTtlMilliseconds);
    const claimed = transitionActivationDelivery(intent, "CLAIMED", now);
    expect(transitionActivationDelivery(claimed, "DELIVERED", now).status).toBe("DELIVERED");
  });

  it("does not permit a delivery or consume without the preceding durable state", () => {
    expect(() => transitionActivationDelivery(intent, "DELIVERED", now)).toThrow(ActivationDeliveryValidationError);
    const claimed = transitionActivationDelivery(intent, "CLAIMED", now);
    expect(() => transitionActivationDelivery(claimed, "CONSUMED", now)).toThrow(ActivationDeliveryValidationError);
  });

  it("reserves an issued generation after an uncertain hand-off without consuming it", () => {
    const claimed = transitionActivationDelivery(intent, "CLAIMED", now);
    expect(
      completeActivationDelivery(
        claimed,
        { status: "DELIVERED", resultCode: "CONSUMED_AFTER_UNKNOWN_DELIVERY" },
        now,
      ).status,
    ).toBe("DELIVERED");
    expect(() => completeActivationDelivery(claimed, { status: "DISCARDED", resultCode: "UNKNOWN_DELIVERY" }, now)).toThrow(
      ActivationDeliveryValidationError,
    );
  });

  it("expires instead of accepting a late state transition", () => {
    expect(() => transitionActivationDelivery(intent, "CLAIMED", new Date(intent.expiresAt.getTime() + 1))).toThrow(ActivationDeliveryValidationError);
    expect(transitionActivationDelivery(intent, "EXPIRED", new Date(intent.expiresAt.getTime() + 1)).status).toBe("EXPIRED");
  });
});
