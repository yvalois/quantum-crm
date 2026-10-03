import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import {
  loadSecretFile,
  SecretFileError,
  type SecretFileSystem,
  type SecretValue,
} from "./secret-value.js";
import type { QcrmEnvironment } from "./process-config.js";

const uploadAccessKeyPath = "/run/secrets/qcrm_files_s3_upload_access_key";
const uploadSecretKeyPath = "/run/secrets/qcrm_files_s3_upload_secret_key";
const deliveryAccessKeyPath = "/run/secrets/qcrm_files_s3_delivery_access_key";
const deliverySecretKeyPath = "/run/secrets/qcrm_files_s3_delivery_secret_key";
const processorAccessKeyPath = "/run/secrets/qcrm_files_s3_processor_access_key";
const processorSecretKeyPath = "/run/secrets/qcrm_files_s3_processor_secret_key";

const commonEnvironmentKeys = [
  "QCRM_FILES_S3_ENDPOINT",
  "QCRM_FILES_S3_REGION",
  "QCRM_FILES_INCOMING_BUCKET",
  "QCRM_FILES_OBJECTS_BUCKET",
  "QCRM_FILES_S3_REQUEST_TIMEOUT_MS",
] as const;

export const filesSignerEnvironmentKeys = Object.freeze([
  ...commonEnvironmentKeys,
  "QCRM_FILES_S3_PUBLIC_ENDPOINT",
  "QCRM_FILES_UPLOAD_TTL_SECONDS",
  "QCRM_FILES_DOWNLOAD_TTL_SECONDS",
  "QCRM_FILES_S3_UPLOAD_ACCESS_KEY_FILE",
  "QCRM_FILES_S3_UPLOAD_SECRET_KEY_FILE",
  "QCRM_FILES_S3_DELIVERY_ACCESS_KEY_FILE",
  "QCRM_FILES_S3_DELIVERY_SECRET_KEY_FILE",
] as const);

export const filesProcessorEnvironmentKeys = Object.freeze([
  ...commonEnvironmentKeys,
  "QCRM_FILES_S3_PROCESSOR_ACCESS_KEY_FILE",
  "QCRM_FILES_S3_PROCESSOR_SECRET_KEY_FILE",
  "QCRM_FILES_CLAMAV_HOST",
  "QCRM_FILES_CLAMAV_PORT",
  "QCRM_FILES_CLAMAV_TIMEOUT_MS",
  "QCRM_FILES_CLAMAV_MAX_SIGNATURE_AGE_SECONDS",
  "QCRM_FILES_WORKER_POLL_INTERVAL_MS",
  "QCRM_FILES_WORKER_LEASE_SECONDS",
] as const);

export interface FilesStorageCredentials {
  readonly accessKey: SecretValue;
  readonly secretKey: SecretValue;
}

interface FilesStorageCommonConfig {
  readonly schemaVersion: "files-storage-config/v1";
  readonly endpoint: string;
  readonly region: string;
  readonly incomingBucket: string;
  readonly objectsBucket: string;
  readonly requestTimeoutMs: number;
}

export interface FilesSignerConfig extends FilesStorageCommonConfig {
  readonly role: "signer";
  readonly publicEndpoint: string;
  readonly uploadTtlSeconds: number;
  readonly downloadTtlSeconds: number;
  readonly uploadCredentials: FilesStorageCredentials;
  readonly deliveryCredentials: FilesStorageCredentials;
}

export interface FilesProcessorConfig extends FilesStorageCommonConfig {
  readonly role: "processor";
  readonly processorCredentials: FilesStorageCredentials;
  readonly clamAv: {
    readonly host: string;
    readonly port: number;
    readonly timeoutMs: number;
    readonly maxSignatureAgeSeconds: number;
  };
  readonly pollIntervalMs: number;
  readonly leaseSeconds: number;
}

export type FilesStorageConfig = FilesSignerConfig | FilesProcessorConfig;
export type FilesStorageRole = FilesStorageConfig["role"];

const endpointSchema = z
  .string()
  .url()
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol));
const safeNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9.-]+$/u);

function loadCredential(
  serviceName: string,
  environmentName: QcrmEnvironment,
  environment: Readonly<Record<string, string | undefined>>,
  accessKeyName: string,
  secretKeyName: string,
  expectedAccessKeyPath: string,
  expectedSecretKeyPath: string,
  fileSystem?: SecretFileSystem,
): FilesStorageCredentials {
  const accessKeyFile = environment[accessKeyName];
  const secretKeyFile = environment[secretKeyName];
  const invalidKeys = [
    ...(z.string().trim().min(1).safeParse(accessKeyFile).success ? [] : [accessKeyName]),
    ...(z.string().trim().min(1).safeParse(secretKeyFile).success ? [] : [secretKeyName]),
  ];
  if (invalidKeys.length > 0 || !accessKeyFile || !secretKeyFile) {
    throw new ConfigurationError(serviceName, invalidKeys);
  }
  try {
    const common = { environment: environmentName, ...(fileSystem ? { fileSystem } : {}) };
    return Object.freeze({
      accessKey: loadSecretFile("files S3 access key", accessKeyFile, {
        ...common,
        expectedProtectedPath: expectedAccessKeyPath,
        maxBytes: 256,
      }),
      secretKey: loadSecretFile("files S3 secret key", secretKeyFile, {
        ...common,
        expectedProtectedPath: expectedSecretKeyPath,
        maxBytes: 256,
      }),
    });
  } catch (error) {
    if (error instanceof SecretFileError) {
      throw new ConfigurationError(serviceName, [accessKeyName, secretKeyName]);
    }
    throw error;
  }
}

