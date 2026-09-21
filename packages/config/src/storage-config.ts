import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import {
  loadSecretFile,
  SecretFileError,
  type SecretFileSystem,
  type SecretValue,
} from "./secret-value.js";
import type { QcrmEnvironment } from "./process-config.js";

const accessKeyFile = "/run/secrets/qcrm_storage_s3_admin_access_key";
const secretKeyFile = "/run/secrets/qcrm_storage_s3_admin_secret_key";

export const storageEnvironmentKeys = Object.freeze([
  "QCRM_STORAGE_S3_ENDPOINT",
  "QCRM_STORAGE_S3_ADMIN_ACCESS_KEY_FILE",
  "QCRM_STORAGE_S3_ADMIN_SECRET_KEY_FILE",
] as const);

export interface StorageConfig {
  readonly schemaVersion: "storage-config/v1";
  readonly endpoint: string;
  readonly adminAccessKey: SecretValue;
  readonly adminSecretKey: SecretValue;
}

export function parseStorageConfig(
  serviceName: string,
  environmentName: QcrmEnvironment,
  environment: Readonly<Record<string, string | undefined>>,
  fileSystem?: SecretFileSystem,
): StorageConfig {
  const endpointResult = z.string().url().safeParse(environment.QCRM_STORAGE_S3_ENDPOINT);
  if (
    !endpointResult.success ||
    !["http:", "https:"].includes(new URL(endpointResult.data).protocol)
  ) {
    throw new ConfigurationError(serviceName, ["QCRM_STORAGE_S3_ENDPOINT"]);
  }
  const files: Array<[string, string | undefined, string, string]> = [
    [
      "QCRM_STORAGE_S3_ADMIN_ACCESS_KEY_FILE",
      environment.QCRM_STORAGE_S3_ADMIN_ACCESS_KEY_FILE,
      accessKeyFile,
      "storage S3 admin access key",
    ],
    [
      "QCRM_STORAGE_S3_ADMIN_SECRET_KEY_FILE",
      environment.QCRM_STORAGE_S3_ADMIN_SECRET_KEY_FILE,
      secretKeyFile,
      "storage S3 admin secret key",
    ],
  ];
  const loaded: SecretValue[] = [];
  for (const [key, path, expectedPath, logicalName] of files) {
    const pathResult = z.string().trim().min(1).safeParse(path);
    if (!pathResult.success) throw new ConfigurationError(serviceName, [key]);
    try {
      const secretOptions = {
        environment: environmentName,
        expectedProtectedPath: expectedPath,
        ...(fileSystem ? { fileSystem } : {}),
      };
      loaded.push(loadSecretFile(logicalName, pathResult.data, secretOptions));
    } catch (error) {
      if (error instanceof SecretFileError) throw new ConfigurationError(serviceName, [key]);
      throw error;
    }
  }
  const [adminAccessKey, adminSecretKey] = loaded;
  if (!adminAccessKey || !adminSecretKey) {
    throw new ConfigurationError(serviceName, ["QCRM_STORAGE_S3_ADMIN_ACCESS_KEY_FILE"]);
  }
  return Object.freeze({
    schemaVersion: "storage-config/v1",
    endpoint: endpointResult.data.replace(/\/$/u, ""),
    adminAccessKey,
    adminSecretKey,
  });
}
