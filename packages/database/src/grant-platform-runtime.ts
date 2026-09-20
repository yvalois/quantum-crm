import { loadMigrationDatabaseConfig } from "@quantum-crm/config";
import pg from "pg";

import { normalizePgConnectionString } from "./pg-connection-string.js";

const grants = Object.freeze([
  "GRANT USAGE ON SCHEMA operations, platform_iam, tenants TO qcrm_platform_runtime",
  "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA operations, platform_iam, tenants TO qcrm_platform_runtime",
  "GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA operations, platform_iam, tenants TO qcrm_platform_runtime",
  "ALTER DEFAULT PRIVILEGES FOR ROLE qcrm_platform_migrator IN SCHEMA operations GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qcrm_platform_runtime",
  "ALTER DEFAULT PRIVILEGES FOR ROLE qcrm_platform_migrator IN SCHEMA platform_iam GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qcrm_platform_runtime",
  "ALTER DEFAULT PRIVILEGES FOR ROLE qcrm_platform_migrator IN SCHEMA tenants GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qcrm_platform_runtime",
  "ALTER DEFAULT PRIVILEGES FOR ROLE qcrm_platform_migrator IN SCHEMA platform_iam GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO qcrm_platform_runtime",
  "ALTER DEFAULT PRIVILEGES FOR ROLE qcrm_platform_migrator IN SCHEMA tenants GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO qcrm_platform_runtime",
  "ALTER DEFAULT PRIVILEGES FOR ROLE qcrm_platform_migrator IN SCHEMA operations GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO qcrm_platform_runtime",
]);

async function grantPlatformRuntime(): Promise<void> {
  const config = loadMigrationDatabaseConfig("platform");
  const client = new pg.Client({
    connectionString: normalizePgConnectionString(config.connectionUrl.expose()),
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const statement of grants) await client.query(statement);
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    throw new Error("Platform runtime grants failed");
  } finally {
    await client.end();
  }
}

grantPlatformRuntime().catch(() => {
  process.stderr.write("Platform runtime grants failed\n");
  process.exitCode = 1;
});
