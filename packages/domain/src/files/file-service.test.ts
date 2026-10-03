import { describe, expect, it } from "vitest";

import { IamAuthorizationError, type CommercialActor, type IamPermission } from "../iam/index.js";
import {
  FileNotFoundError,
  FileService,
  FileStateConflictError,
  type FileRecord,
  type FileRepository,
} from "./index.js";
import { createFileReservation } from "./file-state.js";

const actor: CommercialActor = {
  memberId: "019b0000-0000-7000-8000-000000000911",
  scope: "PROFILE",
};
const sha256 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function pendingFile(): FileRecord {
  return createFileReservation({
    id: "019b0000-0000-7000-8000-000000000912",
    fileClass: "IMAGE",
    owner: {
      kind: "existing",
      module: "documents",
      type: "commercial_document",
      id: "019b0000-0000-7000-8000-000000000913",
    },
    originalName: "portada.png",
    declaredMime: "image/png",
    declaredSize: 512,
    expectedSha256: sha256,
    incomingObjectKey: "incoming/019b0000-0000-7000-8000-000000000912",
    now: new Date("2026-10-01T12:00:00Z"),
  });
}

function service(file: FileRecord | null, ownerAllowed = true): FileService {
  const repository: FileRepository = {
    list: async () => ({ items: file ? [file] : [], nextCursor: null }),
    find: async () => file,
    reserve: async ({ file: reserved }) => ({ file: reserved, replayed: false }),
    requestCompletion: async ({ file: completed, operation }) => ({
      file: completed,
      operation,
      replayed: false,
    }),
    attachReference: async ({ reference }) => ({ reference, replayed: false }),
  };
  return new FileService(
    repository,
    { canUseOwner: async () => ownerAllowed },
    {
      authorizeUpload: async () => ({
        method: "POST",
        url: "https://files.example.test/upload",
        fields: { policy: "opaque" },
        expiresAt: new Date("2026-10-01T12:10:00Z"),
      }),
      authorizeDownload: async (available) => ({
        method: "GET",
        url: "https://files.example.test/download",
        expiresAt: new Date("2026-10-01T12:01:00Z"),
        objectVersionId: available.objectVersionId ?? "",
      }),
    },
  );
}

describe("file service authorization", () => {
  it("denies upload by default before checking an owner", async () => {
    await expect(
      service(null).reserveUpload({
        actor,
        permissions: [],
        owner: { kind: "claim", attachmentClaimId: actor.memberId },
        fileClass: "IMAGE",
        originalName: "portada.png",
        declaredMime: "image/png",
        declaredSize: 512,
        expectedSha256: sha256,
        idempotencyKey: "idem-1",
        payloadHash: "hash-1",
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
  });

  it("requires the owner relationship even with upload permission", async () => {
    await expect(
      service(null, false).reserveUpload({
        actor,
        permissions: ["crm:files:upload"],
        owner: { kind: "claim", attachmentClaimId: actor.memberId },
        fileClass: "IMAGE",
        originalName: "portada.png",
        declaredMime: "image/png",
        declaredSize: 512,
        expectedSha256: sha256,
        idempotencyKey: "idem-1",
        payloadHash: "hash-1",
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
  });

  it("does not authorize a download until the file is available", async () => {
    const permissions: readonly IamPermission[] = ["crm:files:read", "crm:files:download"];
    await expect(
      service(pendingFile()).authorizeDownload({ actor, permissions, fileId: pendingFile().id }),
    ).rejects.toBeInstanceOf(FileStateConflictError);
  });

  it("hides a file when its owner relationship is not authorized", async () => {
    await expect(
      service(pendingFile(), false).get(actor, ["crm:files:read"], pendingFile().id),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });
});
