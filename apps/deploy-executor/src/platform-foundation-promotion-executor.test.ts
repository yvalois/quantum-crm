import { describe, expect, it, vi } from "vitest";

import { PlatformFoundationPromotionExecutor } from "./platform-foundation-promotion-executor.js";

const artifactNames = [
  "CRM_WEB", "PORTAL_WEB", "ADMIN_WEB", "API", "ADMIN_API", "WORKER", "DEPLOY_EXECUTOR", "CRM_MIGRATOR", "PLATFORM_KEYCLOAK", "AGENT_RUNTIME",
] as const;
const artifacts = artifactNames.map((name, index) => ({ name, digest: `sha256:${index.toString(16).padStart(64, "0")}` }));

describe("platform foundation promotion executor", () => {
  it("derives the host request only from a persisted validated catalog", async () => {
    const complete = vi.fn(async () => null);
    const client = { reconcile: vi.fn(async () => undefined) };
    const executor = new PlatformFoundationPromotionExecutor(
      {
        claimNext: vi.fn(async () => ({ id: "01995f7e-7b52-7000-8000-000000000401", releaseId: "01995f7e-7b52-7000-8000-000000000301", requestedByOperatorId: "01995f7e-7b52-7000-8000-000000000101", idempotencyKey: "foundation-promote-0001", correlationId: "foundation-promotion-0001", status: "RUNNING" as const, attempt: 1, version: 2n, leaseOwner: "deploy-executor:test", leaseExpiresAt: new Date("2026-09-27T00:10:00.000Z"), failureCode: null, createdAt: new Date(), updatedAt: new Date() })),
        complete,
      },
      { create: vi.fn(), findById: vi.fn(async () => ({ id: "01995f7e-7b52-7000-8000-000000000301", semanticVersion: "0.0.0-candidate.1", commitSha: "a".repeat(40), releaseNotes: "candidate", compatibility: { configurationSchemaVersion: 1, agentContractVersion: "agent/v1", databaseMigrationRequired: false }, artifacts, legacyArtifactCatalog: false, status: "VALIDATED" as const, version: 1n, createdAt: new Date(), updatedAt: new Date() })), list: vi.fn(), updateStatus: vi.fn() },
      client,
      "deploy-executor:test",
    );
    await expect(executor.runOnce()).resolves.toBe(true);
    expect(client.reconcile).toHaveBeenCalledWith(artifacts);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ id: "01995f7e-7b52-7000-8000-000000000401" }));
  });
});
