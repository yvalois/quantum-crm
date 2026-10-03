import { createHash, randomUUID } from "node:crypto";

import {
  failFile,
  markFileAvailable,
  markFileUploaded,
  quarantineFile,
  rejectFile,
  startFilePromotion,
  startFileScan,
  FileValidationError,
  type FileRecord,
} from "@quantum-crm/domain";
import {
  ClamAvUnavailableError,
  ObjectStorageError,
  type ClamAvClient,
  type ObjectStorageClient,
} from "@quantum-crm/files-infrastructure";

import { detectAllowedMime } from "./file-content-validation.js";

export interface FileProcessingLease {
  readonly operationId: string;
  readonly generation: number;
  readonly file: FileRecord;
}

export interface FileProcessingRepository {
  readonly claimNext: (input: {
    readonly workerId: string;
    readonly leaseSeconds: number;
    readonly now: Date;
  }) => Promise<FileProcessingLease | null>;
  readonly persist: (input: {
    readonly lease: FileProcessingLease;
    readonly file: FileRecord;
    readonly outcome: "CONTINUE" | "RETRY" | "SUCCEEDED" | "FAILED";
    readonly resultCode: string;
    readonly now: Date;
  }) => Promise<boolean>;
}

export interface FileProcessingLoopOptions {
  readonly repository: FileProcessingRepository;
  readonly storage: ObjectStorageClient;
  readonly scanner: ClamAvClient;
  readonly pollIntervalMs: number;
  readonly leaseSeconds: number;
  readonly now?: () => Date;
  readonly workerId?: string;
  readonly onError?: (error: unknown) => void;
}

export interface FileProcessingLoop {
  readonly close: () => Promise<void>;
}

function sha256Base64(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64");
}

function destinationKey(fileId: string): string {
  return `objects/${fileId}`;
}

async function persistOrStop(
  repository: FileProcessingRepository,
  lease: FileProcessingLease,
  file: FileRecord,
  outcome: "CONTINUE" | "RETRY" | "SUCCEEDED" | "FAILED",
  resultCode: string,
  now: Date,
): Promise<void> {
  if (!(await repository.persist({ lease, file, outcome, resultCode, now }))) {
    throw new Error("File processing lease was lost");
  }
}

