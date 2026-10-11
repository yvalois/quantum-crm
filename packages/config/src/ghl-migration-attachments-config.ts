import { ConfigurationError } from "./configuration-error.js";
import {
  parseGhlMigrationImportConfig,
  type GhlMigrationImportConfig,
} from "./ghl-migration-import-config.js";
import {
  filesSignerEnvironmentKeys,
  filesProcessorEnvironmentKeys,
  parseFilesStorageConfig,
  type FilesSignerConfig,
  type FilesProcessorConfig,
} from "./files-storage-config.js";
import type { SecretFileSystem } from "./secret-value.js";
export interface GhlMigrationAttachmentsConfig extends GhlMigrationImportConfig {
  readonly files: FilesSignerConfig;
  readonly processor: FilesProcessorConfig;
}
export function loadGhlMigrationAttachmentsConfig(): GhlMigrationAttachmentsConfig {
  return parseGhlMigrationAttachmentsConfig(
    Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("QCRM_"))),
  );
}
export function parseGhlMigrationAttachmentsConfig(
  environment: Readonly<Record<string, string | undefined>>,
  fileSystem?: SecretFileSystem,
): GhlMigrationAttachmentsConfig {
  const keys = new Set<string>([...filesSignerEnvironmentKeys, ...filesProcessorEnvironmentKeys]);
  const base = parseGhlMigrationImportConfig(
    Object.fromEntries(Object.entries(environment).filter(([key]) => !keys.has(key))),
    fileSystem,
  );
  const files = parseFilesStorageConfig(
    "ghl-attachments",
    environment.QCRM_ENV === "test" ? "test" : "staging",
    "signer",
    environment,
    fileSystem,
  );
  const processor = parseFilesStorageConfig(
    "ghl-attachments",
    environment.QCRM_ENV === "test" ? "test" : "staging",
    "processor",
    environment,
    fileSystem,
  );
  const prefix = `qcrm-${base.tenantId.replaceAll("-", "")}`;
  if (
    files.role !== "signer" ||
    files.incomingBucket !== `${prefix}-incoming` ||
    files.objectsBucket !== `${prefix}-objects` ||
    files.endpoint !== "http://platform-storage:8333" ||
    processor.role !== "processor" ||
    processor.clamAv.host !== "platform-clamav"
  )
    throw new ConfigurationError("ghl-attachments", [
      "QCRM_FILES_INCOMING_BUCKET",
      "QCRM_FILES_OBJECTS_BUCKET",
      "QCRM_FILES_S3_ENDPOINT",
    ]);
  return Object.freeze({ ...base, files, processor });
}
