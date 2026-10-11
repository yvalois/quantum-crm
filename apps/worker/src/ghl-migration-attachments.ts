import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type {
  FileService,
  HistoricalConversationService,
  HistoricalImportContext,
  HistoricalAttachmentRecord,
} from "@quantum-crm/domain";
import { uploadReservedFile } from "@quantum-crm/files-infrastructure";
import { downloadGhlAttachment, GhlAttachmentDownloadError } from "./ghl-attachment-download.js";
import { identifier, type GhlImportArtifact } from "./ghl-migration-import-artifact.js";

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export async function importGhlAttachments(input: {
  artifact: GhlImportArtifact;
  context: HistoricalImportContext;
  files: FileService;
  history: HistoricalConversationService;
  checkLock: () => Promise<void>;
  report: (result: Readonly<Record<string, number>>) => void;
  download?: typeof downloadGhlAttachment;
}) {
  const { artifact, context, files, history } = input;
  const tasks = ["MESSAGES_NON_EMAIL", "MESSAGES_EMAIL"].flatMap((stream) =>
    (artifact.records.get(stream as "MESSAGES_NON_EMAIL" | "MESSAGES_EMAIL") ?? []).flatMap(
      (message) => {
        if (message.attachments === undefined || message.attachments === null) return [];
        if (
          !Array.isArray(message.attachments) ||
          message.attachments.some((v) => typeof v !== "string")
        )
          throw new Error("Unsupported attachment source shape");
        return (message.attachments as string[]).map((url, attachmentIndex) => ({
          locationId: artifact.locationId,
          externalMessageId: identifier(message.id),
          attachmentIndex,
          sourceHash: hash(url),
          url,
        }));
      },
    ),
  );
  let processed = 0;
  let transferredBytes = 0;
  let budgetStopped = false;
  const initial = await history.verifyAttachments(context, artifact.locationId);
  let reservedBytes = initial.totalBytes;
  const pending = new Map<string, HistoricalAttachmentRecord>();
  async function reconcile(record: HistoricalAttachmentRecord): Promise<boolean> {
    if (!record.fileId) return true;
    const file = await files.get(context.actor, context.permissions, record.fileId);
    if (file.status === "AVAILABLE") {
      await files.attachReference({
        ...context,
        fileId: file.id,
        owner: {
          kind: "existing",
          module: "conversations",
          type: "historical_attachment",
          id: record.id,
        },
        kind: "ATTACHMENT",
        idempotencyKey: `ghl-attachment-ref:${record.id}`,
        payloadHash: hash(`${record.id}:${file.id}`),
      });
      await history.setAttachmentResult(context, {
        attachmentId: record.id,
        fileId: file.id,
        status: "AVAILABLE",
        errorCode: null,
      });
      return true;
    }
    if (
      ["REJECTED", "FAILED", "DELETED", "DELETE_PENDING", "DELETE_SCHEDULED"].includes(file.status)
    ) {
      await history.setAttachmentResult(context, {
        attachmentId: record.id,
        fileId: file.id,
        status: "REJECTED",
        errorCode: "SCAN_REJECTED",
      });
      return true;
    }
    return false;
  }
  async function transfer(task: (typeof tasks)[number]) {
    await input.checkLock();
    let record = await history.reserveAttachment(context, task);
    if (record.status === "AVAILABLE" || record.status === "REJECTED") {
      processed++;
      return;
    }
    try {
      let current = record.fileId
        ? await files.get(context.actor, context.permissions, record.fileId)
        : null;
      if (!current || (current.status === "PENDING" && current.incomingVersionId === null)) {
        if (
          budgetStopped ||
          transferredBytes >= 5 * 1024 ** 3 ||
          (!record.fileId && reservedBytes >= 8 * 1024 ** 3)
        ) {
          budgetStopped = true;
          processed++;
          return;
        }
        const downloaded = await (input.download ?? downloadGhlAttachment)(task.url);
        const bytes = downloaded.bytes;
        transferredBytes += bytes.length;
        if (
          transferredBytes > 5 * 1024 ** 3 ||
          (!record.fileId && reservedBytes + bytes.length > 8 * 1024 ** 3)
        ) {
          budgetStopped = true;
          processed++;
          return;
        }
        // Claim budget synchronously before another download can reserve against it.
        if (!record.fileId) reservedBytes += bytes.length;
        const checksum = createHash("sha256").update(bytes).digest("base64");
        const payloadHash = hash(`${record.id}:${checksum}:${bytes.length}:${downloaded.mime}`);
        if (current && current.expectedSha256 !== checksum)
          throw new GhlAttachmentDownloadError("SOURCE_UNAVAILABLE");
        await input.checkLock();
        const reservation = await files.reserveUpload({
          ...context,
          owner: {
            kind: "existing",
            module: "conversations",
            type: "historical_attachment",
            id: record.id,
          },
          fileClass: downloaded.fileClass,
          originalName: downloaded.name,
          declaredMime: downloaded.mime,
          declaredSize: bytes.length,
          expectedSha256: checksum,
          idempotencyKey: `ghl-attachment:${record.id}`,
          payloadHash,
        });
        record = await history.setAttachmentResult(context, {
          attachmentId: record.id,
          fileId: reservation.file.id,
          status: "PENDING",
          errorCode: null,
        });
        current = await files.get(context.actor, context.permissions, reservation.file.id);
        if (current.status === "PENDING" && !current.incomingVersionId) {
          const receipt = await uploadReservedFile({
            authorization: reservation.upload,
            bytes,
            maxBytes: bytes.length,
            requestTimeoutMs: 120_000,
          });
          await files.completeUpload({
            ...context,
            fileId: current.id,
            ...receipt,
            checksum,
            idempotencyKey: `ghl-attachment-complete:${record.id}`,
            payloadHash: hash(`${current.id}:${checksum}`),
          });
        }
      }
      if (!(await reconcile(record))) pending.set(record.id, record);
    } catch (error) {
      const code = error instanceof GhlAttachmentDownloadError ? error.code : "TRANSFER_FAILED";
      await history.setAttachmentResult(context, {
        attachmentId: record.id,
        fileId: record.fileId,
        status: code === "UNSUPPORTED_FORMAT" || code === "SIZE_LIMIT" ? "REJECTED" : "FAILED",
        errorCode: code,
      });
    }
    processed++;
  }
  async function report() {
    const status = await history.verifyAttachments(context, artifact.locationId);
    input.report({
      total: tasks.length,
      processed,
      available: status.availableCount,
      rejected: status.rejectedCount,
      failed: status.failedCount,
      pending: status.pendingCount + status.missingCount,
      bytes: transferredBytes,
    });
    return status;
  }
  for (let offset = 0; offset < tasks.length; offset += 2) {
    const settled = await Promise.allSettled(tasks.slice(offset, offset + 2).map(transfer));
    const failed = settled.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    if (processed % 20 === 0) await report();
  }
  const deadline = Date.now() + 20 * 60_000;
  while (pending.size && Date.now() < deadline) {
    await input.checkLock();
    for (const [id, record] of pending) if (await reconcile(record)) pending.delete(id);
    await report();
    if (pending.size) await delay(5_000);
  }
  return report();
}
