import { z } from "zod";

const UuidSchema = z.string().uuid();
const VersionSchema = z.string().regex(/^[1-9][0-9]*$/u);
const DisplayNameSchema = z.string().trim().min(1).max(160);
const EmailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .transform((value) => value.toLowerCase());
const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const MemberStatusSchema = z.enum(["INVITED", "ACTIVE", "DEACTIVATED"]);
export const InitialRoleCodeSchema = z.enum(["ADMINISTRATOR", "SUPERVISOR", "ADVISOR"]);

export const MemberSchema = z.object({
  id: UuidSchema,
  displayName: DisplayNameSchema,
  email: EmailSchema,
  status: MemberStatusSchema,
  authorizationRevision: VersionSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deactivatedAt: IsoDateTimeSchema.nullable(),
});

export const MemberResponseSchema = z.object({ data: MemberSchema });

export const MemberListResponseSchema = z.object({
  data: z.array(MemberSchema),
  page: z.object({
    nextCursor: z.string().min(1).max(512).nullable(),
  }),
});

export const MemberListQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: MemberStatusSchema.optional(),
});

export const CreateMemberInvitationSchema = z.object({
  displayName: DisplayNameSchema,
  email: EmailSchema,
  roleCode: InitialRoleCodeSchema.default("ADVISOR"),
});

export const UpdateMemberSchema = z
  .object({
    displayName: DisplayNameSchema.optional(),
    email: EmailSchema.optional(),
  })
  .refine((value) => value.displayName !== undefined || value.email !== undefined, {
    message: "At least one member field is required",
  });

export const InvitationSchema = z.object({
  id: UuidSchema,
  memberId: UuidSchema,
  status: z.enum(["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"]),
  expiresAt: IsoDateTimeSchema,
  acceptedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});

export const InvitationResponseSchema = z.object({ data: InvitationSchema });

export type Member = z.infer<typeof MemberSchema>;
export type MemberListQuery = z.infer<typeof MemberListQuerySchema>;
export type MemberListResponse = z.infer<typeof MemberListResponseSchema>;
export type CreateMemberInvitation = z.infer<typeof CreateMemberInvitationSchema>;
export type InitialRoleCode = z.infer<typeof InitialRoleCodeSchema>;
export type UpdateMember = z.infer<typeof UpdateMemberSchema>;
export type Invitation = z.infer<typeof InvitationSchema>;
