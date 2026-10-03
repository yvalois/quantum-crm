import { describe, expect, it } from "vitest";

import {
  beginFileDeletion,
  createFileReservation,
  FileStateConflictError,
  FileValidationError,
  markFileAvailable,
  markFileDeleted,
  markFileUploaded,
  quarantineFile,
  recordFileCompletion,
  requestFileDeletion,
  restoreFile,
  startFilePromotion,
  startFileScan,
} from "./index.js";

const fileId = "019b0000-0000-7000-8000-000000000901";
const sha256 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const baseTime = new Date("2026-10-01T12:00:00Z");

function reservation() {
  return createFileReservation({
    id: fileId,
    fileClass: "DOCUMENT",
    owner: {
      kind: "existing",
      module: "documents",
      type: "commercial_document",
      id: "019b0000-0000-7000-8000-000000000902",
    },
    originalName: "ficha.pdf",
    declaredMime: "application/pdf",
    declaredSize: 1_024,
    expectedSha256: sha256,
    incomingObjectKey: `incoming/${fileId}`,
    now: baseTime,
  });
}

function uploaded() {
  const completed = recordFileCompletion({
    file: reservation(),
    incomingVersionId: "incoming-version-1",
    checksum: sha256,
    receipt: "receipt-1",
    now: new Date("2026-10-01T12:01:00Z"),
  });
  return markFileUploaded({
    file: completed,
    observedMime: "application/pdf",
    observedSize: 1_024,
    observedSha256: sha256,
    now: new Date("2026-10-01T12:02:00Z"),
  });
}

function available() {
  const scanning = startFileScan(uploaded(), new Date("2026-10-01T12:03:00Z"));
  const promoting = startFilePromotion({
    file: scanning,
    scannerVersion: "ClamAV 1.5",
    signaturesUpdatedAt: new Date("2026-10-01T11:00:00Z"),
    now: new Date("2026-10-01T12:04:00Z"),
  });
  return markFileAvailable({
    file: promoting,
    objectKey: `objects/${fileId}`,
    objectVersionId: "object-version-1",
    verifiedSha256: sha256,
    now: new Date("2026-10-01T12:05:00Z"),
  });
}

describe("file state", () => {
  it("advances only through the verified upload, scan and promotion path", () => {
    const file = available();

    expect(file.status).toBe("AVAILABLE");
    expect(file.objectVersionId).toBe("object-version-1");
    expect(file.scanVerdict).toBe("CLEAN");
    expect(file.version).toBe(6n);
  });

  it("fails closed when the scanner is unavailable", () => {
    const scanning = startFileScan(uploaded(), new Date("2026-10-01T12:03:00Z"));
    const quarantined = quarantineFile(scanning, new Date("2026-10-01T12:04:00Z"));

    expect(quarantined.status).toBe("QUARANTINED");
    expect(() =>
      markFileAvailable({
        file: quarantined,
        objectKey: `objects/${fileId}`,
        objectVersionId: "v1",
        verifiedSha256: sha256,
        now: new Date("2026-10-01T12:05:00Z"),
      }),
    ).toThrow(FileStateConflictError);
  });

  it("never accepts a second or mismatched uploaded version", () => {
    expect(() =>
      recordFileCompletion({
        file: reservation(),
        incomingVersionId: "v1",
        checksum: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
        receipt: "receipt-1",
        now: new Date("2026-10-01T12:01:00Z"),
      }),
    ).toThrow(FileValidationError);

    const completed = recordFileCompletion({
      file: reservation(),
      incomingVersionId: "v1",
      checksum: sha256,
      receipt: "receipt-1",
      now: new Date("2026-10-01T12:01:00Z"),
    });
    expect(
      recordFileCompletion({
        file: completed,
        incomingVersionId: "v1",
        checksum: sha256,
        receipt: "receipt-1",
        now: new Date("2026-10-01T12:02:00Z"),
      }),
    ).toBe(completed);
    expect(() =>
      recordFileCompletion({
        file: completed,
        incomingVersionId: "v2",
        checksum: sha256,
        receipt: "receipt-2",
        now: new Date("2026-10-01T12:02:00Z"),
      }),
    ).toThrow(FileStateConflictError);
  });

  it("rejects active content and class sizes above the approved ceiling", () => {
    expect(() =>
      createFileReservation({
        id: fileId,
        fileClass: "IMAGE",
        owner: { kind: "claim", attachmentClaimId: fileId },
        originalName: "active.svg",
        declaredMime: "image/svg+xml",
        declaredSize: 512,
        expectedSha256: sha256,
        incomingObjectKey: `incoming/${fileId}`,
        now: baseTime,
      }),
    ).toThrow(FileValidationError);
    expect(() =>
      createFileReservation({
        id: fileId,
        fileClass: "IMAGE",
        owner: { kind: "claim", attachmentClaimId: fileId },
        originalName: "huge.png",
        declaredMime: "image/png",
        declaredSize: 20 * 1024 * 1024 + 1,
        expectedSha256: sha256,
        incomingObjectKey: `incoming/${fileId}`,
        now: baseTime,
      }),
    ).toThrow(FileValidationError);
  });

  it("blocks delivery while scheduled for deletion and honors the grace period", () => {
    const scheduledAt = new Date("2026-10-02T12:00:00Z");
    const scheduled = requestFileDeletion({
      file: available(),
      activeReferenceCount: 0,
      retentionUntil: null,
      legalHold: false,
      now: scheduledAt,
    });
    expect(scheduled.status).toBe("DELETE_SCHEDULED");
    expect(() =>
      beginFileDeletion({
        file: scheduled,
        activeReferenceCount: 0,
        retentionUntil: null,
        legalHold: false,
        now: new Date("2026-10-03T12:00:00Z"),
      }),
    ).toThrow(FileStateConflictError);

    const restored = restoreFile(scheduled, new Date("2026-10-03T12:00:00Z"));
    expect(restored.status).toBe("AVAILABLE");

    const pending = beginFileDeletion({
      file: scheduled,
      activeReferenceCount: 0,
      retentionUntil: null,
      legalHold: false,
      now: new Date("2026-11-02T12:00:00Z"),
    });
    expect(
      markFileDeleted({
        file: pending,
        storageConfirmedAbsent: true,
        now: new Date("2026-11-02T12:01:00Z"),
      }).status,
    ).toBe("DELETED");
  });
});
