import type { FileClass, FileOwner } from "@quantum-crm/contracts";

import {
  type FileRecord,
  type FileRejectionCode,
  FileStateConflictError,
  FileValidationError,
} from "./index.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256Base64Pattern = /^[A-Za-z0-9+/]{43}=$/u;
const mimePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;

export const maximumFileBytes: Readonly<Record<FileClass, number>> = Object.freeze({
  IMAGE: 20 * 1024 * 1024,
  AUDIO: 50 * 1024 * 1024,
  DOCUMENT: 50 * 1024 * 1024,
  VIDEO: 250 * 1024 * 1024,
});

const allowedMimeTypes: Readonly<Record<FileClass, readonly string[]>> = Object.freeze({
  IMAGE: Object.freeze(["image/jpeg", "image/png", "image/webp"]),
  AUDIO: Object.freeze(["audio/mpeg", "audio/ogg", "audio/wav", "audio/webm"]),
  DOCUMENT: Object.freeze(["application/pdf", "text/plain", "text/csv"]),
  VIDEO: Object.freeze(["video/mp4", "video/webm"]),
});

function requireDate(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new FileValidationError();
}

function requireState(file: FileRecord, states: readonly FileRecord["status"][]): void {
  if (!states.includes(file.status)) throw new FileStateConflictError();
}

function advance(file: FileRecord, patch: Partial<FileRecord>, now: Date): FileRecord {
  requireDate(now);
  if (now < file.updatedAt) throw new FileValidationError("File time cannot move backwards");
  return Object.freeze({ ...file, ...patch, version: file.version + 1n, updatedAt: now });
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (
    name.length < 1 ||
    name.length > 255 ||
    /[\u0000-\u001f\u007f]/u.test(name) ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw new FileValidationError("Invalid original file name");
  }
  return name;
}

function normalizeMime(fileClass: FileClass, value: string): string {
  const mime = value.trim().toLowerCase();
  if (!mimePattern.test(mime) || !allowedMimeTypes[fileClass].includes(mime)) {
    throw new FileValidationError("File type is not allowed");
  }
  return mime;
}

