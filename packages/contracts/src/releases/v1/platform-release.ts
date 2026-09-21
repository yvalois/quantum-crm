import { z } from "zod";

export const PlatformReleaseStatusSchema = z.enum(["CANDIDATE", "VALIDATED", "RETIRED"]);
export const PlatformReleaseArtifactNameSchema = z.enum([
  "CRM_WEB",
  "PORTAL_WEB",
  "ADMIN_WEB",
  "API",
  "ADMIN_API",
  "WORKER",
  "DEPLOY_EXECUTOR",
  "AGENT_RUNTIME",
]);

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

const PlatformReleaseContentSchema = z
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
    artifacts: z.array(PlatformReleaseArtifactSchema).length(8),
  })
  .strict()
  .superRefine((value, context) => {
    const names = value.artifacts.map((artifact) => artifact.name);
    if (new Set(names).size !== 8) {
      context.addIssue({ code: "custom", message: "artifact names must be unique" });
    }
  });

export const CreatePlatformReleaseSchema = PlatformReleaseContentSchema;
export const UpdatePlatformReleaseStatusSchema = z
  .object({ status: PlatformReleaseStatusSchema })
  .strict();

export const PlatformReleaseSchema = PlatformReleaseContentSchema.extend({
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
