import { describe, expect, it } from "vitest";

import {
  createReleaseManifest,
  ReleaseManifestSchema,
  serializeReleaseManifest,
} from "./release-manifest.js";
import { PlatformReleaseArtifactNames } from "./platform-release.js";

function sha256(index: number): string {
  return `sha256:${index.toString(16).padStart(64, "0")}`;
}

function artifact(name: (typeof PlatformReleaseArtifactNames)[number], index: number) {
  const digest = sha256(index);
  return {
    name,
    digest,
    sbom: {
      predicateType: "https://spdx.dev/Document" as const,
      subjectDigest: digest,
    },
    provenance: {
      predicateType: "https://slsa.dev/provenance/v1" as const,
      subjectDigest: digest,
    },
  };
}

const artifacts = PlatformReleaseArtifactNames.map((name, index) => artifact(name, index + 1));

const manifest = {
  schemaVersion: "release-manifest/v1" as const,
  release: {
    id: "01995f7e-7b52-7000-8000-000000000701",
    semanticVersion: "1.2.3-candidate.1",
    commitSha: "a".repeat(40),
    releaseNotes: "Release candidate evidence.",
    pnpmLockfileSha256: sha256(500),
    compatibility: {
      configurationSchemaVersion: 1,
      agentContractVersion: "agent/v1",
      databaseMigrationRequired: false,
    },
  },
  artifacts,
  scan: {
    policyVersion: "quantum-image-security/v1" as const,
    scanner: { name: "grype" as const, version: "0.90.0", databaseSha256: sha256(501) },
    outcome: "PASSED" as const,
    artifacts: artifacts.map((item, index) => ({
      name: item.name,
      digest: item.digest,
      reportSha256: sha256(index + 300),
      critical: 0 as const,
      high: 0 as const,
      medium: index,
      low: index + 1,
      unknown: 0,
    })),
  },
};

describe("release manifest contract", () => {
  it("canonicalizes every contract artifact into deterministic bytes", () => {
    const reversed = {
      ...manifest,
      artifacts: [...manifest.artifacts].reverse(),
      scan: { ...manifest.scan, artifacts: [...manifest.scan.artifacts].reverse() },
    };

    expect(createReleaseManifest(reversed).artifacts.map((item) => item.name)).toEqual(
      PlatformReleaseArtifactNames,
    );
    expect(serializeReleaseManifest(reversed)).toBe(serializeReleaseManifest(manifest));
  });

  it("requires digest-bound attestations and scan evidence for every artifact", () => {
    expect(
      ReleaseManifestSchema.safeParse({
        ...manifest,
        artifacts: manifest.artifacts.slice(0, -1),
      }).success,
    ).toBe(false);
    expect(
      ReleaseManifestSchema.safeParse({
        ...manifest,
        artifacts: [
          ...manifest.artifacts.slice(0, 7),
          {
            ...manifest.artifacts[0],
            sbom: { ...manifest.artifacts[0].sbom, subjectDigest: sha256(999) },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ReleaseManifestSchema.safeParse({
        ...manifest,
        scan: { ...manifest.scan, artifacts: manifest.scan.artifacts.slice(0, -1) },
      }).success,
    ).toBe(false);
  });

  it("rejects mutable digests, unknown keys and an inadmissible scan", () => {
    expect(
      ReleaseManifestSchema.safeParse({
        ...manifest,
        artifacts: manifest.artifacts.map((item) => ({ ...item, digest: "latest" })),
      }).success,
    ).toBe(false);
    expect(
      ReleaseManifestSchema.safeParse({ ...manifest, deploymentUrl: "https://example.test" })
        .success,
    ).toBe(false);
    expect(
      ReleaseManifestSchema.safeParse({
        ...manifest,
        scan: {
          ...manifest.scan,
          artifacts: manifest.scan.artifacts.map((item, index) =>
            index === 0 ? { ...item, high: 1 } : item,
          ),
        },
      }).success,
    ).toBe(false);
  });
});
