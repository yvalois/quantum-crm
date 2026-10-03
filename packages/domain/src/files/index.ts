import type { FileClass, FileOwner, FileReferenceKind, FileStatus } from "@quantum-crm/contracts";

import type { CommercialActor } from "../iam/index.js";

export type { FileClass, FileOwner, FileReferenceKind, FileStatus } from "@quantum-crm/contracts";

export type FileScanVerdict = "CLEAN" | "INFECTED" | "UNAVAILABLE" | "UNINSPECTABLE";
export type FileRejectionCode =
  | "CHECKSUM_MISMATCH"
  | "SIZE_MISMATCH"
  | "TYPE_MISMATCH"
  | "MALWARE"
  | "UNINSPECTABLE"
  | "UPLOAD_MISSING"
  | "UPLOAD_RECEIPT_INVALID";

export interface FileRecord {
  readonly id: string;
  readonly status: FileStatus;
  readonly fileClass: FileClass;
  readonly owner: FileOwner;
  readonly originalName: string;
  readonly declaredMime: string;
  readonly declaredSize: number;
  readonly expectedSha256: string;
  readonly incomingObjectKey: string;
  readonly incomingVersionId: string | null;
  readonly completionReceipt: string | null;
  readonly completionRequestedAt: Date | null;
  readonly observedMime: string | null;
  readonly observedSize: number | null;
  readonly observedSha256: string | null;
  readonly scanVerdict: FileScanVerdict | null;
  readonly scannerVersion: string | null;
  readonly scannerSignaturesUpdatedAt: Date | null;
  readonly objectKey: string | null;
  readonly objectVersionId: string | null;
  readonly rejectionCode: FileRejectionCode | null;
  readonly deleteAfter: Date | null;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface FileOperationRecord {
  readonly id: string;
  readonly fileId: string;
  readonly kind: "PROCESS_UPLOAD" | "DELETE";
  readonly status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface FileReferenceRecord {
  readonly id: string;
  readonly fileId: string;
  readonly owner: Extract<FileOwner, { readonly kind: "existing" }>;
  readonly kind: FileReferenceKind;
  readonly createdAt: Date;
}

export interface FileListFilters {
  readonly cursor?: string;
  readonly limit: number;
  readonly status?: FileStatus;
  readonly fileClass?: FileClass;
}

export interface FileListPage {
  readonly items: readonly FileRecord[];
  readonly nextCursor: string | null;
}

export interface FileRepository {
  readonly list: (actor: CommercialActor, filters: FileListFilters) => Promise<FileListPage>;
  readonly find: (actor: CommercialActor, fileId: string) => Promise<FileRecord | null>;
  readonly reserve: (input: {
    readonly file: FileRecord;
    readonly actorMemberId: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<{ readonly file: FileRecord; readonly replayed: boolean }>;
  readonly requestCompletion: (input: {
    readonly actor: CommercialActor;
    readonly file: FileRecord;
    readonly operation: FileOperationRecord;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<{
    readonly file: FileRecord;
    readonly operation: FileOperationRecord;
    readonly replayed: boolean;
  } | null>;
  readonly attachReference: (input: {
    readonly actor: CommercialActor;
    readonly reference: FileReferenceRecord;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<{ readonly reference: FileReferenceRecord; readonly replayed: boolean }>;
}

export interface FileOwnerAuthorization {
  readonly canUseOwner: (actor: CommercialActor, owner: FileOwner) => Promise<boolean>;
}

export interface FileStorageAuthorization {
  readonly authorizeUpload: (file: FileRecord) => Promise<{
    readonly method: "POST";
    readonly url: string;
    readonly fields: Readonly<Record<string, string>>;
    readonly expiresAt: Date;
  }>;
  readonly authorizeDownload: (file: FileRecord) => Promise<{
    readonly method: "GET";
    readonly url: string;
    readonly expiresAt: Date;
    readonly objectVersionId: string;
  }>;
}

export class FileValidationError extends Error {
  public constructor(message = "Invalid file operation") {
    super(message);
    this.name = "FileValidationError";
  }
}

export class FileNotFoundError extends Error {
  public constructor() {
    super("File resource not found");
    this.name = "FileNotFoundError";
  }
}

export class FileStateConflictError extends Error {
  public constructor(message = "File state does not allow this operation") {
    super(message);
    this.name = "FileStateConflictError";
  }
}

export {
  beginFileDeletion,
  createFileReservation,
  failFile,
  markFileAvailable,
  markFileDeleted,
  markFileUploaded,
  quarantineFile,
  recordFileCompletion,
  rejectFile,
  requestFileDeletion,
  restoreFile,
  startFilePromotion,
  startFileScan,
} from "./file-state.js";
export { FileService } from "./file-service.js";
