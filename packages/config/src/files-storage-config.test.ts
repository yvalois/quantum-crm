import { describe, expect, it } from "vitest";

import { ConfigurationError } from "./configuration-error.js";
import { parseFilesStorageConfig } from "./files-storage-config.js";
import type { SecretFileSystem } from "./secret-value.js";

const canary = "test-only-files-secret";
const fileSystem: SecretFileSystem = {
  lstat: () => ({
    size: canary.length,
    isFile: () => true,
    isSymbolicLink: () => false,
  }),
  readFile: () => new TextEncoder().encode(canary),
  realpath: (path) => path,
};

const common = {
  QCRM_FILES_S3_ENDPOINT: "http://platform-storage:8333",
  QCRM_FILES_S3_REGION: "us-east-1",
  QCRM_FILES_INCOMING_BUCKET: "qcrm-profile-a-incoming",
  QCRM_FILES_OBJECTS_BUCKET: "qcrm-profile-a-objects",
};

describe("files storage configuration", () => {
  it("loads separate upload and delivery credentials for the signer", () => {
    const config = parseFilesStorageConfig(
      "api",
      "production",
      "signer",
      {
        ...common,
        QCRM_FILES_S3_PUBLIC_ENDPOINT: "https://files.example.test",
        QCRM_FILES_S3_UPLOAD_ACCESS_KEY_FILE: "/run/secrets/qcrm_files_s3_upload_access_key",
        QCRM_FILES_S3_UPLOAD_SECRET_KEY_FILE: "/run/secrets/qcrm_files_s3_upload_secret_key",
        QCRM_FILES_S3_DELIVERY_ACCESS_KEY_FILE: "/run/secrets/qcrm_files_s3_delivery_access_key",
        QCRM_FILES_S3_DELIVERY_SECRET_KEY_FILE: "/run/secrets/qcrm_files_s3_delivery_secret_key",
      },
      fileSystem,
    );

    expect(config).toMatchObject({
      role: "signer",
      uploadTtlSeconds: 600,
      downloadTtlSeconds: 60,
      incomingBucket: "qcrm-profile-a-incoming",
      objectsBucket: "qcrm-profile-a-objects",
    });
    if (config.role !== "signer") throw new Error("Expected signer configuration");
    expect(config.uploadCredentials.accessKey.expose()).toBe(canary);
    expect(config.deliveryCredentials.secretKey.expose()).toBe(canary);
  });

  it("loads a private processor and ClamAV boundary", () => {
    const config = parseFilesStorageConfig(
      "worker",
      "staging",
      "processor",
      {
        ...common,
        QCRM_FILES_S3_PROCESSOR_ACCESS_KEY_FILE:
          "/run/secrets/qcrm_files_s3_processor_access_key",
        QCRM_FILES_S3_PROCESSOR_SECRET_KEY_FILE:
          "/run/secrets/qcrm_files_s3_processor_secret_key",
        QCRM_FILES_CLAMAV_HOST: "platform-clamav",
      },
      fileSystem,
    );

    expect(config).toMatchObject({
      role: "processor",
      pollIntervalMs: 2_000,
      leaseSeconds: 300,
      clamAv: {
        host: "platform-clamav",
        port: 3310,
        maxSignatureAgeSeconds: 172_800,
      },
    });
  });

  it("rejects a public non-TLS endpoint and shared buckets", () => {
    const signer = {
      ...common,
      QCRM_FILES_S3_PUBLIC_ENDPOINT: "http://files.example.test",
      QCRM_FILES_S3_UPLOAD_ACCESS_KEY_FILE: "/run/secrets/qcrm_files_s3_upload_access_key",
      QCRM_FILES_S3_UPLOAD_SECRET_KEY_FILE: "/run/secrets/qcrm_files_s3_upload_secret_key",
      QCRM_FILES_S3_DELIVERY_ACCESS_KEY_FILE: "/run/secrets/qcrm_files_s3_delivery_access_key",
      QCRM_FILES_S3_DELIVERY_SECRET_KEY_FILE: "/run/secrets/qcrm_files_s3_delivery_secret_key",
    };
    expect(() =>
      parseFilesStorageConfig("api", "production", "signer", signer, fileSystem),
    ).toThrow(new ConfigurationError("api", ["QCRM_FILES_S3_PUBLIC_ENDPOINT"]));

    expect(() =>
      parseFilesStorageConfig(
        "worker",
        "staging",
        "processor",
        { ...common, QCRM_FILES_OBJECTS_BUCKET: common.QCRM_FILES_INCOMING_BUCKET },
        fileSystem,
      ),
    ).toThrow(new ConfigurationError("worker", ["QCRM_FILES_OBJECTS_BUCKET"]));
  });

  it("never exposes secret contents in configuration failures", () => {
    try {
      parseFilesStorageConfig(
        "worker",
        "production",
        "processor",
        {
          ...common,
          QCRM_FILES_S3_PROCESSOR_ACCESS_KEY_FILE: "/tmp/not-authorized",
          QCRM_FILES_S3_PROCESSOR_SECRET_KEY_FILE: "/tmp/not-authorized",
          QCRM_FILES_CLAMAV_HOST: "platform-clamav",
        },
        fileSystem,
      );
    } catch (error) {
      expect(String(error)).not.toContain(canary);
      expect(String(error)).not.toContain("/tmp/not-authorized");
    }
  });
});
