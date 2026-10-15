import { createHash } from "node:crypto";

import {
  FileNotFoundError,
  FileStateConflictError,
  FileValidationError,
  type CommercialActor,
  type FileRepository,
} from "@quantum-crm/domain";

import type { ObjectStorageClient } from "./s3-object-storage.js";

export interface OutboundMedia {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly filename: string;
}

/** Files is the only module translating an approved file ID into object bytes. */
export async function readAvailableOutboundMedia(input: {
  readonly files: FileRepository;
  readonly storage: ObjectStorageClient;
  readonly actor: CommercialActor;
  readonly fileId: string;
  readonly conversationId: string;
}): Promise<OutboundMedia> {
  const file = await input.files.find(input.actor, input.fileId);
  if (
    !file ||
    (file.owner.kind !== "library" &&
      !(file.owner.kind === "existing" && file.owner.module === "conversations" &&
        file.owner.type === "conversation" && file.owner.id === input.conversationId))
  ) throw new FileNotFoundError();
  if (file.status !== "AVAILABLE" || !file.objectKey || !file.objectVersionId ||
      !file.observedSha256 || !file.observedMime || !file.observedSize) {
    throw new FileStateConflictError();
  }
  const maxBytes = file.fileClass === "IMAGE" ? 5_000_000 :
    file.fileClass === "AUDIO" ? 16_000_000 : 50_000_000;
  if (file.observedSize > maxBytes) throw new FileValidationError("Media too large for WhatsApp");
  const object = await input.storage.getObjectVersion(file.objectKey, file.objectVersionId, maxBytes);
  if (
    object.bytes.byteLength !== file.observedSize ||
    createHash("sha256").update(object.bytes).digest("base64") !== file.observedSha256
  ) throw new FileValidationError("Stored media checksum differs from validated version");
  return Object.freeze({
    bytes: object.bytes,
    mimeType: file.observedMime,
    filename: file.libraryTitle ?? file.originalName,
  });
}
