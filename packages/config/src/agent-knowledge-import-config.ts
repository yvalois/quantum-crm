import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import { parseDatabaseConfig, type DatabaseConfig } from "./database-config.js";
import { parseFilesStorageConfig, type FilesSignerConfig } from "./files-storage-config.js";
import type { SecretFileSystem } from "./secret-value.js";

export interface AgentKnowledgeImportConfig {
  readonly tenantId: string;
  readonly database: DatabaseConfig;
  readonly signer: FilesSignerConfig;
  readonly individualPath: "/run/agent-knowledge/individual.pdf";
  readonly corporativoPath: "/run/agent-knowledge/corporativo.pdf";
}

export function loadAgentKnowledgeImportConfig(): AgentKnowledgeImportConfig {
  return parseAgentKnowledgeImportConfig(process.env);
}

export function parseAgentKnowledgeImportConfig(
  environment: Readonly<Record<string, string | undefined>>,
  fileSystem?: SecretFileSystem,
): AgentKnowledgeImportConfig {
  const base = z
    .object({
      QCRM_ENV: z.enum(["test", "staging"]),
      QCRM_TENANT_ID: z.string().uuid(),
    })
    .safeParse(environment);
  if (!base.success) {
    throw new ConfigurationError("agent-knowledge-import", ["QCRM_ENV", "QCRM_TENANT_ID"]);
  }
  const { QCRM_ENV: name, QCRM_TENANT_ID: tenantId } = base.data;
  const database = parseDatabaseConfig(
    "agent-knowledge-import",
    { target: "crm", requiresTenant: true },
    name,
    environment,
    fileSystem,
  );
  const url = new URL(database.connectionUrl.expose());
  const suffix = tenantId.replaceAll("-", "");
  if (
    url.pathname !== `/qcrm_t_${suffix}` ||
    decodeURIComponent(url.username) !== `qcrm_r_${suffix}`
  ) {
    throw new ConfigurationError("agent-knowledge-import", [
      "QCRM_DATABASE_URL_FILE",
      "QCRM_TENANT_ID",
    ]);
  }
  const signer = parseFilesStorageConfig(
    "agent-knowledge-import",
    name,
    "signer",
    environment,
    fileSystem,
  );
  const prefix = `qcrm-${suffix}`;
  if (
    signer.role !== "signer" ||
    signer.incomingBucket !== `${prefix}-incoming` ||
    signer.objectsBucket !== `${prefix}-objects` ||
    signer.endpoint !== "http://platform-storage:8333"
  ) {
    throw new ConfigurationError("agent-knowledge-import", ["QCRM_FILES_S3_ENDPOINT"]);
  }
  return Object.freeze({
    tenantId,
    database,
    signer,
    individualPath: "/run/agent-knowledge/individual.pdf" as const,
    corporativoPath: "/run/agent-knowledge/corporativo.pdf" as const,
  });
}
