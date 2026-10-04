import { z } from "zod";

export const PlatformReleaseStatusSchema = z.enum(["CANDIDATE", "VALIDATED", "RETIRED"]);
export const PlatformReleaseArtifactNames = [
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
] as const;
export type PlatformReleaseArtifactName = (typeof PlatformReleaseArtifactNames)[number];

export const PlatformReleaseArtifactNameSchema = z.enum(PlatformReleaseArtifactNames);

/**
 * The foundation compose file intentionally receives only the immutable image
 * value it needs.  A release promotion derives this value from the complete
 * release artifact set; it never accepts an independently supplied Keycloak
 * digest.
 */
export const PlatformFoundationDigestMappingSchema = z
  .object({
    QCRM_PLATFORM_KEYCLOAK_IMAGE_DIGEST: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();

export const PlatformServiceDigestMappingSchema = z
  .object({
    QCRM_ADMIN_WEB_DIGEST: z.string().regex(/^[0-9a-f]{64}$/u),
    QCRM_ADMIN_API_DIGEST: z.string().regex(/^[0-9a-f]{64}$/u),
    QCRM_DEPLOY_EXECUTOR_DIGEST: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();

export const PlatformReleaseArtifactSchema = z
  .object({
    name: PlatformReleaseArtifactNameSchema,
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  })
  .strict();

export const PlatformReleaseCompatibilitySchema = z
  .object({
    configurationSchemaVersion: z.number().int().min(1),
    agentContractVersion: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9-]*\/v[1-9][0-9]*$/u),
    databaseMigrationRequired: z.boolean(),
    minimumSourceVersion: z
      .string()
      .trim()
      .regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.databaseMigrationRequired && value.minimumSourceVersion) {
      context.addIssue({ code: "custom", message: "minimumSourceVersion requires a migration" });
    }
  });

const PlatformReleaseContentShape = z
  .object({
    id: z.string().uuid(),
    semanticVersion: z
      .string()
      .trim()
      .max(80)
      .regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u),
    commitSha: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[0-9a-f]{40}$/u),
    releaseNotes: z.string().trim().min(1).max(10_000),
    compatibility: PlatformReleaseCompatibilitySchema,
  })
  .strict();

const PlatformReleaseContentSchema = PlatformReleaseContentShape.extend({
  artifacts: z.array(PlatformReleaseArtifactSchema).length(PlatformReleaseArtifactNames.length),
}).superRefine((value, context) => {
  const names = value.artifacts.map((artifact) => artifact.name);
  if (new Set(names).size !== PlatformReleaseArtifactNames.length) {
    context.addIssue({ code: "custom", message: "artifact names must be unique" });
  }
});

export const CreatePlatformReleaseSchema = PlatformReleaseContentSchema;
export const UpdatePlatformReleaseStatusSchema = z
  .object({ status: PlatformReleaseStatusSchema })
  .strict();

const legacyArtifactNames = PlatformReleaseArtifactNames.filter(
  (name) => name !== "CRM_MIGRATOR" && name !== "PLATFORM_KEYCLOAK",
);

const PlatformReleaseReadContentSchema = PlatformReleaseContentShape.extend({
  artifacts: z
    .array(PlatformReleaseArtifactSchema)
    .min(legacyArtifactNames.length)
    .max(PlatformReleaseArtifactNames.length),
  legacyArtifactCatalog: z.boolean(),
}).superRefine((value, context) => {
  const expectedNames = value.legacyArtifactCatalog
    ? legacyArtifactNames
    : PlatformReleaseArtifactNames;
  const names = value.artifacts.map((artifact) => artifact.name);
  if (
    names.length !== expectedNames.length ||
    new Set(names).size !== expectedNames.length ||
    expectedNames.some((name) => !names.includes(name))
  ) {
    context.addIssue({
      code: "custom",
      message: "artifact names do not match the release catalog",
    });
  }
});

export const PlatformReleaseSchema = PlatformReleaseReadContentSchema.extend({
  status: PlatformReleaseStatusSchema,
  version: z.string().regex(/^[1-9][0-9]*$/u),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const PlatformReleaseResponseSchema = z
  .object({ schemaVersion: z.literal("platform-release/v1"), data: PlatformReleaseSchema })
  .strict();

export const PlatformReleaseListQuerySchema = z
  .object({
    status: PlatformReleaseStatusSchema.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const PlatformReleaseListResponseSchema = z
  .object({
    schemaVersion: z.literal("platform-release-list/v1"),
    data: z.array(PlatformReleaseSchema).max(100),
    meta: z.object({ pageSize: z.number().int().min(1).max(100) }).strict(),
  })
  .strict();

export type CreatePlatformRelease = z.infer<typeof CreatePlatformReleaseSchema>;
export type PlatformReleaseContract = z.infer<typeof PlatformReleaseSchema>;
export type PlatformFoundationDigestMapping = z.infer<typeof PlatformFoundationDigestMappingSchema>;
export type PlatformServiceDigestMapping = z.infer<typeof PlatformServiceDigestMappingSchema>;

export function platformFoundationDigestMapping(
  artifacts: readonly { readonly name: string; readonly digest: string }[],
): PlatformFoundationDigestMapping {
  const keycloak = artifacts.find((artifact) => artifact.name === "PLATFORM_KEYCLOAK");
  if (!keycloak) throw new Error("PLATFORM_KEYCLOAK is required for platform foundation promotion");
  return PlatformFoundationDigestMappingSchema.parse({
    QCRM_PLATFORM_KEYCLOAK_IMAGE_DIGEST: keycloak.digest.slice("sha256:".length),
  });
}

export function platformServiceDigestMapping(
  artifacts: readonly { readonly name: string; readonly digest: string }[],
): PlatformServiceDigestMapping {
  const digestFor = (name: "ADMIN_WEB" | "ADMIN_API" | "DEPLOY_EXECUTOR"): string => {
    const artifact = artifacts.find((candidate) => candidate.name === name);
    if (!artifact) throw new Error(`${name} is required for platform promotion`);
    return artifact.digest.slice("sha256:".length);
  };
  return PlatformServiceDigestMappingSchema.parse({
    QCRM_ADMIN_WEB_DIGEST: digestFor("ADMIN_WEB"),
    QCRM_ADMIN_API_DIGEST: digestFor("ADMIN_API"),
    QCRM_DEPLOY_EXECUTOR_DIGEST: digestFor("DEPLOY_EXECUTOR"),
  });
}
