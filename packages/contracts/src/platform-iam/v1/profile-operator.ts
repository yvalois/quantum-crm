import { z } from "zod";

export const ProfileOperatorStatusSchema = z.enum(["PENDING", "ACTIVE", "FAILED"]);

export const CreateProfileOperatorSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160),
    email: z.string().trim().toLowerCase().email().max(320),
  })
  .strict();

export const ProfileOperatorSchema = CreateProfileOperatorSchema.extend({
  id: z.string().uuid(),
  tenantProfileId: z.string().uuid(),
  status: ProfileOperatorStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const ProfileOperatorListResponseSchema = z
  .object({
    schemaVersion: z.literal("profile-operator-list/v1"),
    data: z.array(ProfileOperatorSchema).max(2),
  })
  .strict();

export const ProfileOperatorAccessResponseSchema = z
  .object({
    schemaVersion: z.literal("profile-operator-access/v1"),
    data: z
      .object({
        operator: ProfileOperatorSchema,
        username: z.string().trim().toLowerCase().email().max(320),
        temporaryPassword: z.string().min(14).max(128),
        loginPath: z.literal("/api/auth/login"),
      })
      .strict(),
  })
  .strict();

export const ProfileOperatorCallbackSchema = z
  .object({
    correlationId: z.string().min(1).max(128),
    requestedByOperatorId: z.string().uuid(),
    assignmentId: z.string().uuid(),
    temporaryPassword: z.string().min(14).max(128),
  })
  .strict();

export type CreateProfileOperator = z.infer<typeof CreateProfileOperatorSchema>;
export type ProfileOperatorContract = z.infer<typeof ProfileOperatorSchema>;
export type ProfileOperatorListResponse = z.infer<typeof ProfileOperatorListResponseSchema>;
export type ProfileOperatorAccessResponse = z.infer<typeof ProfileOperatorAccessResponseSchema>;
