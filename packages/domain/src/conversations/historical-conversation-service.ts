import type { FileOwner } from "@quantum-crm/contracts";
import { IamAuthorizationError, withSourceParticipants, type ExternalParticipantLookup, type SourceParticipantRecord, type CommercialActor, type IamPermission } from "../iam/index.js";
import {
  authorizeHistoricalImport,
  HistoricalImportValidationError,
  validateHistoricalSource,
  type HistoricalImportContext,
  type HistoricalImportResult,
  type HistoricalImportSource,
} from "../shared/historical-import.js";

export interface HistoricalThreadInput {
  readonly sourceThreadPresent: boolean;
  readonly contactId: string | null;
  readonly sourceContactId: string | null;
  readonly assigneeMemberId: string | null;
  readonly rawChannel: string | null;
  readonly rawStatus: string | null;
  readonly subject: string | null;
  readonly sourceCreatedAt: Date | null;
  readonly sourceUpdatedAt: Date | null;
}

export interface HistoricalMessageInput {
  readonly sourceContactId: string | null;
  readonly rawChannel: string | null;
  readonly rawType: string | null;
  readonly rawDirection: string | null;
  readonly rawStatus: string | null;
  readonly body: string;
  readonly attachmentCount: number;
  readonly sourceCreatedAt: Date | null;
  readonly sourceUpdatedAt: Date | null;
}

export interface HistoricalThreadRecord extends Omit<HistoricalThreadInput, "sourceContactId">, SourceParticipantRecord {
  readonly id: string;
  readonly source: "GHL";
  readonly sourceExternalId: string;
  readonly messageCount: number;
  readonly lastMessageAt: Date | null;
  readonly importedAt: Date;
}

export interface HistoricalMessageRecord extends Omit<HistoricalMessageInput, "sourceContactId"> {
  readonly id: string;
  readonly threadId: string;
  readonly sourceExternalId: string;
  readonly importedAt: Date;
  readonly attachments: readonly HistoricalAttachmentRecord[];
}

export const historicalAttachmentErrorCodes = [
  "SOURCE_UNAVAILABLE",
  "UNSUPPORTED_FORMAT",
  "SIZE_LIMIT",
  "CHECKSUM_MISMATCH",
  "SCAN_REJECTED",
  "SCAN_PENDING",
  "TRANSFER_FAILED",
  "SOURCE_CHANGED",
] as const;
export type HistoricalAttachmentErrorCode = (typeof historicalAttachmentErrorCodes)[number];
export type HistoricalAttachmentStatus = "PENDING" | "AVAILABLE" | "REJECTED" | "FAILED";
export interface HistoricalAttachmentRecord {
  readonly id: string;
  readonly messageId: string;
  readonly attachmentIndex: number;
  readonly sourceHash: string;
  readonly fileId: string | null;
  readonly status: HistoricalAttachmentStatus;
  readonly errorCode: HistoricalAttachmentErrorCode | null;
  readonly name: string | null;
  readonly mimeType: string | null;
  readonly size: number | null;
}
export interface ReserveHistoricalAttachmentInput {
  readonly locationId: string;
  readonly externalMessageId: string;
  readonly attachmentIndex: number;
  readonly sourceHash: string;
}
export interface SetHistoricalAttachmentResultInput {
  readonly attachmentId: string;
  readonly fileId: string | null;
  readonly status: HistoricalAttachmentStatus;
  readonly errorCode: HistoricalAttachmentErrorCode | null;
}
export interface HistoricalAttachmentVerification {
  readonly totalBytes: number;
  readonly expectedCount: number;
  readonly reservedCount: number;
  readonly availableCount: number;
  readonly pendingCount: number;
  readonly rejectedCount: number;
  readonly failedCount: number;
  readonly missingCount: number;
}
export interface HistoricalAttachmentFiles {
  readonly fileForAttachment: (
    actor: CommercialActor,
    fileId: string,
  ) => Promise<{
    readonly id: string;
    readonly status: string;
    readonly owner: FileOwner;
    readonly originalName: string;
    readonly mimeType: string;
    readonly size: number;
  } | null>;
}

