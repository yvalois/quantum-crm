import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseGhlMigrationAttachmentsConfig } from "./ghl-migration-attachments-config.js";
import type { SecretFileSystem } from "./secret-value.js";

const tenantId = "019b0000-0000-7000-8000-000000000001";
const suffix = tenantId.replaceAll("-", "");
const canary = "synthetic-file-secret-canary";
const environment = {
  QCRM_ENV: "staging",
  QCRM_TENANT_ID: tenantId,
  QCRM_DATABASE_URL_FILE: "/run/secrets/qcrm_database_url",
  QCRM_GHL_LOCATION_ID: "synthetic_location",
  QCRM_GHL_IMPORT_OPERATION_ID: "019b0000-0000-7000-8000-000000000002",
  QCRM_GHL_IMPORT_EXPORT_ID: "019b0000-0000-7000-8000-000000000003",
  QCRM_GHL_IMPORT_ARTIFACT_FILE: "/run/ghl-import/records.qcrm",
  QCRM_GHL_IMPORT_ARTIFACT_SHA256: "a".repeat(64),
  QCRM_GHL_EXPORT_KEY_FILE: "/run/secrets/qcrm_ghl_export_key",
  QCRM_GHL_IMPORT_CURRENCY: "GTQ",
  QCRM_GHL_IMPORT_DEVELOPMENT_EXCEPTION: "true",
  QCRM_FILES_S3_ENDPOINT: "http://platform-storage:8333",
  QCRM_FILES_S3_PUBLIC_ENDPOINT: "https://files.example.test",
  QCRM_FILES_S3_REGION: "us-east-1",
  QCRM_FILES_INCOMING_BUCKET: `qcrm-${suffix}-incoming`,
  QCRM_FILES_OBJECTS_BUCKET: `qcrm-${suffix}-objects`,
  QCRM_FILES_S3_UPLOAD_ACCESS_KEY_FILE: "/run/secrets/qcrm_files_s3_upload_access_key",
  QCRM_FILES_S3_UPLOAD_SECRET_KEY_FILE: "/run/secrets/qcrm_files_s3_upload_secret_key",
  QCRM_FILES_S3_DELIVERY_ACCESS_KEY_FILE: "/run/secrets/qcrm_files_s3_delivery_access_key",
  QCRM_FILES_S3_DELIVERY_SECRET_KEY_FILE: "/run/secrets/qcrm_files_s3_delivery_secret_key",
  QCRM_FILES_S3_PROCESSOR_ACCESS_KEY_FILE: "/run/secrets/qcrm_files_s3_processor_access_key",
  QCRM_FILES_S3_PROCESSOR_SECRET_KEY_FILE: "/run/secrets/qcrm_files_s3_processor_secret_key",
  QCRM_FILES_CLAMAV_HOST: "platform-clamav",
};
const files: SecretFileSystem = {
  lstat: () => ({ size: 64, isFile: () => true, isSymbolicLink: () => false }),
  realpath: (path) => path,
  readFile: (path) => Buffer.from(
    path === resolve(environment.QCRM_DATABASE_URL_FILE)
      ? `postgresql://qcrm_r_${suffix}:synthetic@database/qcrm_t_${suffix}`
      : path === resolve(environment.QCRM_GHL_EXPORT_KEY_FILE) ? "ab".repeat(32) : canary,
  ),
};

describe("GHL attachment storage configuration", () => {
  it("binds private storage buckets and scanner to the selected profile and keeps secrets opaque", () => {
    const config = parseGhlMigrationAttachmentsConfig(environment, files);
    expect(config).toMatchObject({
      mode: "VERIFY", tenantId,
      files: { role: "signer", endpoint: "http://platform-storage:8333", incomingBucket: `qcrm-${suffix}-incoming`, objectsBucket: `qcrm-${suffix}-objects` },
      processor: { role: "processor", clamAv: { host: "platform-clamav" } },
    });
    expect(JSON.stringify(config)).not.toContain(canary);
    expect(JSON.stringify(config)).not.toContain("ab".repeat(32));
  });

  it.each([
    { QCRM_FILES_INCOMING_BUCKET: "qcrm-other-profile-incoming" },
    { QCRM_FILES_OBJECTS_BUCKET: "qcrm-other-profile-objects" },
    { QCRM_FILES_S3_ENDPOINT: "https://external-storage.example.test" },
    { QCRM_FILES_CLAMAV_HOST: "external-scanner.example.test" },
  ])("rejects another profile or an unapproved storage/scanner boundary: %j", (patch) => {
    expect(() => parseGhlMigrationAttachmentsConfig({ ...environment, ...patch }, files)).toThrow();
  });

  it.each([
    { QCRM_ENV: "production" },
    { QCRM_GHL_IMPORT_DEVELOPMENT_EXCEPTION: "false" },
    { QCRM_FILES_S3_SECRET_KEY: "plaintext-secret" },
    { QCRM_UNDECLARED_SETTING: "unexpected" },
    { QCRM_FILES_S3_UPLOAD_SECRET_KEY_FILE: "/tmp/public-key" },
  ])("does not extend the development exception or accept unknown/plaintext settings: %j", (patch) => {
    expect(() => parseGhlMigrationAttachmentsConfig({ ...environment, ...patch }, files)).toThrow();
  });
});
