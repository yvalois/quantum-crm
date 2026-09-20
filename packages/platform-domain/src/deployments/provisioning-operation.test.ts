import { describe, expect, it, vi } from "vitest";

import {
  createProvisioningOperationDraft,
  ProvisioningOperationValidationError,
  TenantProvisioningService,
  type ProvisioningOperationRepository,
} from "./provisioning-operation.js";

const command = {
  tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
  serverId: "01995f7e-7b52-7000-8000-000000000301",
  releaseId: "01995f7e-7b52-7000-8000-000000000302",
  requestedByOperatorId: "01995f7e-7b52-7000-8000-000000000101",
  idempotencyKey: "provision-acme-001",
  correlationId: "request-001",
  expectedTenantVersion: 1n,
} as const;

describe("tenant provisioning operation", () => {
  it("creates a closed pending operation draft", () => {
    expect(createProvisioningOperationDraft(command)).toEqual({
      tenantProfileId: command.tenantProfileId,
      serverId: command.serverId,
      releaseId: command.releaseId,
      requestedByOperatorId: command.requestedByOperatorId,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      status: "PENDING",
      currentStep: "VALIDATE",
    });
  });

  it.each([
    ["tenantProfileId", { tenantProfileId: "bad" }],
    ["serverId", { serverId: "bad" }],
    ["releaseId", { releaseId: "bad" }],
    ["requestedByOperatorId", { requestedByOperatorId: "bad" }],
    ["idempotencyKey", { idempotencyKey: "short" }],
    ["correlationId", { correlationId: "contains space" }],
  ] as const)("rejects invalid %s", (field, overrides) => {
    expect(() => createProvisioningOperationDraft({ ...command, ...overrides })).toThrow(
      new ProvisioningOperationValidationError(field),
    );
  });

  it("validates before delegating to the durable repository", async () => {
    const request = vi.fn(async () => ({
      operation: {} as never,
      tenantVersion: 2n,
      idempotentReplay: false,
    }));
    const service = new TenantProvisioningService({
      request,
    } satisfies ProvisioningOperationRepository);
    await expect(service.request(command)).resolves.toMatchObject({ tenantVersion: 2n });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ status: "PENDING" }));
  });
});
