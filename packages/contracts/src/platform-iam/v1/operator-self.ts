import { z } from "zod";

export const PlatformPermissionSchema = z.enum([
  "tenants:read",
  "tenants:manage",
  "configuration:read",
  "configuration:manage",
  "deployments:read",
  "deployments:execute",
  "deployments:activate",
  "operators:manage",
]);

export const PlatformOperatorSelfSchema = z
  .object({
    schemaVersion: z.literal("platform-operator/v1"),
    data: z
      .object({
        id: z.string().uuid(),
        permissions: z.array(PlatformPermissionSchema).max(32),
        authorizationRevision: z.string().regex(/^[1-9][0-9]*$/u),
        authenticatedAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict();

export type PlatformOperatorSelf = z.infer<typeof PlatformOperatorSelfSchema>;

export function createPlatformOperatorSelf(input: {
  readonly id: string;
  readonly permissions: readonly z.infer<typeof PlatformPermissionSchema>[];
  readonly authorizationRevision: bigint;
  readonly authenticatedAt: string;
}): PlatformOperatorSelf {
  return PlatformOperatorSelfSchema.parse({
    schemaVersion: "platform-operator/v1",
    data: {
      id: input.id,
      permissions: [...input.permissions],
      authorizationRevision: input.authorizationRevision.toString(),
      authenticatedAt: input.authenticatedAt,
    },
  });
}
