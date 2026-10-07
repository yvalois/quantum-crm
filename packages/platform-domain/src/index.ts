export {
  createTenantProfileDraft,
  hydrateTenantProfile,
  transitionTenantProfileStatus,
  TenantProfileLifecycleTransitionError,
  TenantProfileValidationError,
  tenantProfileLifecycleActions,
  tenantProfileStatuses,
  type TenantProfileLifecycleAction,
  type TenantProfile,
  type TenantProfileDraft,
  type TenantProfileStatus,
  TenantProfileConflictError,
  TenantProfileNotFoundError,
  TenantProfileService,
  TenantProfileVersionConflictError,
  type TenantProfileCursor,
  type TenantProfileListCriteria,
  type TenantProfilePage,
  type TenantProfileRepository,
  type UpdateTenantProfileCommand,
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
export {
  ProfileOperatorConflictError,
  ProfileOperatorValidationError,
  profileOperatorStatuses,
  type ProfileOperatorAssignment,
  type ProfileOperatorRepository,
  type ProfileOperatorStatus,
} from "./platform-iam/index.js";

export const packageIdentity = "@quantum-crm/platform-domain" as const;

export * from "./deployments/index.js";
export * from "./infrastructure/index.js";
export * from "./releases/index.js";
