import { z } from "zod";

const UuidSchema = z.string().uuid();
/**
 * The CRM authorization namespace is intentionally explicit. Platform
 * permissions have their own catalog, while every CRM permission uses the
 * stable `namespace:resource:action` form validated by authentication before
 * it reaches a use case.
 */
export const CrmPermissionCatalog = [
  "iam:members:read",
  "iam:members:create",
  "iam:members:update",
  "iam:members:deactivate",
  "iam:members:export",
  "iam:members:roles",
  "iam:teams:read",
  "iam:teams:create",
  "iam:teams:update",
  "crm:contacts:read",
  "crm:contacts:create",
  "crm:contacts:update",
  "crm:contacts:delete",
  "crm:contacts:export",
  "crm:sales:read",
  "crm:sales:create",
  "crm:sales:update",
  "crm:sales:delete",
  "crm:sales:export",
  "crm:sales:configure",
  "crm:sales:move",
  "crm:tasks:read",
  "crm:tasks:create",
  "crm:tasks:update",
  "crm:tasks:delete",
  "crm:tasks:export",
  "crm:automations:read",
  "crm:automations:execute",
  "crm:automations:configure",
] as const;
export const CrmPermissionSchema = z.enum(CrmPermissionCatalog);
export type CrmPermission = z.infer<typeof CrmPermissionSchema>;

export const MemberIdSchema = UuidSchema;
/** Path parameters for the server-authenticated invitation acceptance command. */
export const AcceptInvitationParamsSchema = z
  .object({
    invitationId: MemberIdSchema,
  })
  .strict();
/** Internal executor command after Keycloak has consumed the one-use action. */
export const AcceptInvitationCommandSchema = z
  .object({
    invitationId: MemberIdSchema,
    oidcSubject: z.string().regex(/^[!-~]{1,255}$/u),
  })
  .strict();
/** Internal metadata acknowledgement after the Keycloak action is issued. */
export const RecordInvitationActivationSchema = z
  .object({
    invitationId: MemberIdSchema,
    oidcSubject: z.string().regex(/^[!-~]{1,255}$/u),
    generation: z.number().int().positive(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
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
export const CommercialScopeSchema = z.enum(["PROFILE", "TEAM", "ASSIGNED"]);
export const InitialRoleCodeSchema = z.enum(["ADMINISTRATOR", "SUPERVISOR", "ADVISOR"]);
export const RoleCodeSchema = z.union([
  InitialRoleCodeSchema,
  z.string().regex(/^CUSTOM_[A-Z0-9_]{1,71}$/u),
]);

export const MemberSchema = z.object({
  id: MemberIdSchema,
  displayName: DisplayNameSchema,
  email: EmailSchema,
  status: MemberStatusSchema,
  authorizationRevision: VersionSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deactivatedAt: IsoDateTimeSchema.nullable(),
  commercialScope: CommercialScopeSchema.default("ASSIGNED"),
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
  roleCode: RoleCodeSchema.default("ADVISOR"),
});

export const UpdateMemberSchema = z
  .object({
    displayName: DisplayNameSchema.optional(),
    email: EmailSchema.optional(),
    roleCode: RoleCodeSchema.optional(),
    commercialScope: CommercialScopeSchema.optional(),
  })
  .refine(
    (value) =>
      value.displayName !== undefined ||
      value.email !== undefined ||
      value.roleCode !== undefined ||
      value.commercialScope !== undefined,
    { message: "At least one member field is required" },
  )
  .refine(
    (value) =>
      value.commercialScope === undefined ||
      (value.displayName === undefined &&
        value.email === undefined &&
        value.roleCode === undefined),
    { message: "Commercial scope must be updated separately" },
  );

export const InvitationSchema = z.object({
  id: UuidSchema,
  memberId: UuidSchema,
  status: z.enum(["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"]),
  expiresAt: IsoDateTimeSchema,
  acceptedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});

export const InvitationActivationDeliverySchema = z.object({
  url: z.string().url().max(8_192),
  expiresAt: IsoDateTimeSchema,
});
export const InvitationResponseSchema = z.object({
  data: InvitationSchema,
  activation: InvitationActivationDeliverySchema.optional(),
});

/** The accepted member is the only representation returned; invitation tokens
 * and identity claims never cross this response contract. */
export const AcceptInvitationResponseSchema = MemberResponseSchema;
export const InvitationActivationResponseSchema = z.object({
  data: z.object({
    invitationId: MemberIdSchema,
    generation: z.number().int().positive(),
    issuedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  }),
  replayed: z.boolean(),
});

export type Member = z.infer<typeof MemberSchema>;
export type MemberListQuery = z.infer<typeof MemberListQuerySchema>;
export type MemberListResponse = z.infer<typeof MemberListResponseSchema>;
export type CreateMemberInvitation = z.infer<typeof CreateMemberInvitationSchema>;
export type InitialRoleCode = z.infer<typeof InitialRoleCodeSchema>;
export type RoleCode = z.infer<typeof RoleCodeSchema>;
export type UpdateMember = z.infer<typeof UpdateMemberSchema>;
export type CommercialScope = z.infer<typeof CommercialScopeSchema>;
export type Invitation = z.infer<typeof InvitationSchema>;
export type InvitationActivationDelivery = z.infer<typeof InvitationActivationDeliverySchema>;
export type AcceptInvitationParams = z.infer<typeof AcceptInvitationParamsSchema>;
export type AcceptInvitationCommand = z.infer<typeof AcceptInvitationCommandSchema>;
export type RecordInvitationActivation = z.infer<typeof RecordInvitationActivationSchema>;
export type InvitationActivationResponse = z.infer<typeof InvitationActivationResponseSchema>;
export type AcceptInvitationResponse = z.infer<typeof AcceptInvitationResponseSchema>;

export const RoleIdSchema = UuidSchema;
export const RoleSchema = z.object({
  id: RoleIdSchema,
  code: RoleCodeSchema,
  displayName: DisplayNameSchema,
  system: z.boolean(),
  authorizationRevision: VersionSchema,
  permissions: z.array(CrmPermissionSchema),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export const RoleListResponseSchema = z.object({ data: z.array(RoleSchema) });
export const RoleResponseSchema = z.object({ data: RoleSchema });
export const CreateRoleSchema = z.object({
  displayName: DisplayNameSchema,
  permissions: z.array(CrmPermissionSchema).max(CrmPermissionCatalog.length),
});
export const UpdateRoleSchema = z
  .object({
    displayName: DisplayNameSchema.optional(),
    permissions: z.array(CrmPermissionSchema).max(CrmPermissionCatalog.length).optional(),
  })
  .refine((value) => value.displayName !== undefined || value.permissions !== undefined, {
    message: "At least one role field is required",
  });
export type Role = z.infer<typeof RoleSchema>;
export type CreateRole = z.infer<typeof CreateRoleSchema>;
export type UpdateRole = z.infer<typeof UpdateRoleSchema>;