export interface HistoricalPageQuery {
  readonly limit: number;
  readonly cursor?: string;
}
export interface HistoricalThreadQuery extends HistoricalPageQuery {
  readonly contactState?: "ALL" | "LINKED" | "UNLINKED";
  readonly contactId?: string;
  readonly query?: string;
}
export interface HistoricalPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}
export interface ImportHistoricalThreadInput extends HistoricalImportContext {
  readonly source: HistoricalImportSource;
  readonly thread: HistoricalThreadInput;
}
export interface ImportHistoricalMessageInput extends HistoricalImportContext {
  readonly source: HistoricalImportSource;
  readonly threadSourceExternalId: string;
  readonly message: HistoricalMessageInput;
}
export interface HistoricalConversationImportVerification {
  readonly threadCount: number;
  readonly messageCount: number;
  readonly mappedThreadCount: number;
  readonly mappedMessageCount: number;
  readonly unresolvedThreadCount: number;
  readonly unresolvedContactThreadCount: number;
  readonly inconsistentMessageCount: number;
  readonly invalidParentCount: number;
  readonly outboxCount: number;
}
export interface HistoricalConversationRepository {
  readonly reserveAttachment: (
    context: HistoricalImportContext,
    input: ReserveHistoricalAttachmentInput,
  ) => Promise<HistoricalAttachmentRecord>;
  readonly findAttachment: (
    actor: CommercialActor,
    id: string,
  ) => Promise<HistoricalAttachmentRecord | null>;
  readonly setAttachmentResult: (
    context: HistoricalImportContext,
    input: SetHistoricalAttachmentResultInput & {
      readonly name: string | null;
      readonly mimeType: string | null;
      readonly size: number | null;
    },
  ) => Promise<HistoricalAttachmentRecord>;
  readonly verifyAttachments: (locationId: string) => Promise<HistoricalAttachmentVerification>;
  readonly importThread: (input: ImportHistoricalThreadInput) => Promise<HistoricalImportResult>;
  readonly importMessage: (input: ImportHistoricalMessageInput) => Promise<HistoricalImportResult>;
  readonly list: (
    actor: CommercialActor,
    query: HistoricalThreadQuery,
  ) => Promise<HistoricalPage<HistoricalThreadRecord>>;
  readonly find: (actor: CommercialActor, id: string) => Promise<HistoricalThreadRecord | null>;
  readonly messages: (
    actor: CommercialActor,
    id: string,
    query: HistoricalPageQuery,
  ) => Promise<HistoricalPage<HistoricalMessageRecord> | null>;
  readonly verifyImports: (locationId: string) => Promise<HistoricalConversationImportVerification>;
}
export interface HistoricalConversationReferences {
  readonly contactExistsFor: (actor: CommercialActor, contactId: string) => Promise<boolean>;
  readonly isActiveMember: (memberId: string) => Promise<boolean>;
}

export class HistoricalConversationNotFoundError extends Error {
  public constructor() {
    super("Historical conversation not found");
    this.name = "HistoricalConversationNotFoundError";
  }
}

export class HistoricalAttachmentConflictError extends Error {
  public constructor() {
    super("Historical attachment identity conflict");
    this.name = "HistoricalAttachmentConflictError";
  }
}

function text(value: string | null, max: number): void {
  if (
    value !== null &&
    (typeof value !== "string" || value.length > max || value.includes("\u0000"))
  )
    throw new HistoricalImportValidationError();
}
function dates(input: {
  readonly sourceCreatedAt: Date | null;
  readonly sourceUpdatedAt: Date | null;
}): void {
  for (const value of [input.sourceCreatedAt, input.sourceUpdatedAt]) {
    if (value !== null && (!(value instanceof Date) || !Number.isFinite(value.getTime())))
      throw new HistoricalImportValidationError();
  }
}
function id(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value))
    throw new HistoricalImportValidationError();
}
function read(permissions: readonly IamPermission[], query?: HistoricalPageQuery): void {
  if (!permissions.includes("crm:conversations:read")) throw new IamAuthorizationError();
  if (
    query &&
    (!Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100 ||
      (query.cursor !== undefined && !/^[A-Za-z0-9_-]{1,512}$/u.test(query.cursor)))
  )
    throw new HistoricalImportValidationError();
}

/** Historical imports never call live create/send commands or emit an external effect. */
export class HistoricalConversationService {
  public constructor(
    private readonly repository: HistoricalConversationRepository,
    private readonly references: HistoricalConversationReferences,
    private readonly files?: HistoricalAttachmentFiles,
    private readonly sourceParticipants?: ExternalParticipantLookup,
  ) {}

  public async reserveAttachment(
    context: HistoricalImportContext,
    input: ReserveHistoricalAttachmentInput,
  ) {
    authorizeHistoricalImport(context, "crm:conversations:configure");
    if (
      !/^[A-Za-z0-9_-]{1,200}$/u.test(input.locationId) ||
      !/^[A-Za-z0-9_.:-]{1,300}$/u.test(input.externalMessageId) ||
      !/^[a-f0-9]{64}$/u.test(input.sourceHash) ||
      !Number.isSafeInteger(input.attachmentIndex) ||
      input.attachmentIndex < 0
    )
      throw new HistoricalImportValidationError();
    return this.repository.reserveAttachment(context, input);
  }

  /** The files module calls this for every delivery; scope comes from the parent thread. */
  public async canUseAttachmentOwner(
    actor: CommercialActor,
    attachmentId: string,
  ): Promise<boolean> {
    id(attachmentId);
    return (await this.repository.findAttachment(actor, attachmentId)) !== null;
  }

