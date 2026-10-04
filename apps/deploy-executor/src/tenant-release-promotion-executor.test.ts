import { describe, expect, it, vi } from "vitest";

import { TenantReleasePromotionExecutor } from "./tenant-release-promotion-executor.js";

const promotionBase = {
  id: "01995f7e-7b52-7000-8000-000000000401",
  tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
  previousReleaseId: "01995f7e-7b52-7000-8000-000000000301",
  targetReleaseId: "01995f7e-7b52-7000-8000-000000000302",
  requestedByOperatorId: "01995f7e-7b52-7000-8000-000000000101",
  idempotencyKey: "release-promote-0001",
  correlationId: "release-promote-0001",
  attempt: 1,
  version: 2n,
  failureCode: null,
  leaseOwner: "deploy-executor:test",
  leaseExpiresAt: new Date("2026-10-03T00:10:00.000Z"),
  createdAt: new Date(),
  updatedAt: new Date(),
};
const release = {
  id: promotionBase.targetReleaseId,
  semanticVersion: "1.0.0",
  commitSha: "a".repeat(40),
  releaseNotes: "validated",
  compatibility: { configurationSchemaVersion: 1, agentContractVersion: "agent/v1", databaseMigrationRequired: false },
  artifacts: [],
  legacyArtifactCatalog: false,
  status: "VALIDATED" as const,
  version: 1n,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function context() {
  return { serverId: "01995f7e-7b52-7000-8000-000000000501", quotaMiB: 10240, configurationRevision: 3n };
}

describe("tenant release promotion executor", () => {
  it("fails a non-validated release before host effects", async () => {
    const complete = vi.fn(async () => null);
    const containers = { provision: vi.fn() };
    const executor = new TenantReleasePromotionExecutor(
      { claimNext: vi.fn(async () => ({ ...promotionBase, currentStep: "VALIDATE" as const, status: "RUNNING" as const })), resolveContext: vi.fn(async () => context()), advance: vi.fn(), complete },
      { create: vi.fn(), findById: vi.fn(async () => ({ ...release, status: "CANDIDATE" as const })), list: vi.fn(), updateStatus: vi.fn() },
      { provision: vi.fn() }, { migrate: vi.fn() }, containers,
      { workerId: "deploy-executor:test", leaseDurationSeconds: 120 },
    );
    await executor.runOnce();
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ failureCode: "RELEASE_NOT_VALIDATED" }));
    expect(containers.provision).not.toHaveBeenCalled();
  });

  it("observes VERIFY then completes ACTIVATE with the same fenced operation", async () => {
    const verify = { ...promotionBase, currentStep: "VERIFY" as const, status: "RUNNING" as const };
    const activate = { ...promotionBase, currentStep: "ACTIVATE" as const, status: "RUNNING" as const, version: 3n };
    const claimNext = vi.fn().mockResolvedValueOnce(verify).mockResolvedValueOnce(activate);
    const advance = vi.fn(async () => null);
    const complete = vi.fn(async () => null);
    const executor = new TenantReleasePromotionExecutor(
      { claimNext, resolveContext: vi.fn(async () => context()), advance, complete },
      { create: vi.fn(), findById: vi.fn(async () => release), list: vi.fn(), updateStatus: vi.fn() },
      { provision: vi.fn(async () => ({ manifestRef: "tenant/01995f7e-7b52-7000-8000-000000000201/configuration.json", revision: 3n })) },
      { migrate: vi.fn() },
      { provision: vi.fn(async () => ({ projectName: "qcrm-t-01995f7e-7b52-7000-8000-000000000201", services: ["crm-web", "portal-web", "api", "worker", "agent-runtime"] as const, ready: true, reconciled: true })) },
      { workerId: "deploy-executor:test", leaseDurationSeconds: 120 },
    );
    await executor.runOnce();
    await executor.runOnce();
    expect(advance).toHaveBeenCalledWith(expect.objectContaining({ currentStep: "VERIFY", nextStep: "ACTIVATE" }));
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ id: activate.id, expectedVersion: activate.version }));
  });
});
