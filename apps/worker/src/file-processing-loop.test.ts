import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createFileReservation, recordFileCompletion, type FileRecord } from "@quantum-crm/domain";
import type { ClamAvClient, ObjectStorageClient } from "@quantum-crm/files-infrastructure";

import {
  processClaim,
  type FileProcessingLease,
  type FileProcessingRepository,
} from "./file-processing-loop.js";

const now = new Date("2026-10-01T12:00:00.000Z");
const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const checksum = createHash("sha256").update(bytes).digest("base64");

function pendingFile(): FileRecord {
  return recordFileCompletion({
    file: createFileReservation({
      id: "019b0000-0000-7000-8000-000000000001",
      fileClass: "IMAGE",
      owner: {
        kind: "existing",
        module: "documents",
        type: "commercial_document",
        id: "019b0000-0000-7000-8000-000000000002",
      },
      originalName: "image.png",
      declaredMime: "image/png",
      declaredSize: bytes.byteLength,
      expectedSha256: checksum,
      incomingObjectKey: "incoming/019b0000-0000-7000-8000-000000000001",
      now,
    }),
    incomingVersionId: "version-1",
    checksum,
    receipt: "receipt-1",
    now,
  });
}

function harness(scanStatus: "CLEAN" | "INFECTED") {
  const persisted: Array<{ readonly file: FileRecord; readonly outcome: string }> = [];
  const repository: FileProcessingRepository = {
    claimNext: vi.fn(),
    persist: vi.fn(async (input) => {
      persisted.push({ file: input.file, outcome: input.outcome });
      return true;
    }),
  };
  const storage: ObjectStorageClient = {
    reserveUpload: vi.fn(),
    presignDownload: vi.fn(),
    getIncomingVersion: vi.fn(async () => ({
      bytes,
      contentType: "image/png",
      contentLength: bytes.byteLength,
      versionId: "version-1",
    })),
    copyToObjects: vi.fn(async () => "object-version-1"),
    getObjectVersion: vi.fn(async () => ({
      bytes,
      contentType: "image/png",
      contentLength: bytes.byteLength,
      versionId: "object-version-1",
    })),
    deleteIncomingVersion: vi.fn(async () => undefined),
  };
  const scanner: ClamAvClient = {
    ping: vi.fn(async () => undefined),
    version: vi.fn(),
    scan: vi.fn(async () =>
      scanStatus === "CLEAN"
        ? {
            status: "CLEAN" as const,
            version: {
              engine: "1.4.2",
              signatureVersion: "27896",
              signatureDate: new Date("2026-10-01T11:00:00.000Z"),
            },
          }
        : {
            status: "INFECTED" as const,
            signature: "Eicar-Signature",
            version: {
              engine: "1.4.2",
              signatureVersion: "27896",
              signatureDate: new Date("2026-10-01T11:00:00.000Z"),
            },
          },
    ),
  };
  return { repository, storage, scanner, persisted };
}

describe("file processing", () => {
  it("validates, scans, promotes, verifies and only then makes a file available", async () => {
    const test = harness("CLEAN");
    const lease: FileProcessingLease = {
      operationId: "019b0000-0000-7000-8000-000000000003",
      generation: 2,
      file: pendingFile(),
    };
    let clock = now.getTime();
    await processClaim({ ...test, now: () => new Date((clock += 1_000)) }, lease);

    expect(test.persisted.map(({ file }) => file.status)).toEqual([
      "UPLOADED",
      "SCANNING",
      "PROMOTING",
      "AVAILABLE",
    ]);
    expect(test.persisted.at(-1)?.outcome).toBe("SUCCEEDED");
    expect(test.storage.copyToObjects).toHaveBeenCalledWith(
      lease.file.incomingObjectKey,
      "version-1",
      `objects/${lease.file.id}`,
      "image/png",
      checksum,
    );
  });

  it("never promotes malware", async () => {
    const test = harness("INFECTED");
    await processClaim(
      { ...test, now: () => new Date(now.getTime() + 1_000) },
      {
        operationId: "019b0000-0000-7000-8000-000000000003",
        generation: 2,
        file: pendingFile(),
      },
    );

    expect(test.persisted.at(-1)?.file.status).toBe("REJECTED");
    expect(test.persisted.at(-1)?.file.rejectionCode).toBe("MALWARE");
    expect(test.storage.copyToObjects).not.toHaveBeenCalled();
  });
});
