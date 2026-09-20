import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadMigrationDatabaseConfig } from "@quantum-crm/config";
import { defineConfig } from "prisma/config";

const directory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  schema: join(directory, "schema.prisma"),
  migrations: {
    path: join(directory, "migrations"),
  },
  datasource: {
    url: loadMigrationDatabaseConfig("platform").connectionUrl.expose(),
  },
});
