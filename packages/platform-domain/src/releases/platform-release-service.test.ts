import { describe, expect, it, vi } from "vitest";

import { platformReleaseArtifactNames, type PlatformRelease } from "./platform-release.js";
import {
  PlatformReleaseService,
  PlatformReleaseVersionConflictError,
  type PlatformReleaseRepository,
} from "./platform-release-service.js";

const release: PlatformRelease = {
  id: "01995f7e-7b52-7000-8000-000000000601",
  semanticVersion: "1.2.3",
  commitSha: "a".repeat(40),
  releaseNotes: "Release.",
  compatibility: {
    configurationSchemaVersion: 1,
    agentContractVersion: "agent/v1",
    databaseMigrationRequired: false,
  },
  artifacts: platformReleaseArtifactNames.map((name, index) => ({
    name,
    digest: `sha256:${index.toString(16).padStart(64, "0")}`,
  })),
  status: "CANDIDATE",
  version: 1n,
  createdAt: new Date("2026-09-21T00:00:00.000Z"),
  updatedAt: new Date("2026-09-21T00:00:00.000Z"),
};

function repository(update: PlatformRelease | null): PlatformReleaseRepository {
  return {
    create: vi.fn(async () => release),
    findById: vi.fn(async () => release),
    list: vi.fn(async () => [release]),
    updateStatus: vi.fn(async () => update),
  };
}

describe("PlatformReleaseService", () => {
  it("transitions with optimistic concurrency", async () => {
    const validated = { ...release, status: "VALIDATED" as const, version: 2n };
    const repo = repository(validated);
    const service = new PlatformReleaseService(repo);

    await expect(service.updateStatus(release.id, 1n, "VALIDATED")).resolves.toEqual(validated);
    expect(repo.updateStatus).toHaveBeenCalledWith(release.id, 1n, "VALIDATED");
  });

  it("reports stale status changes", async () => {
    await expect(
      new PlatformReleaseService(repository(null)).updateStatus(release.id, 1n, "VALIDATED"),
    ).rejects.toBeInstanceOf(PlatformReleaseVersionConflictError);
  });
});
