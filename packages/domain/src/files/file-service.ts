import { randomUUID } from "node:crypto";

import type { FileClass, FileOwner, FileReferenceKind } from "@quantum-crm/contracts";

import { IamAuthorizationError, type CommercialActor, type IamPermission } from "../iam/index.js";
import {
  type FileListFilters,
  FileNotFoundError,
  type FileOwnerAuthorization,
  type FileRecord,
  type FileRepository,
  type FileStorageAuthorization,
  FileStateConflictError,
  type FileReferenceRecord,
} from "./index.js";
import { createFileReservation, recordFileCompletion } from "./file-state.js";

function allow(permissions: readonly IamPermission[], permission: IamPermission): void {
  if (!permissions.includes(permission)) throw new IamAuthorizationError();
}

function historicalOwner(owner: FileOwner): boolean {
  return owner.kind === "existing" && owner.module === "conversations" &&
    owner.type === "historical_attachment";
}

function allowOwner(
  permissions: readonly IamPermission[],
  owner: FileOwner,
  access: "read" | "write",
): void {
  if (historicalOwner(owner)) {
    allow(permissions, access === "read" ? "crm:conversations:read" : "crm:conversations:configure");
  }
}

export class FileService {
  public constructor(
    private readonly repository: FileRepository,
    private readonly ownerAuthorization: FileOwnerAuthorization,
    private readonly storageAuthorization: FileStorageAuthorization,
  ) {}

  public async list(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    filters: FileListFilters,
  ) {
    allow(permissions, "crm:files:read");
    const page = await this.repository.list(actor, filters);
    const authorized = await Promise.all(page.items.map(async (file) =>
      !historicalOwner(file.owner) || (
        permissions.includes("crm:conversations:read") &&
        await this.ownerAuthorization.canUseOwner(actor, file.owner)
      ),
    ));
    return Object.freeze({
      items: Object.freeze(page.items.filter((_file, index) => authorized[index])),
      nextCursor: page.nextCursor,
    });
  }

  public async get(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    fileId: string,
  ): Promise<FileRecord> {
    allow(permissions, "crm:files:read");
    return this.findAuthorized(actor, fileId, permissions, "read");
  }

  public async reserveUpload(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly owner: FileOwner;
    readonly fileClass: FileClass;
    readonly originalName: string;
    readonly declaredMime: string;
    readonly declaredSize: number;
    readonly expectedSha256: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now?: Date;
  }) {
    allow(input.permissions, "crm:files:upload");
    allowOwner(input.permissions, input.owner, "write");
    if (!(await this.ownerAuthorization.canUseOwner(input.actor, input.owner))) {
      throw new IamAuthorizationError();
    }
    const now = input.now ?? new Date();
    const fileId = randomUUID();
    const file = createFileReservation({
      id: fileId,
      fileClass: input.fileClass,
      owner: input.owner,
      originalName: input.originalName,
      declaredMime: input.declaredMime,
      declaredSize: input.declaredSize,
      expectedSha256: input.expectedSha256,
      incomingObjectKey: `incoming/${fileId}`,
      now,
    });
    const reserved = await this.repository.reserve({
      file,
      actorMemberId: input.actor.memberId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
    return Object.freeze({
      file: reserved.file,
      upload: await this.storageAuthorization.authorizeUpload(reserved.file),
      replayed: reserved.replayed,
    });
  }

  public async completeUpload(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly fileId: string;
    readonly versionId?: string;
    readonly checksum: string;
    readonly receipt?: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now?: Date;
  }) {
    allow(input.permissions, "crm:files:upload");
    const current = await this.findAuthorized(input.actor, input.fileId, input.permissions, "write");
    const observed = await this.storageAuthorization.inspectUpload(current);
    if (
      (input.versionId !== undefined && input.versionId !== observed.versionId) ||
      (input.receipt !== undefined && input.receipt !== observed.receipt)
    ) {
      throw new FileStateConflictError("The uploaded object changed before completion");
    }
    const now = input.now ?? new Date();
    const file = recordFileCompletion({
      file: current,
      incomingVersionId: observed.versionId,
      checksum: input.checksum,
      receipt: observed.receipt,
      now,
    });
    const operation = Object.freeze({
      id: randomUUID(),
      fileId: current.id,
      kind: "PROCESS_UPLOAD" as const,
      status: "PENDING" as const,
      createdAt: now,
      updatedAt: now,
    });
    const result = await this.repository.requestCompletion({
      actor: input.actor,
      file,
      operation,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
    if (!result) throw new FileStateConflictError();
    return result;
  }

  public async authorizeDownload(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly fileId: string;
  }) {
    allow(input.permissions, "crm:files:read");
    allow(input.permissions, "crm:files:download");
    const file = await this.findAuthorized(input.actor, input.fileId, input.permissions, "read");
    if (file.status !== "AVAILABLE" || file.objectVersionId === null) {
      throw new FileStateConflictError("Only an available file can be delivered");
    }
    return this.storageAuthorization.authorizeDownload(file);
  }

  public async attachReference(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly fileId: string;
    readonly owner: Extract<FileOwner, { readonly kind: "existing" }>;
    readonly kind: FileReferenceKind;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now?: Date;
  }): Promise<{ readonly reference: FileReferenceRecord; readonly replayed: boolean }> {
    allow(input.permissions, "crm:files:reference");
    const file = await this.findAuthorized(input.actor, input.fileId, input.permissions, "write");
    allowOwner(input.permissions, input.owner, "write");
    if (file.status !== "AVAILABLE") {
      throw new FileStateConflictError("Only an available file can be referenced");
    }
    if (!(await this.ownerAuthorization.canUseOwner(input.actor, input.owner))) {
      throw new IamAuthorizationError();
    }
    return this.repository.attachReference({
      actor: input.actor,
      reference: Object.freeze({
        id: randomUUID(),
        fileId: file.id,
        owner: structuredClone(input.owner),
        kind: input.kind,
        createdAt: input.now ?? new Date(),
      }),
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
  }

  private async findAuthorized(
    actor: CommercialActor,
    fileId: string,
    permissions: readonly IamPermission[],
    access: "read" | "write",
  ): Promise<FileRecord> {
    const file = await this.repository.find(actor, fileId);
    if (!file || !(await this.ownerAuthorization.canUseOwner(actor, file.owner))) {
      throw new FileNotFoundError();
    }
    allowOwner(permissions, file.owner, access);
    return file;
  }
}
