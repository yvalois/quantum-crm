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
async function readAvailableConversationMedia(input: {
  readonly files: FileRepository;
  readonly storage: ObjectStorageClient;
  readonly actor: CommercialActor;
  readonly fileId: string;
  readonly conversationId: string;
  readonly inbound: boolean;
}): Promise<OutboundMedia> {
  const file = await input.files.find(input.actor, input.fileId);
  if (
    !file ||
    (input.inbound && file.owner.kind !== "existing") ||
    (file.owner.kind !== "library" &&
      !(
        file.owner.kind === "existing" &&
        file.owner.module === "conversations" &&
        file.owner.type === "conversation" &&
        file.owner.id === input.conversationId
      ))
  )
    throw new FileNotFoundError();
  if (
    file.status !== "AVAILABLE" ||
    !file.objectKey ||
    !file.objectVersionId ||
    !file.observedSha256 ||
    !file.observedMime ||
    !file.observedSize
  ) {
    throw new FileStateConflictError();
  }
  const maxBytes = input.inbound
    ? file.fileClass === "IMAGE" ? 20_000_000 : 25_000_000
    : file.fileClass === "IMAGE" ? 5_000_000 : file.fileClass === "AUDIO" ? 16_000_000 : 50_000_000;
  if (file.observedSize > maxBytes) throw new FileValidationError("Media too large for WhatsApp");
  const object = await input.storage.getObjectVersion(
    file.objectKey,
    file.objectVersionId,
    maxBytes,
  );
  if (
    object.bytes.byteLength !== file.observedSize ||
    createHash("sha256").update(object.bytes).digest("base64") !== file.observedSha256
  )
    throw new FileValidationError("Stored media checksum differs from validated version");
  return Object.freeze({
    bytes: object.bytes,
    mimeType: file.observedMime,
    filename: file.libraryTitle ?? file.originalName,
  });
}

export async function readAvailableOutboundMedia(input: Omit<Parameters<typeof readAvailableConversationMedia>[0], "inbound">): Promise<OutboundMedia> {
  return readAvailableConversationMedia({ ...input, inbound: false });
}

export async function readAvailableInboundMedia(input: Omit<Parameters<typeof readAvailableConversationMedia>[0], "inbound">): Promise<OutboundMedia> {
  return readAvailableConversationMedia({ ...input, inbound: true });
}
