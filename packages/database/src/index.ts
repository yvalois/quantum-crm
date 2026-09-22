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
export {
  createCrmPostgresDatabase,
  IamMemberConflictError,
  type CrmMembershipAuthorization,
  type CrmMembershipRepository,
  type CrmPostgresDatabase,
} from "./crm-postgres-database.js";
export {
  createTenantDatabaseProvisioner,
  TenantDatabaseProvisioningError,
} from "./tenant-database-provisioner.js";
export {
  createTenantDatabaseSecretsProvisioner,
  TenantDatabaseSecretsProvisioningError,
} from "./tenant-database-secrets-provisioner.js";
