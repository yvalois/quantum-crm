import { describe, expect, it } from "vitest";

import {
  PlatformFoundationPromotionValidationError,
  validatePlatformFoundationPromotionRequest,
} from "./platform-foundation-promotion.js";

describe("platform foundation promotion", () => {
  it("accepts a release reference and never a digest", () => {
    expect(
      validatePlatformFoundationPromotionRequest({
        id: "01995f7e-7b52-7000-8000-000000000401",
        releaseId: "01995f7e-7b52-7000-8000-000000000301",
        requestedByOperatorId: "01995f7e-7b52-7000-8000-000000000101",
        idempotencyKey: "foundation-promote-0001",
        correlationId: "foundation-promotion-0001",
      }),
    ).toMatchObject({ releaseId: "01995f7e-7b52-7000-8000-000000000301" });
    expect(() =>
      validatePlatformFoundationPromotionRequest({
        id: "invalid",
        releaseId: "01995f7e-7b52-7000-8000-000000000301",
        requestedByOperatorId: "01995f7e-7b52-7000-8000-000000000101",
        idempotencyKey: "foundation-promote-0001",
        correlationId: "foundation-promotion-0001",
      }),
    ).toThrow(PlatformFoundationPromotionValidationError);
  });
});
