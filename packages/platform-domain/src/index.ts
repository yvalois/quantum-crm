export {
  createTenantProfileDraft,
  hydrateTenantProfile,
  TenantProfileValidationError,
  tenantProfileStatuses,
  type TenantProfile,
  type TenantProfileDraft,
  type TenantProfileStatus,
} from "./tenants/index.js";

export {
  createPlatformOperatorMembershipDraft,
  hydratePlatformOperatorMembership,
  PlatformOperatorMembershipValidationError,
  platformOperatorStatuses,
  platformPermissions,
  type PlatformOperatorMembership,
  type PlatformOperatorMembershipDraft,
  type PlatformOperatorStatus,
  type PlatformPermission,
} from "./platform-iam/index.js";

export const packageIdentity = "@quantum-crm/platform-domain" as const;