export function parseFilesStorageConfig(
  serviceName: string,
  environmentName: QcrmEnvironment,
  role: FilesStorageRole,
  environment: Readonly<Record<string, string | undefined>>,
  fileSystem?: SecretFileSystem,
): FilesStorageConfig {
  const commonSchema = z.object({
    QCRM_FILES_S3_ENDPOINT: endpointSchema,
    QCRM_FILES_S3_REGION: z.string().trim().min(1).max(64).default("us-east-1"),
    QCRM_FILES_INCOMING_BUCKET: safeNameSchema,
    QCRM_FILES_OBJECTS_BUCKET: safeNameSchema,
    QCRM_FILES_S3_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(60_000)
      .default(10_000),
  });
  const commonResult = commonSchema.safeParse(environment);
  if (!commonResult.success) {
    throw new ConfigurationError(
      serviceName,
      [...new Set(commonResult.error.issues.map((issue) => String(issue.path[0])))].sort(),
    );
  }
  const common = {
    schemaVersion: "files-storage-config/v1" as const,
    endpoint: commonResult.data.QCRM_FILES_S3_ENDPOINT.replace(/\/$/u, ""),
    region: commonResult.data.QCRM_FILES_S3_REGION,
    incomingBucket: commonResult.data.QCRM_FILES_INCOMING_BUCKET,
    objectsBucket: commonResult.data.QCRM_FILES_OBJECTS_BUCKET,
    requestTimeoutMs: commonResult.data.QCRM_FILES_S3_REQUEST_TIMEOUT_MS,
  };
  if (common.incomingBucket === common.objectsBucket) {
    throw new ConfigurationError(serviceName, ["QCRM_FILES_OBJECTS_BUCKET"]);
  }

  if (role === "signer") {
    const roleResult = z
      .object({
        QCRM_FILES_S3_PUBLIC_ENDPOINT: endpointSchema.refine(
          (value) => new URL(value).protocol === "https:",
        ),
        QCRM_FILES_UPLOAD_TTL_SECONDS: z.coerce.number().int().min(30).max(600).default(600),
        QCRM_FILES_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().min(15).max(120).default(60),
      })
      .safeParse(environment);
    if (!roleResult.success) {
      throw new ConfigurationError(
        serviceName,
        [...new Set(roleResult.error.issues.map((issue) => String(issue.path[0])))].sort(),
      );
    }
    return Object.freeze({
      ...common,
      role,
      publicEndpoint: roleResult.data.QCRM_FILES_S3_PUBLIC_ENDPOINT.replace(/\/$/u, ""),
      uploadTtlSeconds: roleResult.data.QCRM_FILES_UPLOAD_TTL_SECONDS,
      downloadTtlSeconds: roleResult.data.QCRM_FILES_DOWNLOAD_TTL_SECONDS,
      uploadCredentials: loadCredential(
        serviceName,
        environmentName,
        environment,
        "QCRM_FILES_S3_UPLOAD_ACCESS_KEY_FILE",
        "QCRM_FILES_S3_UPLOAD_SECRET_KEY_FILE",
        uploadAccessKeyPath,
        uploadSecretKeyPath,
        fileSystem,
      ),
      deliveryCredentials: loadCredential(
        serviceName,
        environmentName,
        environment,
        "QCRM_FILES_S3_DELIVERY_ACCESS_KEY_FILE",
        "QCRM_FILES_S3_DELIVERY_SECRET_KEY_FILE",
        deliveryAccessKeyPath,
        deliverySecretKeyPath,
        fileSystem,
      ),
    });
  }

  const roleResult = z
    .object({
      QCRM_FILES_CLAMAV_HOST: z.string().trim().min(1).max(253),
      QCRM_FILES_CLAMAV_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
      QCRM_FILES_CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
      QCRM_FILES_CLAMAV_MAX_SIGNATURE_AGE_SECONDS: z.coerce
        .number()
        .int()
        .min(3_600)
        .max(172_800)
        .default(172_800),
      QCRM_FILES_WORKER_POLL_INTERVAL_MS: z.coerce
        .number()
        .int()
        .min(250)
        .max(60_000)
        .default(2_000),
      QCRM_FILES_WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
    })
    .safeParse(environment);
  if (!roleResult.success) {
    throw new ConfigurationError(
      serviceName,
      [...new Set(roleResult.error.issues.map((issue) => String(issue.path[0])))].sort(),
    );
  }
  return Object.freeze({
    ...common,
    role,
    processorCredentials: loadCredential(
      serviceName,
      environmentName,
      environment,
      "QCRM_FILES_S3_PROCESSOR_ACCESS_KEY_FILE",
      "QCRM_FILES_S3_PROCESSOR_SECRET_KEY_FILE",
      processorAccessKeyPath,
      processorSecretKeyPath,
      fileSystem,
    ),
    clamAv: Object.freeze({
      host: roleResult.data.QCRM_FILES_CLAMAV_HOST,
      port: roleResult.data.QCRM_FILES_CLAMAV_PORT,
      timeoutMs: roleResult.data.QCRM_FILES_CLAMAV_TIMEOUT_MS,
      maxSignatureAgeSeconds: roleResult.data.QCRM_FILES_CLAMAV_MAX_SIGNATURE_AGE_SECONDS,
    }),
    pollIntervalMs: roleResult.data.QCRM_FILES_WORKER_POLL_INTERVAL_MS,
    leaseSeconds: roleResult.data.QCRM_FILES_WORKER_LEASE_SECONDS,
  });
}