export function createFileReservation(input: {
  readonly id: string;
  readonly fileClass: FileClass;
  readonly owner: FileOwner;
  readonly originalName: string;
  readonly declaredMime: string;
  readonly declaredSize: number;
  readonly expectedSha256: string;
  readonly incomingObjectKey: string;
  readonly now: Date;
}): FileRecord {
  requireDate(input.now);
  if (!uuidPattern.test(input.id) || !/^[A-Za-z0-9/_-]{16,512}$/u.test(input.incomingObjectKey)) {
    throw new FileValidationError();
  }
  if (
    !Number.isSafeInteger(input.declaredSize) ||
    input.declaredSize < 1 ||
    input.declaredSize > maximumFileBytes[input.fileClass] ||
    !sha256Base64Pattern.test(input.expectedSha256)
  ) {
    throw new FileValidationError();
  }
  return Object.freeze({
    id: input.id,
    status: "PENDING",
    fileClass: input.fileClass,
    owner: structuredClone(input.owner),
    originalName: normalizeName(input.originalName),
    declaredMime: normalizeMime(input.fileClass, input.declaredMime),
    declaredSize: input.declaredSize,
    expectedSha256: input.expectedSha256,
    incomingObjectKey: input.incomingObjectKey,
    incomingVersionId: null,
    completionReceipt: null,
    completionRequestedAt: null,
    observedMime: null,
    observedSize: null,
    observedSha256: null,
    scanVerdict: null,
    scannerVersion: null,
    scannerSignaturesUpdatedAt: null,
    objectKey: null,
    objectVersionId: null,
    rejectionCode: null,
    deleteAfter: null,
    version: 1n,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

export function recordFileCompletion(input: {
  readonly file: FileRecord;
  readonly incomingVersionId: string;
  readonly checksum: string;
  readonly receipt: string;
  readonly now: Date;
}): FileRecord {
  requireState(input.file, ["PENDING"]);
  if (input.file.incomingVersionId !== null) {
    if (
      input.file.incomingVersionId === input.incomingVersionId &&
      input.file.completionReceipt === input.receipt &&
      input.checksum === input.file.expectedSha256
    ) {
      return input.file;
    }
    throw new FileStateConflictError("The upload version is already fixed");
  }
  if (
    input.incomingVersionId.length < 1 ||
    input.incomingVersionId.length > 2_048 ||
    input.receipt.length < 1 ||
    input.receipt.length > 2_048
  ) {
    throw new FileStateConflictError("The upload version is already fixed or invalid");
  }
  if (input.checksum !== input.file.expectedSha256) {
    throw new FileValidationError("Upload checksum does not match the reservation");
  }
  return advance(
    input.file,
    {
      incomingVersionId: input.incomingVersionId,
      completionReceipt: input.receipt,
      completionRequestedAt: input.now,
    },
    input.now,
  );
}

export function markFileUploaded(input: {
  readonly file: FileRecord;
  readonly observedMime: string;
  readonly observedSize: number;
  readonly observedSha256: string;
  readonly now: Date;
}): FileRecord {
  requireState(input.file, ["PENDING"]);
  if (input.file.incomingVersionId === null || input.file.completionReceipt === null) {
    throw new FileStateConflictError("Upload completion has not fixed an incoming version");
  }
  const observedMime = normalizeMime(input.file.fileClass, input.observedMime);
  if (
    observedMime !== input.file.declaredMime ||
    input.observedSize !== input.file.declaredSize ||
    input.observedSha256 !== input.file.expectedSha256
  ) {
    throw new FileValidationError("Observed upload metadata does not match the reservation");
  }
  return advance(
    input.file,
    {
      status: "UPLOADED",
      observedMime,
      observedSize: input.observedSize,
      observedSha256: input.observedSha256,
    },
    input.now,
  );
}

export function startFileScan(file: FileRecord, now: Date): FileRecord {
  requireState(file, ["UPLOADED", "QUARANTINED"]);
  return advance(file, { status: "SCANNING" }, now);
}

export function quarantineFile(file: FileRecord, now: Date): FileRecord {
  requireState(file, ["SCANNING"]);
  return advance(
    file,
    { status: "QUARANTINED", scanVerdict: "UNAVAILABLE", scannerVersion: null },
    now,
  );
}

export function startFilePromotion(input: {
  readonly file: FileRecord;
  readonly scannerVersion: string;
  readonly signaturesUpdatedAt: Date;
  readonly now: Date;
}): FileRecord {
  requireState(input.file, ["SCANNING"]);
  requireDate(input.signaturesUpdatedAt);
  requireDate(input.now);
  const signatureAge = input.now.getTime() - input.signaturesUpdatedAt.getTime();
  if (
    input.scannerVersion.length < 1 ||
    input.scannerVersion.length > 160 ||
    signatureAge < 0 ||
    signatureAge > 48 * 60 * 60 * 1_000
  ) {
    throw new FileValidationError("Scanner signatures are not trustworthy");
  }
  return advance(
    input.file,
    {
      status: "PROMOTING",
      scanVerdict: "CLEAN",
      scannerVersion: input.scannerVersion,
      scannerSignaturesUpdatedAt: input.signaturesUpdatedAt,
    },
    input.now,
  );
}

export function markFileAvailable(input: {
  readonly file: FileRecord;
  readonly objectKey: string;
  readonly objectVersionId: string;
  readonly verifiedSha256: string;
  readonly now: Date;
}): FileRecord {
  requireState(input.file, ["PROMOTING"]);
  if (
    input.file.scanVerdict !== "CLEAN" ||
    input.objectKey.length < 16 ||
    input.objectKey.length > 512 ||
    input.objectVersionId.length < 1 ||
    input.objectVersionId.length > 2_048 ||
    input.verifiedSha256 !== input.file.expectedSha256
  ) {
    throw new FileValidationError("Promoted object is not the verified file");
  }
  return advance(
    input.file,
    {
      status: "AVAILABLE",
      objectKey: input.objectKey,
      objectVersionId: input.objectVersionId,
    },
    input.now,
  );
}

export function rejectFile(
  file: FileRecord,
  rejectionCode: FileRejectionCode,
  now: Date,
): FileRecord {
  requireState(file, ["PENDING", "UPLOADED", "SCANNING", "QUARANTINED", "PROMOTING"]);
  return advance(
    file,
    {
      status: "REJECTED",
      rejectionCode,
      scanVerdict: rejectionCode === "MALWARE" ? "INFECTED" : file.scanVerdict,
    },
    now,
  );
}

export function failFile(file: FileRecord, now: Date): FileRecord {
  requireState(file, ["PENDING", "UPLOADED", "SCANNING", "QUARANTINED", "PROMOTING"]);
  return advance(file, { status: "FAILED" }, now);
}

export function requestFileDeletion(input: {
  readonly file: FileRecord;
  readonly activeReferenceCount: number;
  readonly retentionUntil: Date | null;
  readonly legalHold: boolean;
  readonly now: Date;
}): FileRecord {
  const { file, now } = input;
  if (
    !Number.isSafeInteger(input.activeReferenceCount) ||
    input.activeReferenceCount < 0 ||
    input.activeReferenceCount > 0 ||
    input.legalHold ||
    (input.retentionUntil !== null && input.retentionUntil > now)
  ) {
    throw new FileStateConflictError("File retention or references prevent deletion");
  }
  if (file.status === "AVAILABLE") {
    return advance(
      file,
      {
        status: "DELETE_SCHEDULED",
        deleteAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
      },
      now,
    );
  }
  requireState(file, ["PENDING", "UPLOADED", "QUARANTINED", "REJECTED", "FAILED"]);
  return advance(file, { status: "DELETE_PENDING", deleteAfter: now }, now);
}

export function beginFileDeletion(input: {
  readonly file: FileRecord;
  readonly activeReferenceCount: number;
  readonly retentionUntil: Date | null;
  readonly legalHold: boolean;
  readonly now: Date;
}): FileRecord {
  const { file, now } = input;
  requireState(file, ["DELETE_SCHEDULED"]);
  if (
    file.deleteAfter === null ||
    now < file.deleteAfter ||
    input.activeReferenceCount !== 0 ||
    input.legalHold ||
    (input.retentionUntil !== null && input.retentionUntil > now)
  ) {
    throw new FileStateConflictError("File deletion grace period has not ended");
  }
  return advance(file, { status: "DELETE_PENDING" }, now);
}

export function restoreFile(file: FileRecord, now: Date): FileRecord {
  requireState(file, ["DELETE_SCHEDULED"]);
  if (file.deleteAfter === null || now >= file.deleteAfter) {
    throw new FileStateConflictError("File deletion grace period has ended");
  }
  return advance(file, { status: "AVAILABLE", deleteAfter: null }, now);
}

export function markFileDeleted(input: {
  readonly file: FileRecord;
  readonly storageConfirmedAbsent: boolean;
  readonly now: Date;
}): FileRecord {
  requireState(input.file, ["DELETE_PENDING"]);
  if (!input.storageConfirmedAbsent) {
    throw new FileStateConflictError("Storage absence has not been confirmed");
  }
  return advance(input.file, { status: "DELETED" }, input.now);
}
