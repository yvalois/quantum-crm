import { z } from "zod";

import {
  PlatformReleaseArtifactNameSchema,
  PlatformReleaseArtifactNames,
  PlatformReleaseCompatibilitySchema,
} from "./platform-release.js";

const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const semanticVersionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

const Sha256Schema = z.string().regex(sha256Pattern);
const CommitShaSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{40}$/u);

const ReleaseManifestAttestationSchema = z
  .object({
    predicateType: z.string().url().max(200),
    subjectDigest: Sha256Schema,
  })
  .strict();

export const ReleaseManifestArtifactSchema = z
  .object({
    name: PlatformReleaseArtifactNameSchema,
    digest: Sha256Schema,
    sbom: ReleaseManifestAttestationSchema.extend({
      predicateType: z.literal("https://spdx.dev/Document"),
    }),
    provenance: ReleaseManifestAttestationSchema.extend({
      predicateType: z.literal("https://slsa.dev/provenance/v1"),
    }),
  })
  .strict();

const ReleaseManifestScanArtifactSchema = z
  .object({
    name: PlatformReleaseArtifactNameSchema,
    digest: Sha256Schema,
    reportSha256: Sha256Schema,
    critical: z.literal(0),
    high: z.literal(0),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  })
  .strict();

export const ReleaseManifestScanSchema = z
  .object({
    policyVersion: z.literal("quantum-image-security/v1"),
    scanner: z
      .object({
        name: z.literal("grype"),
        version: z.string().trim().regex(semanticVersionPattern),
        databaseSha256: Sha256Schema,
      })
      .strict(),
    outcome: z.literal("PASSED"),
    artifacts: z
      .array(ReleaseManifestScanArtifactSchema)
      .length(PlatformReleaseArtifactNames.length),
  })
  .strict();

export const ReleaseManifestSchema = z
  .object({
    schemaVersion: z.literal("release-manifest/v1"),
    release: z
      .object({
        id: z.string().uuid(),
        semanticVersion: z.string().trim().max(80).regex(semanticVersionPattern),
        commitSha: CommitShaSchema,
        releaseNotes: z.string().trim().min(1).max(10_000),
        pnpmLockfileSha256: Sha256Schema,
        compatibility: PlatformReleaseCompatibilitySchema,
      })
      .strict(),
    artifacts: z.array(ReleaseManifestArtifactSchema).length(PlatformReleaseArtifactNames.length),
    scan: ReleaseManifestScanSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    const artifactDigests = new Map(
      manifest.artifacts.map((artifact) => [artifact.name, artifact.digest]),
    );
    const scanDigests = new Map(
      manifest.scan.artifacts.map((artifact) => [artifact.name, artifact.digest]),
    );

    for (const name of PlatformReleaseArtifactNames) {
      const artifact = manifest.artifacts.find((candidate) => candidate.name === name);
      const scanArtifact = manifest.scan.artifacts.find((candidate) => candidate.name === name);
      if (!artifact || !scanArtifact) {
        context.addIssue({
          code: "custom",
          message: "all platform release artifacts require release and scan evidence",
        });
        return;
      }
      if (artifact.sbom.subjectDigest !== artifact.digest) {
        context.addIssue({
          code: "custom",
          message: "SBOM subject digest must match artifact digest",
        });
      }
      if (artifact.provenance.subjectDigest !== artifact.digest) {
        context.addIssue({
          code: "custom",
          message: "provenance subject digest must match artifact digest",
        });
      }
      if (scanArtifact.digest !== artifact.digest) {
        context.addIssue({ code: "custom", message: "scan digest must match artifact digest" });
      }
    }

    if (artifactDigests.size !== PlatformReleaseArtifactNames.length) {
      context.addIssue({ code: "custom", message: "release artifacts must have unique names" });
    }
    if (scanDigests.size !== PlatformReleaseArtifactNames.length) {
      context.addIssue({ code: "custom", message: "scan artifacts must have unique names" });
    }
  });

export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

function compareArtifactNames(
  left: { readonly name: z.infer<typeof PlatformReleaseArtifactNameSchema> },
  right: { readonly name: z.infer<typeof PlatformReleaseArtifactNameSchema> },
): number {
  return (
    PlatformReleaseArtifactNames.indexOf(left.name) -
    PlatformReleaseArtifactNames.indexOf(right.name)
  );
}

export function createReleaseManifest(input: unknown): ReleaseManifest {
  const manifest = ReleaseManifestSchema.parse(input);
  return {
    ...manifest,
    artifacts: [...manifest.artifacts].sort(compareArtifactNames),
    scan: {
      ...manifest.scan,
      artifacts: [...manifest.scan.artifacts].sort(compareArtifactNames),
    },
  };
}

export function serializeReleaseManifest(input: unknown): string {
  return `${JSON.stringify(createReleaseManifest(input))}\n`;
}
