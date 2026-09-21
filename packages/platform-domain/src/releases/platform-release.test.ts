import { describe, expect, it } from "vitest";

import {
  createPlatformReleaseDraft,
  hydratePlatformRelease,
  platformReleaseArtifactNames,
  PlatformReleaseValidationError,
  transitionPlatformReleaseStatus,
} from "./platform-release.js";

const artifacts = platformReleaseArtifactNames.map((name, index) => ({
  name,
  digest: `sha256:${index.toString(16).padStart(64, "0")}`,
}));

const draft = {
  id: "01995f7e-7b52-7000-8000-000000000601",
  semanticVersion: "1.2.3-candidate.1",
  commitSha: "a".repeat(40),
  releaseNotes: "Primera release candidata.",
  compatibility: {
    configurationSchemaVersion: 1,
    agentContractVersion: "agent/v1",
    databaseMigrationRequired: true,
    minimumSourceVersion: "1.0.0",
  },
  artifacts,
} as const;

describe("platform release", () => {
  it("normalizes an immutable release with every required artifact", () => {
    const release = hydratePlatformRelease({
      ...draft,
      status: "CANDIDATE",
      version: 1n,
      createdAt: new Date("2026-09-21T00:00:00.000Z"),
      updatedAt: new Date("2026-09-21T00:00:00.000Z"),
    });

    expect(release.artifacts.map(({ name }) => name)).toEqual(platformReleaseArtifactNames);
    expect(Object.isFrozen(release)).toBe(true);
    expect(Object.isFrozen(release.artifacts)).toBe(true);
  });

  it.each([
    ["id", { ...draft, id: "not-a-uuid" }],
    ["semanticVersion", { ...draft, semanticVersion: "latest" }],
    ["commitSha", { ...draft, commitSha: "abc" }],
    ["releaseNotes", { ...draft, releaseNotes: "" }],
    ["artifacts", { ...draft, artifacts: artifacts.slice(1) }],
    ["artifacts", { ...draft, artifacts: [...artifacts.slice(0, 7), artifacts[0]] }],
    [
      "compatibility.minimumSourceVersion",
      {
        ...draft,
        compatibility: {
          ...draft.compatibility,
          databaseMigrationRequired: false,
        },
      },
    ],
  ])("rejects invalid %s", (_field, input) => {
    expect(() => createPlatformReleaseDraft(input as typeof draft)).toThrow(
      PlatformReleaseValidationError,
    );
  });

  it("allows only candidate to validated to retired", () => {
    expect(transitionPlatformReleaseStatus("CANDIDATE", "VALIDATED")).toBe("VALIDATED");
    expect(transitionPlatformReleaseStatus("VALIDATED", "RETIRED")).toBe("RETIRED");
    expect(() => transitionPlatformReleaseStatus("RETIRED", "VALIDATED")).toThrow(
      PlatformReleaseValidationError,
    );
    expect(() => transitionPlatformReleaseStatus("CANDIDATE", "RETIRED")).toThrow(
      PlatformReleaseValidationError,
    );
  });
});
