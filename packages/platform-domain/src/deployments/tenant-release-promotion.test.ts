import { describe, expect, it } from "vitest";

import {
  TenantReleasePromotionValidationError,
  validateTenantReleasePromotionAdvance,
  validateTenantReleasePromotionRequest,
} from "./tenant-release-promotion.js";

const ids = {
  operation: "01995f7e-7b52-7000-8000-000000000401",
  tenant: "01995f7e-7b52-7000-8000-000000000201",
  release: "01995f7e-7b52-7000-8000-000000000301",
  operator: "01995f7e-7b52-7000-8000-000000000101",
};

describe("tenant release promotion", () => {
  it("keeps the idempotency key in the typed request", () => {
    expect(validateTenantReleasePromotionRequest({
      id: ids.operation,
      tenantProfileId: ids.tenant,
      targetReleaseId: ids.release,
      requestedByOperatorId: ids.operator,
      idempotencyKey: "release-promote-0001",
      correlationId: "release-promote-0001",
      expectedTenantVersion: 3n,
    })).toMatchObject({ idempotencyKey: "release-promote-0001", expectedTenantVersion: 3n });
  });

  it("allows only the next fenced step", () => {
    expect(validateTenantReleasePromotionAdvance({
      id: ids.operation,
      workerId: "deploy-executor:test",
      expectedVersion: 2n,
      attempt: 1,
      currentStep: "VERIFY",
      nextStep: "ACTIVATE",
    })).toMatchObject({ nextStep: "ACTIVATE" });
    expect(() => validateTenantReleasePromotionAdvance({
      id: ids.operation,
      workerId: "deploy-executor:test",
      expectedVersion: 2n,
      attempt: 1,
      currentStep: "VERIFY",
      nextStep: "MIGRATE",
    })).toThrow(TenantReleasePromotionValidationError);
  });
});