  public async setAttachmentResult(
    context: HistoricalImportContext,
    input: SetHistoricalAttachmentResultInput,
  ) {
    authorizeHistoricalImport(context, "crm:conversations:configure");
    id(input.attachmentId);
    if (
      !["PENDING", "AVAILABLE", "REJECTED", "FAILED"].includes(input.status) ||
      (input.errorCode !== null && !historicalAttachmentErrorCodes.includes(input.errorCode)) ||
      (input.status === "AVAILABLE" && (input.fileId === null || input.errorCode !== null))
    )
      throw new HistoricalImportValidationError();
    const current = await this.repository.findAttachment(context.actor, input.attachmentId);
    if (!current) throw new HistoricalConversationNotFoundError();
    if (current.fileId !== null && input.fileId !== current.fileId)
      throw new HistoricalAttachmentConflictError();
    let name: string | null = null;
    let mimeType: string | null = null;
    let size: number | null = null;
    if (input.fileId !== null) {
      id(input.fileId);
      const file = await this.files?.fileForAttachment(context.actor, input.fileId);
      if (
        !file ||
        file.id !== input.fileId ||
        file.owner.kind !== "existing" ||
        file.owner.module !== "conversations" ||
        file.owner.type !== "historical_attachment" ||
        file.owner.id !== input.attachmentId ||
        (input.status === "AVAILABLE" && file.status !== "AVAILABLE")
      )
        throw new HistoricalAttachmentConflictError();
      name = file.originalName;
      mimeType = file.mimeType;
      size = file.size;
      text(name, 255);
      text(mimeType, 160);
      if (!Number.isSafeInteger(size) || size < 1) throw new HistoricalImportValidationError();
    }
    return this.repository.setAttachmentResult(context, { ...input, name, mimeType, size });
  }

  public async verifyAttachments(context: HistoricalImportContext, locationId: string) {
    authorizeHistoricalImport(context, "crm:conversations:configure");
    if (!/^[A-Za-z0-9_-]{1,200}$/u.test(locationId)) throw new HistoricalImportValidationError();
    return this.repository.verifyAttachments(locationId);
  }

  public async importThread(input: ImportHistoricalThreadInput): Promise<HistoricalImportResult> {
    authorizeHistoricalImport(input, "crm:conversations:configure");
    validateHistoricalSource(input.source);
    const thread = input.thread;
    if (typeof thread.sourceThreadPresent !== "boolean")
      throw new HistoricalImportValidationError();
    dates(thread);
    text(thread.sourceContactId, 300);
    text(thread.rawChannel, 200);
    text(thread.rawStatus, 200);
    text(thread.subject, 16_000);
    if (thread.contactId !== null) {
      id(thread.contactId);
      if (!(await this.references.contactExistsFor(input.actor, thread.contactId)))
        throw new HistoricalConversationNotFoundError();
    }
    if (thread.assigneeMemberId !== null) {
      id(thread.assigneeMemberId);
      if (!(await this.references.isActiveMember(thread.assigneeMemberId)))
        throw new HistoricalConversationNotFoundError();
    }
    return this.repository.importThread(input);
  }

  public async importMessage(input: ImportHistoricalMessageInput): Promise<HistoricalImportResult> {
    authorizeHistoricalImport(input, "crm:conversations:configure");
    validateHistoricalSource(input.source);
    if (!/^[A-Za-z0-9_.:-]{1,300}$/u.test(input.threadSourceExternalId))
      throw new HistoricalImportValidationError();
    const message = input.message;
    dates(message);
    text(message.sourceContactId, 300);
    for (const value of [
      message.rawChannel,
      message.rawType,
      message.rawDirection,
      message.rawStatus,
    ])
      text(value, 200);
    text(message.body, 1_000_000);
    if (
      typeof message.body !== "string" ||
      !Number.isSafeInteger(message.attachmentCount) ||
      message.attachmentCount < 0
    )
      throw new HistoricalImportValidationError();
    return this.repository.importMessage(input);
  }

  public async list(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    query: HistoricalThreadQuery,
  ) {
    read(permissions, query);
    if (query.contactId !== undefined) id(query.contactId);
    if (
      query.contactState !== undefined &&
      !["ALL", "LINKED", "UNLINKED"].includes(query.contactState)
    )
      throw new HistoricalImportValidationError();
    if (query.query !== undefined) text(query.query, 160);
    const page = await this.repository.list(actor, query);
    return { ...page, items: await withSourceParticipants(page.items, this.sourceParticipants) };
  }

  public async find(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    threadId: string,
  ) {
    read(permissions);
    id(threadId);
    const record = await this.repository.find(actor, threadId);
    if (!record) throw new HistoricalConversationNotFoundError();
    return (await withSourceParticipants([record], this.sourceParticipants))[0]!;
  }

  public async messages(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    threadId: string,
    query: HistoricalPageQuery,
  ) {
    read(permissions, query);
    id(threadId);
    const page = await this.repository.messages(actor, threadId, query);
    if (!page) throw new HistoricalConversationNotFoundError();
    return page;
  }

  public async verifyImports(
    context: HistoricalImportContext,
    locationId: string,
  ): Promise<HistoricalConversationImportVerification> {
    authorizeHistoricalImport(context, "crm:conversations:configure");
    if (!/^[A-Za-z0-9_-]{1,200}$/u.test(locationId)) throw new HistoricalImportValidationError();
    return this.repository.verifyImports(locationId);
  }
}
