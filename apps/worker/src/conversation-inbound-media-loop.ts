import { createHash, randomUUID } from "node:crypto";

import type { SecretValue } from "@quantum-crm/config";
import {
  FileService,
  type InboundMediaDispatcher,
  type InboundMediaLease,
} from "@quantum-crm/domain";
import {
  readAvailableInboundMedia,
  uploadReservedFile,
  type ObjectStorageClient,
} from "@quantum-crm/files-infrastructure";

import {
  analyzeInboundMedia,
  downloadInboundMedia,
  InboundMediaError,
} from "./ycloud-inbound-media.js";

export interface InboundMediaLoopOptions {
  readonly repository: InboundMediaDispatcher;
  readonly filesFor: (conversationId: string) => FileService;
  readonly fileRepository: ConstructorParameters<typeof FileService>[0];
  readonly storage: ObjectStorageClient;
  readonly ycloudApiKey: SecretValue;
  readonly openAiApiKey: SecretValue;
  readonly actor: Parameters<FileService["get"]>[0];
  readonly pollIntervalMs: number;
  readonly fetcher?: typeof fetch;
  readonly workerId?: string;
  readonly onError?: (error: unknown) => void;
}

const permissions = [
  "crm:files:upload",
  "crm:files:read",
  "crm:files:reference",
  "crm:conversations:reply",
] as const;
const extension = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["audio/mpeg", "mp3"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/webm", "webm"],
]);

export async function processInboundMedia(
  options: InboundMediaLoopOptions,
  lease: InboundMediaLease,
  workerId: string,
): Promise<void> {
  const files = options.filesFor(lease.conversationId);
  const owner = {
    kind: "existing" as const,
    module: "conversations" as const,
    type: "conversation" as const,
    id: lease.conversationId,
  };
  try {
    let fileId = lease.fileId;
    if (!fileId) {
      const bytes = await downloadInboundMedia({
        lease,
        apiKey: options.ycloudApiKey,
        ...(options.fetcher ? { fetcher: options.fetcher } : {}),
      });
      const checksum = createHash("sha256").update(bytes).digest("base64");
      const reserved = await files.reserveUpload({
        actor: options.actor,
        permissions,
        owner,
        fileClass: lease.kind,
        originalName: `whatsapp-${lease.messageId}.${extension.get(lease.declaredMime) ?? "bin"}`,
        declaredMime: lease.declaredMime,
        declaredSize: bytes.byteLength,
        expectedSha256: checksum,
        idempotencyKey: `inbound-media:${lease.messageId}`,
        payloadHash: createHash("sha256")
          .update(`${lease.messageId}:${checksum}:${bytes.byteLength}`)
          .digest("hex"),
      });
      fileId = reserved.file.id;
      if (reserved.file.status === "PENDING" && !reserved.file.incomingVersionId) {
        const receipt = await uploadReservedFile({
          authorization: reserved.upload,
          bytes,
          maxBytes: bytes.byteLength,
          requestTimeoutMs: 30_000,
        });
        await files.completeUpload({
          actor: options.actor,
          permissions,
          fileId,
          checksum,
          ...receipt,
          idempotencyKey: `inbound-media-complete:${lease.messageId}`,
          payloadHash: createHash("sha256").update(`${fileId}:${checksum}`).digest("hex"),
        });
      }
      if (!(await options.repository.bindFile(lease, workerId, fileId)))
        throw new Error("Inbound media lease lost");
      if (!(await options.repository.waitForScan(lease, workerId)))
        throw new Error("Inbound media lease lost");
      return;
    }
    const file = await files.get(options.actor, permissions, fileId);
    if (["PENDING", "UPLOADED", "SCANNING", "QUARANTINED"].includes(file.status)) {
      if (!(await options.repository.waitForScan(lease, workerId)))
        throw new Error("Inbound media lease lost");
      return;
    }
    if (file.status !== "AVAILABLE") throw new InboundMediaError("SOURCE_INTEGRITY");
    const media = await readAvailableInboundMedia({
      files: options.fileRepository,
      storage: options.storage,
      actor: options.actor,
      fileId,
      conversationId: lease.conversationId,
    });
    const analysis = await analyzeInboundMedia({
      lease,
      bytes: media.bytes,
      mimeType: media.mimeType,
      apiKey: options.openAiApiKey,
      ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    });
    await files.attachReference({
      actor: options.actor,
      permissions,
      fileId,
      owner,
      kind: "ATTACHMENT",
      idempotencyKey: `inbound-media-ref:${lease.messageId}`,
      payloadHash: createHash("sha256").update(`${lease.messageId}:${fileId}`).digest("hex"),
    });
    if (!(await options.repository.complete(lease, workerId, fileId, analysis)))
      throw new Error("Inbound media lease lost");
  } catch (error) {
    const code = error instanceof InboundMediaError ? error.code : "MEDIA_PROCESSING_FAILED";
    const retry = !["SOURCE_INTEGRITY", "SOURCE_TOO_LARGE"].includes(code);
    await options.repository.fail(lease, workerId, code, retry);
    throw error;
  }
}

export function startConversationInboundMediaLoop(options: InboundMediaLoopOptions): {
  close: () => Promise<void>;
} {
  const workerId = options.workerId ?? randomUUID();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = Promise.resolve();
  const tick = async (): Promise<void> => {
    if (closed) return;
    try {
      const lease = await options.repository.claimNext(workerId);
      if (lease) await processInboundMedia(options, lease, workerId);
    } catch (error) {
      options.onError?.(error);
    } finally {
      if (!closed) {
        timer = setTimeout(() => {
          running = tick();
        }, options.pollIntervalMs);
        timer.unref();
      }
    }
  };
  running = tick();
  return {
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
