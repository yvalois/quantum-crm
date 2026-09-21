import { describe, expect, it } from "vitest";

import {
  CreatePlatformReleaseSchema,
  PlatformReleaseResponseSchema,
  PlatformReleaseStatusSchema,
} from "./platform-release.js";

const artifacts = [
  "CRM_WEB",
  "PORTAL_WEB",
  "ADMIN_WEB",
  "API",
  "ADMIN_API",
  "WORKER",
  "DEPLOY_EXECUTOR",
  "AGENT_RUNTIME",
].map((name, index) => ({ name, digest: `sha256:${index.toString(16).padStart(64, "0")}` }));

const candidate = {
  id: "01995f7e-7b52-7000-8000-000000000601",
  semanticVersion: "1.2.3-candidate.1",
  commitSha: "a".repeat(40),
  releaseNotes: "Release notes.",
  compatibility: {
    configurationSchemaVersion: 1,
    agentContractVersion: "agent/v1",
    databaseMigrationRequired: false,
  },
  artifacts,
};

describe("platform release HTTP contract", () => {
  it("accepts an exact eight-artifact candidate", () => {
    expect(CreatePlatformReleaseSchema.parse(candidate).artifacts).toHaveLength(8);
  });

  it("rejects duplicate artifacts and mutable tags", () => {
    expect(
      CreatePlatformReleaseSchema.safeParse({
        ...candidate,
        artifacts: [...artifacts.slice(0, 7), artifacts[0]],
      }).success,
    ).toBe(false);
    expect(
      CreatePlatformReleaseSchema.safeParse({
        ...candidate,
        artifacts: artifacts.map((artifact) => ({ ...artifact, digest: "latest" })),
      }).success,
    ).toBe(false);
  });

  it("represents observed state and rejects unknown states", () => {
    expect(PlatformReleaseStatusSchema.safeParse("PUBLISHED").success).toBe(false);
    expect(
      PlatformReleaseResponseSchema.safeParse({
        schemaVersion: "platform-release/v1",
        data: {
          ...candidate,
          status: "CANDIDATE",
          version: "1",
          createdAt: "2026-09-21T00:00:00.000Z",
          updatedAt: "2026-09-21T00:00:00.000Z",
        },
      }).success,
    ).toBe(true);
  });
});
