export const packageIdentity = "@quantum-crm/database" as const;

export { POSTGRES_DATABASE } from "./database-token.js";

export {
  createPostgresDatabase,
  createPlatformPostgresDatabase,
  DatabaseUnavailableError,
  type PlatformMembershipRepository,
  type PlatformMembershipRecord,
  type PlatformPostgresDatabase,
  type PostgresDatabase,
  type PostgresPoolFactory,
} from "./postgres-database.js";
