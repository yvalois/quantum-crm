import { describe, expect, it } from "vitest";

import {
  CompleteFileUploadSchema,
  CreateFileUploadIntentSchema,
  FileSchema,
  FileUploadIntentResponseSchema,
} from "./file.js";

const fileId = "019b0000-0000-7000-8000-000000000901";
const sha256 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("file contracts", () => {
  it("accepts a bounded upload intent without storage or tenant coordinates", () => {
    const intent = CreateFileUploadIntentSchema.parse({
      owner: {
        kind: "existing",
        module: "documents",
        type: "commercial_document",
        id: "019b0000-0000-7000-8000-000000000902",
      },
      fileClass: "DOCUMENT",
      originalName: "ficha.pdf",
      declaredMime: "application/pdf",
      declaredSize: 1_024,
      expectedSha256: sha256,
    });

    expect(intent).not.toHaveProperty("tenantId");
    expect(intent).not.toHaveProperty("bucket");
    expect(intent).not.toHaveProperty("objectKey");
  });

  it("rejects an owner type that does not belong to the selected module", () => {
    expect(
      CreateFileUploadIntentSchema.safeParse({
        owner: {
          kind: "existing",
          module: "documents",
          type: "message",
          id: "019b0000-0000-7000-8000-000000000902",
        },
        fileClass: "IMAGE",
        originalName: "portada.png",
        declaredMime: "image/png",
        declaredSize: 512,
        expectedSha256: sha256,
      }).success,
    ).toBe(false);
  });

  it("enforces the per-class size ceiling", () => {
    expect(
      CreateFileUploadIntentSchema.safeParse({
        owner: { kind: "claim", attachmentClaimId: fileId },
        fileClass: "IMAGE",
        originalName: "enorme.png",
        declaredMime: "image/png",
        declaredSize: 20 * 1024 * 1024 + 1,
        expectedSha256: sha256,
      }).success,
    ).toBe(false);
  });

  it("keeps upload fields opaque and storage coordinates out of the file", () => {
    const file = {
      id: fileId,
      status: "PENDING",
      fileClass: "IMAGE",
      name: "portada.png",
      mimeType: "image/png",
      size: 512,
      sha256,
      createdAt: "2026-10-01T12:00:00Z",
      updatedAt: "2026-10-01T12:00:00Z",
    } as const;
    expect(FileSchema.parse(file)).not.toHaveProperty("bucket");
    expect(
      FileUploadIntentResponseSchema.parse({
        data: {
          file,
          upload: {
            method: "POST",
            url: "https://files.example.test/upload",
            fields: { key: "opaque", policy: "opaque-policy" },
            expiresAt: "2026-10-01T12:10:00Z",
          },
        },
      }).data.upload.fields,
    ).toEqual({ key: "opaque", policy: "opaque-policy" });
  });

  it("accepts server-side version resolution and rejects undeclared fields", () => {
    expect(CompleteFileUploadSchema.safeParse({ checksum: sha256 }).success).toBe(true);
    expect(
      CompleteFileUploadSchema.safeParse({
        versionId: "v1",
        checksum: sha256,
        receipt: "receipt-1",
        bucket: "incoming",
      }).success,
    ).toBe(false);
  });
});
