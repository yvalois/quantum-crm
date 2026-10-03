import { describe, expect, it, vi } from "vitest";

import { createS3ObjectStorage, ObjectStorageError } from "./s3-object-storage.js";

const now = new Date("2026-10-01T12:00:00.000Z");
const options = {
  endpoint: "http://platform-storage:8333",
  publicEndpoint: "https://files.example.test",
  region: "us-east-1",
  incomingBucket: "qcrm-profile-a-incoming",
  objectsBucket: "qcrm-profile-a-objects",
  credentials: { accessKey: "test-access", secretKey: "test-secret" },
  requestTimeoutMs: 10_000,
  now: () => now,
};

describe("S3 object storage", () => {
  it("creates a short, exact Browser POST policy without exposing the secret", () => {
    const storage = createS3ObjectStorage(options);
    const authorization = storage.reserveUpload({
      objectKey: "incoming/019b/file-01",
      expectedSha256Base64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      contentType: "image/png",
      maxBytes: 20 * 1024 * 1024,
      expiresInSeconds: 600,
    });
    const policy = JSON.parse(
      Buffer.from(authorization.fields.policy!, "base64").toString("utf8"),
    ) as {
      readonly expiration: string;
      readonly conditions: readonly unknown[];
    };

    expect(authorization.url).toBe("https://files.example.test/qcrm-profile-a-incoming");
    expect(authorization.expiresAt).toBe("2026-10-01T12:10:00.000Z");
    expect(policy.conditions).toContainEqual({ key: "incoming/019b/file-01" });
    expect(policy.conditions).toContainEqual(["content-length-range", 1, 20 * 1024 * 1024]);
    expect(JSON.stringify(authorization)).not.toContain("test-secret");
  });

  it("presigns an exact immutable version for at most 120 seconds", () => {
    const storage = createS3ObjectStorage(options);
    const url = storage.presignDownload({
      objectKey: "objects/019b/file-01",
      versionId: "version-1",
      expiresInSeconds: 60,
      responseContentType: "image/png",
    });

    expect(url).toContain(
      "https://files.example.test/qcrm-profile-a-objects/objects/019b/file-01?",
    );
    expect(url).toContain("versionId=version-1");
    expect(url).toContain("X-Amz-Expires=60");
    expect(url).toContain("X-Amz-Signature=");
    expect(() =>
      storage.presignDownload({
        objectKey: "objects/019b/file-01",
        versionId: "version-1",
        expiresInSeconds: 121,
      }),
    ).toThrow(new ObjectStorageError("INVALID_INPUT"));
  });

  it("reads only the requested incoming version and enforces observed size", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-length": "3",
          "content-type": "image/png",
          "x-amz-version-id": "version-1",
        },
      }),
    );
    const storage = createS3ObjectStorage({ ...options, fetch: fetcher });
    const stored = await storage.getIncomingVersion("incoming/file-01", "version-1", 3);

    expect(stored.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetcher.mock.calls[0]?.[0]).toContain("versionId=version-1");
    expect(String(fetcher.mock.calls[0]?.[1]?.headers)).not.toContain("test-secret");
    await expect(storage.getIncomingVersion("incoming/file-01", "version-1", 2)).rejects.toEqual(
      new ObjectStorageError("TOO_LARGE"),
    );
  });

  it("rejects caller-controlled traversal and insecure public endpoints", () => {
    const storage = createS3ObjectStorage(options);
    expect(() =>
      storage.reserveUpload({
        objectKey: "../another-profile/object",
        expectedSha256Base64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        contentType: "image/png",
        maxBytes: 1,
        expiresInSeconds: 60,
      }),
    ).toThrow(new ObjectStorageError("INVALID_INPUT"));
    expect(() =>
      createS3ObjectStorage({ ...options, publicEndpoint: "http://files.example.test" }),
    ).toThrow(new ObjectStorageError("INVALID_INPUT"));
  });
});
