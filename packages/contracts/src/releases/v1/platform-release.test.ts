import { describe, expect, it } from "vitest";

import {
  CreatePlatformReleaseSchema,
  PlatformReleaseArtifactNames,
  PlatformReleaseResponseSchema,
  PlatformReleaseStatusSchema,
  platformFoundationDigestMapping,
  platformServiceDigestMapping,
} from "./platform-release.js";

const artifacts = [
  "CRM_WEB",
  "PORTAL_WEB",
  "ADMIN_WEB",
  "API",
  "ADMIN_API",
  "WORKER",
  "DEPLOY_EXECUTOR",
  "CRM_MIGRATOR",
  "PLATFORM_KEYCLOAK",
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
  it("accepts the complete contract-driven candidate", () => {
    expect(CreatePlatformReleaseSchema.parse(candidate).artifacts).toHaveLength(
      PlatformReleaseArtifactNames.length,
    );
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

  it("derives the platform foundation Keycloak digest from its immutable artifact", () => {
    expect(platformFoundationDigestMapping(artifacts)).toEqual({
      QCRM_PLATFORM_KEYCLOAK_IMAGE_DIGEST: "8".padStart(64, "0"),
    });
  });

  it("derives only the three platform service digests", () => {
    const mapping = platformServiceDigestMapping([
      { name: "ADMIN_WEB", digest: `sha256:${"a".repeat(64)}` },
      { name: "ADMIN_API", digest: `sha256:${"b".repeat(64)}` },
      { name: "DEPLOY_EXECUTOR", digest: `sha256:${"c".repeat(64)}` },
    ]);
    expect(mapping).toEqual({
      QCRM_ADMIN_WEB_DIGEST: "a".repeat(64),
      QCRM_ADMIN_API_DIGEST: "b".repeat(64),
      QCRM_DEPLOY_EXECUTOR_DIGEST: "c".repeat(64),
    });
  });

  it("represents observed state and rejects unknown states", () => {
    expect(PlatformReleaseStatusSchema.safeParse("PUBLISHED").success).toBe(false);
    expect(
      PlatformReleaseResponseSchema.safeParse({
        schemaVersion: "platform-release/v1",
        data: {
          ...candidate,
          legacyArtifactCatalog: false,
          status: "CANDIDATE",
          version: "1",
          createdAt: "2026-09-21T00:00:00.000Z",
          updatedAt: "2026-09-21T00:00:00.000Z",
        },
      }).success,
    ).toBe(true);
  });

  it("represents historical eight-artifact releases without fabricating modern artifacts", () => {
    expect(
      PlatformReleaseResponseSchema.safeParse({
        schemaVersion: "platform-release/v1",
        data: {
          ...candidate,
          artifacts: artifacts.filter(
            (artifact) => artifact.name !== "CRM_MIGRATOR" && artifact.name !== "PLATFORM_KEYCLOAK",
          ),
          legacyArtifactCatalog: true,
          status: "VALIDATED",
          version: "1",
          createdAt: "2026-09-21T00:00:00.000Z",
          updatedAt: "2026-09-21T00:00:00.000Z",
        },
      }).success,
    ).toBe(true);
  });
});
