export const packageIdentity = "@quantum-crm/database" as const;

export { POSTGRES_DATABASE } from "./database-token.js";

export {
  createPostgresDatabase,
  createPostgresDatabaseFromPool,
  createPostgresPool,
  createPlatformPostgresDatabase,
  DatabaseUnavailableError,
  type PlatformMembershipRepository,
  type PlatformMembershipRecord,
  type PlatformPostgresDatabase,
  type PostgresPool,
  type PostgresDatabase,
  type PostgresPoolFactory,
} from "./postgres-database.js";
export { createActivationDeliveryRepository } from "./activation-delivery-repository.js";
export { createPlatformFoundationPromotionRepository } from "./platform-foundation-promotion-repository.js";
export { createTenantReleasePromotionRepository } from "./tenant-release-promotion-repository.js";
export {
  createCrmPostgresDatabase,
  IamMemberConflictError,
  type CrmMembershipAuthorization,
  type CrmMembershipRepository,
  type CrmPostgresDatabase,
} from "./crm-postgres-database.js";
export {
  CommercialIdempotencyConflictError,
  type CommercialPostgresRepositories,
} from "./commercial-postgres-database.js";
export { ConversationIdempotencyConflictError } from "./conversation-postgres-repository.js";
export { createCalendarPostgresRepository } from "./calendar-postgres-repository.js";
export { createFormPostgresRepository } from "./form-postgres-repository.js";
export { createDocumentPostgresRepository } from "./document-postgres-repository.js";
export {
  createFilePostgresRepository,
  type FileProcessingLease,
  type FileProcessingRepository,
} from "./file-postgres-repository.js";
export {
  createTenantDatabaseProvisioner,
  TenantDatabaseProvisioningError,
} from "./tenant-database-provisioner.js";
export {
  createTenantDatabaseSecretsProvisioner,
  TenantDatabaseSecretsProvisioningError,
} from "./tenant-database-secrets-provisioner.js";
