export const packageIdentity = "@quantum-crm/database" as const;

export { POSTGRES_DATABASE } from "./database-token.js";

export {
  createPostgresDatabase,
  DatabaseUnavailableError,
  type PostgresDatabase,
  type PostgresPoolFactory,
} from "./postgres-database.js";
