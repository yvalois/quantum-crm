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
    listMediaFolders: async () => [],
    createMediaFolder: async ({ id, actor: creator, parentId, name }) => ({
      id,
      ownerMemberId: creator.memberId,
      parentId,
      name,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    renameMediaFolder: async () => null,
    deleteMediaFolder: async () => false,
    organizeMediaFile: async () => file,
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
      inspectUpload: async () => ({ versionId: "version-1", receipt: '"receipt-1"' }),
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
  it("requires file permissions for folder creation and rejects non-library organization", async () => {
    await expect(
      service(null).createMediaFolder({
        actor,
        permissions: [],
        parentId: null,
        name: "Catálogos",
        idempotencyKey: "folder-1",
        payloadHash: "folder-hash",
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
    await expect(
      service(null).createMediaFolder({
        actor,
        permissions: ["crm:files:upload"],
        parentId: null,
        name: "Catálogos",
        idempotencyKey: "folder-1",
        payloadHash: "folder-hash",
      }),
    ).resolves.toMatchObject({ name: "Catálogos", ownerMemberId: actor.memberId });
    await expect(
      service(pendingFile()).organizeMediaFile({
        actor,
        permissions: ["crm:files:read", "crm:files:upload"],
        fileId: pendingFile().id,
        folderId: null,
        name: "Otro",
        tags: [],
      }),
    ).rejects.toMatchObject({ name: "FileValidationError" });
  });
  it("reserves library media only with upload permission and never exposes pending bytes", async () => {
    const created = await service(null).reserveUpload({
      actor,
      permissions: ["crm:files:upload"],
      owner: { kind: "library" },
      fileClass: "IMAGE",
      originalName: "catalogo.png",
      declaredMime: "image/png",
      declaredSize: 512,
      expectedSha256: sha256,
      idempotencyKey: "idem-library",
      payloadHash: "hash-library",
    });
    expect(created.file.owner).toEqual({ kind: "library" });
    await expect(
      service(created.file).authorizeDownload({
        actor,
        permissions: ["crm:files:read", "crm:files:download"],
        fileId: created.file.id,
      }),
    ).rejects.toBeInstanceOf(FileStateConflictError);
  });
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

  it("fixes the server-observed upload version when the browser cannot expose it", async () => {
    const result = await service(pendingFile()).completeUpload({
      actor,
      permissions: ["crm:files:upload"],
      fileId: pendingFile().id,
      checksum: sha256,
      idempotencyKey: "idem-complete-1",
      payloadHash: "hash-complete-1",
    });

    expect(result.file.incomingVersionId).toBe("version-1");
    expect(result.file.completionReceipt).toBe('"receipt-1"');
  });

  it("hides a file when its owner relationship is not authorized", async () => {
    await expect(
      service(pendingFile(), false).get(actor, ["crm:files:read"], pendingFile().id),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it("authorizes imported attachments through their scoped owner and conversation permission", async () => {
    const file: FileRecord = {
      ...pendingFile(),
      status: "AVAILABLE",
      owner: {
        kind: "existing",
        module: "conversations",
        type: "historical_attachment",
        id: "019b0000-0000-7000-8000-000000000914",
      },
      objectVersionId: "verified-version",
    };
    const viewer: CommercialActor = { ...actor, scope: "ASSIGNED" };
    const permissions: readonly IamPermission[] = [
      "crm:files:read",
      "crm:files:download",
      "crm:conversations:read",
    ];
    await expect(
      service(file).authorizeDownload({ actor: viewer, permissions, fileId: file.id }),
    ).resolves.toMatchObject({ objectVersionId: "verified-version" });
    await expect(
      service(file, false).authorizeDownload({ actor: viewer, permissions, fileId: file.id }),
    ).rejects.toBeInstanceOf(FileNotFoundError);
    await expect(
      service({ ...file, status: "QUARANTINED" }).authorizeDownload({
        actor: viewer,
        permissions,
        fileId: file.id,
      }),
    ).rejects.toBeInstanceOf(FileStateConflictError);
    await expect(
      service(file).authorizeDownload({
        actor: viewer,
        permissions: ["crm:files:read", "crm:files:download"],
        fileId: file.id,
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
    await expect(
      service(file).list(viewer, ["crm:files:read"], { limit: 25 }),
    ).resolves.toMatchObject({
      items: [],
    });
    await expect(
      service(file, false).list(viewer, permissions, { limit: 25 }),
    ).resolves.toMatchObject({
      items: [],
    });
    await expect(
      service(file).reserveUpload({
        actor: viewer,
        permissions: ["crm:files:upload", "crm:conversations:read"],
        owner: file.owner,
        fileClass: file.fileClass,
        originalName: file.originalName,
        declaredMime: file.declaredMime,
        declaredSize: file.declaredSize,
        expectedSha256: file.expectedSha256,
        idempotencyKey: "historical-upload",
        payloadHash: "historical-payload",
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
  });
});