export async function processClaim(
  options: Pick<FileProcessingLoopOptions, "repository" | "storage" | "scanner" | "now">,
  lease: FileProcessingLease,
): Promise<void> {
  const now = options.now ?? (() => new Date());
  let file = lease.file;
  if (!file.incomingVersionId) {
    const failed = failFile(file, now());
    await persistOrStop(
      options.repository,
      lease,
      failed,
      "FAILED",
      "UPLOAD_VERSION_MISSING",
      now(),
    );
    return;
  }

  let incoming;
  try {
    incoming = await options.storage.getIncomingVersion(
      file.incomingObjectKey,
      file.incomingVersionId,
      file.declaredSize,
    );
  } catch (error) {
    if (error instanceof ObjectStorageError && error.failure === "NOT_FOUND") {
      const rejected = rejectFile(file, "UPLOAD_MISSING", now());
      await persistOrStop(options.repository, lease, rejected, "FAILED", "UPLOAD_MISSING", now());
      return;
    }
    if (error instanceof ObjectStorageError && error.failure === "TOO_LARGE") {
      const rejected = rejectFile(file, "SIZE_MISMATCH", now());
      await persistOrStop(options.repository, lease, rejected, "FAILED", "SIZE_MISMATCH", now());
      return;
    }
    await persistOrStop(options.repository, lease, file, "RETRY", "STORAGE_UNAVAILABLE", now());
    return;
  }

  const observedSha256 = sha256Base64(incoming.bytes);
  if (incoming.contentLength !== file.declaredSize) {
    const rejected = rejectFile(file, "SIZE_MISMATCH", now());
    await persistOrStop(options.repository, lease, rejected, "FAILED", "SIZE_MISMATCH", now());
    return;
  }
  if (observedSha256 !== file.expectedSha256) {
    const rejected = rejectFile(file, "CHECKSUM_MISMATCH", now());
    await persistOrStop(options.repository, lease, rejected, "FAILED", "CHECKSUM_MISMATCH", now());
    return;
  }
  let detectedMime: string;
  try {
    detectedMime = detectAllowedMime(file.fileClass, file.declaredMime, incoming.bytes);
  } catch (error) {
    if (!(error instanceof FileValidationError)) throw error;
    const rejected = rejectFile(file, "TYPE_MISMATCH", now());
    await persistOrStop(options.repository, lease, rejected, "FAILED", "TYPE_MISMATCH", now());
    return;
  }

  if (file.status === "PENDING") {
    file = markFileUploaded({
      file,
      observedMime: detectedMime,
      observedSize: incoming.contentLength,
      observedSha256,
      now: now(),
    });
    await persistOrStop(options.repository, lease, file, "CONTINUE", "UPLOAD_VALIDATED", now());
  }
  if (file.status === "UPLOADED" || file.status === "QUARANTINED") {
    file = startFileScan(file, now());
    await persistOrStop(options.repository, lease, file, "CONTINUE", "SCAN_STARTED", now());
  }
  if (file.status === "SCANNING") {
    let scan;
    try {
      scan = await options.scanner.scan(incoming.bytes);
    } catch (error) {
      if (!(error instanceof ClamAvUnavailableError)) throw error;
      const quarantined = quarantineFile(file, now());
      await persistOrStop(options.repository, lease, quarantined, "RETRY", error.reason, now());
      return;
    }
    if (scan.status === "INFECTED") {
      const rejected = rejectFile(file, "MALWARE", now());
      await persistOrStop(options.repository, lease, rejected, "FAILED", "MALWARE", now());
      return;
    }

    file = startFilePromotion({
      file,
      scannerVersion: `${scan.version.engine}/${scan.version.signatureVersion}`,
      signaturesUpdatedAt: scan.version.signatureDate,
      now: now(),
    });
    await persistOrStop(options.repository, lease, file, "CONTINUE", "PROMOTION_STARTED", now());
  }
  if (file.status !== "PROMOTING") {
    await persistOrStop(options.repository, lease, file, "FAILED", "UNEXPECTED_FILE_STATE", now());
    return;
  }
  const objectKey = destinationKey(file.id);
  let objectVersionId: string;
  try {
    objectVersionId = await options.storage.copyToObjects(
      file.incomingObjectKey,
      file.incomingVersionId!,
      objectKey,
      detectedMime,
      observedSha256,
    );
    const promoted = await options.storage.getObjectVersion(
      objectKey,
      objectVersionId,
      file.declaredSize,
    );
    if (sha256Base64(promoted.bytes) !== observedSha256) {
      throw new ObjectStorageError("INVALID_RESPONSE");
    }
  } catch {
    await persistOrStop(options.repository, lease, file, "RETRY", "PROMOTION_UNCERTAIN", now());
    return;
  }
  file = markFileAvailable({
    file,
    objectKey,
    objectVersionId,
    verifiedSha256: observedSha256,
    now: now(),
  });
  await persistOrStop(options.repository, lease, file, "SUCCEEDED", "AVAILABLE", now());
  await options.storage
    .deleteIncomingVersion(file.incomingObjectKey, file.incomingVersionId!)
    .catch(() => undefined);
}

export function startFileProcessingLoop(options: FileProcessingLoopOptions): FileProcessingLoop {
  const workerId = options.workerId ?? randomUUID();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = Promise.resolve();

  const schedule = () => {
    if (closed) return;
    timer = setTimeout(() => {
      running = tick();
    }, options.pollIntervalMs);
    timer.unref();
  };
  const tick = async (): Promise<void> => {
    if (closed) return;
    try {
      const lease = await options.repository.claimNext({
        workerId,
        leaseSeconds: options.leaseSeconds,
        now: (options.now ?? (() => new Date()))(),
      });
      if (lease) await processClaim(options, lease);
    } catch (error) {
      options.onError?.(error);
    } finally {
      schedule();
    }
  };
  running = tick();
  return Object.freeze({
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  });
}
