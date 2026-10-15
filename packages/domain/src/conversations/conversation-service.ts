import { randomUUID } from "node:crypto";

import type { ConversationDocumentSnapshot } from "@quantum-crm/contracts";
import { IamAuthorizationError, type CommercialActor, type IamPermission } from "../iam/index.js";
import type { CommercialDocumentRecord } from "../documents/index.js";
import {
  type ConversationAttentionMode,
  type ConversationChannel,
  type ConversationListFilters,
  type ConversationMessageKind,
  ConversationNotFoundError,
  type ConversationRecord,
  type ConversationRepository,
  type ConversationStatus,
  ConversationValidationError,
  ConversationVersionConflictError,
  ConversationWindowClosedError,
  type QuickReplyRecord,
} from "./index.js";

function allow(permissions: readonly IamPermission[], permission: IamPermission): void {
  if (!permissions.includes(permission)) throw new IamAuthorizationError();
}
function body(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 16_000) throw new ConversationValidationError();
  return normalized;
}

export interface ConversationReferences {
  readonly contactExistsFor: (actor: CommercialActor, contactId: string) => Promise<boolean>;
  /** Only a server-owned channel binding may construct the outbound thread identity. */
  readonly whatsappThreadFor?: (
    actor: CommercialActor,
    contactId: string,
  ) => Promise<string | null>;
  readonly isActiveMember: (memberId: string) => Promise<boolean>;
  /** Resolves a document through its owning module and returns the server-owned snapshot source. */
  readonly documentFor?: (
    actor: CommercialActor,
    documentId: string,
  ) => Promise<CommercialDocumentRecord | null>;
  /** Files owns validation and access; conversations retains only the stable file ID. */
  readonly mediaFor?: (
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    fileId: string,
    conversationId: string,
  ) => Promise<{
    readonly id: string;
    readonly status: string;
    readonly fileClass: string;
    readonly mimeType: string;
    readonly size: number;
  } | null>;
}

function documentSnapshot(document: CommercialDocumentRecord): ConversationDocumentSnapshot {
  return Object.freeze({
    id: document.id,
    kind: document.kind,
    title: document.title,
    sourceTemplateId: document.sourceTemplateId,
    revision: document.revision,
    blocks: [...document.blocks],
    design: document.design,
  });
}

export class ConversationService {
  public constructor(
    private readonly repository: ConversationRepository,
    private readonly references: ConversationReferences,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async list(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    filters: ConversationListFilters,
  ) {
    allow(permissions, "crm:conversations:read");
    return this.repository.list(actor, filters);
  }

  public async thread(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    conversationId: string,
  ) {
    allow(permissions, "crm:conversations:read");
    const thread = await this.repository.thread(actor, conversationId);
    if (!thread) throw new ConversationNotFoundError();
    return thread;
  }

  public async markRead(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    conversationId: string,
    throughSequence: bigint,
  ) {
    allow(permissions, "crm:conversations:read");
    const conversation = await this.repository.markRead(actor, conversationId, throughSequence);
    if (!conversation) throw new ConversationNotFoundError();
    return conversation;
  }

  public async create(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly contactId: string;
    readonly channel: ConversationChannel;
    readonly assigneeMemberId?: string;
    readonly subject?: string;
    readonly initialMessage: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:conversations:reply");
    // A new WhatsApp thread has no verified inbound message; free-form initiation
    // requires a template, which is a separate CHAT-05 command.
    if (input.channel === "WHATSAPP") throw new ConversationWindowClosedError();
    if (!(await this.references.contactExistsFor(input.actor, input.contactId)))
      throw new ConversationNotFoundError();
    if (input.assigneeMemberId && input.assigneeMemberId !== input.actor.memberId) {
      allow(input.permissions, "crm:conversations:assign");
      if (!(await this.references.isActiveMember(input.assigneeMemberId)))
        throw new ConversationNotFoundError();
    }
    const now = this.clock();
    const content = body(input.initialMessage);
    const subject = input.subject?.trim() || null;
    if (subject && subject.length > 240) throw new ConversationValidationError();
    const conversation: ConversationRecord = Object.freeze({
      id: randomUUID(),
      contactId: input.contactId,
      channel: input.channel,
      externalThreadId: null,
      assigneeMemberId: input.assigneeMemberId ?? input.actor.memberId,
      status: "OPEN",
      attentionMode: "HUMAN",
      subject,
      lastMessagePreview: content.slice(0, 280),
      lastMessageAt: now,
      unreadCount: 0,
      version: 1n,
      createdAt: now,
      updatedAt: now,
    });
    return this.repository.create({
      actor: input.actor,
      conversation,
      message: Object.freeze({
        id: randomUUID(),
        conversationId: conversation.id,
        sequence: 1n,
        direction: "OUTBOUND",
        kind: "TEXT",
        authorMemberId: input.actor.memberId,
        body: content,
        externalMessageId: null,
        deliveryStatus: "QUEUED",
        failureCode: null,
        fileId: null,
        documentId: null,
        documentSnapshot: null,
        createdAt: now,
        updatedAt: now,
      }),
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
  }

  public async update(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly id: string;
    readonly expectedVersion: bigint;
    readonly status?: ConversationStatus;
    readonly attentionMode?: ConversationAttentionMode;
    readonly assigneeMemberId?: string | null;
    readonly resetAgent?: boolean;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    if (input.assigneeMemberId !== undefined) {
      allow(input.permissions, "crm:conversations:assign");
      if (
        input.assigneeMemberId !== null &&
        !(await this.references.isActiveMember(input.assigneeMemberId))
      )
        throw new ConversationNotFoundError();
    }
    if (input.attentionMode !== undefined || input.resetAgent)
      allow(input.permissions, "crm:conversations:control-agent");
    if (input.status !== undefined) allow(input.permissions, "crm:conversations:reply");
    const current = await this.repository.find(input.actor, input.id);
    if (!current) throw new ConversationNotFoundError();
    if (current.version === input.expectedVersion) {
      if (
        input.attentionMode === "AGENT" &&
        (current.status === "ESCALATED" || current.status === "CLOSED")
      )
        throw new ConversationValidationError();
      if (input.status === "CLOSED" && input.attentionMode === "AGENT")
        throw new ConversationValidationError();
      if (
        input.resetAgent &&
        (current.channel !== "WHATSAPP" ||
          current.attentionMode !== "AGENT" ||
          current.status === "ESCALATED" ||
          current.status === "CLOSED" ||
          input.attentionMode !== undefined ||
          input.status !== undefined ||
          input.assigneeMemberId !== undefined)
      )
        throw new ConversationValidationError();
    }
    const assigneeMemberId =
      input.attentionMode === "HUMAN" &&
      input.assigneeMemberId === undefined &&
      current.assigneeMemberId === null
        ? input.actor.memberId
        : input.assigneeMemberId;
    const result = await this.repository.update({
      actor: input.actor,
      id: input.id,
      expectedVersion: input.expectedVersion,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.attentionMode === undefined ? {} : { attentionMode: input.attentionMode }),
      ...(assigneeMemberId === undefined ? {} : { assigneeMemberId }),
      ...(input.resetAgent ? { resetAgent: true } : {}),
      now: this.clock(),
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
    if (!result) throw new ConversationVersionConflictError();
    return result;
  }

  public async send(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly conversationId: string;
    readonly expectedVersion: bigint;
    readonly body: string;
    readonly kind: ConversationMessageKind;
    readonly fileId?: string;
    readonly documentId?: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:conversations:reply");
    const current = await this.repository.find(input.actor, input.conversationId);
    if (!current) throw new ConversationNotFoundError();
    if (current.attentionMode !== "HUMAN" || current.status === "CLOSED")
      throw new ConversationValidationError();
    let attachedDocument: CommercialDocumentRecord | null = null;
    if (input.documentId) {
      if (input.kind !== "DOCUMENT" || !this.references.documentFor)
        throw new ConversationValidationError();
      attachedDocument = await this.references.documentFor(input.actor, input.documentId);
      if (!attachedDocument || attachedDocument.contactId !== current.contactId)
        throw new ConversationNotFoundError();
    } else if (input.kind === "DOCUMENT" && !input.fileId) {
      throw new ConversationValidationError();
    }
    if (attachedDocument && !input.fileId && current.channel === "WHATSAPP") {
      // The template instance has no deliverable PDF yet. Never queue an undeliverable message.
      throw new ConversationValidationError();
    }
    if (input.fileId) {
      const media = await this.references.mediaFor?.(
        input.actor,
        input.permissions,
        input.fileId,
        current.id,
      );
      const expectedClass =
        input.kind === "IMAGE" ? "IMAGE" : input.kind === "AUDIO" ? "AUDIO" : "DOCUMENT";
      const acceptedMime =
        input.kind === "IMAGE"
          ? ["image/jpeg", "image/png"]
          : input.kind === "AUDIO"
            ? ["audio/mpeg", "audio/ogg"]
            : ["application/pdf", "text/plain"];
      const maxBytes =
        input.kind === "IMAGE" ? 5_000_000 : input.kind === "AUDIO" ? 16_000_000 : 50_000_000;
      if (
        !media ||
        media.status !== "AVAILABLE" ||
        media.fileClass !== expectedClass ||
        !acceptedMime.includes(media.mimeType) ||
        media.size > maxBytes ||
        !["IMAGE", "AUDIO", "DOCUMENT"].includes(input.kind)
      )
        throw new ConversationValidationError();
    } else if (["IMAGE", "AUDIO"].includes(input.kind)) {
      throw new ConversationValidationError();
    }
    const now = this.clock();
    const result = await this.repository.append({
      actor: input.actor,
      conversationId: input.conversationId,
      expectedVersion: input.expectedVersion,
      message: Object.freeze({
        id: randomUUID(),
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        kind: input.kind,
        authorMemberId: input.actor.memberId,
        body: body(input.body),
        externalMessageId: null,
        deliveryStatus: "QUEUED",
        failureCode: null,
        fileId: input.fileId ?? null,
        documentId: attachedDocument?.id ?? null,
        documentSnapshot: attachedDocument ? documentSnapshot(attachedDocument) : null,
        createdAt: now,
        updatedAt: now,
      }),
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
    if (!result) throw new ConversationVersionConflictError();
    return result;
  }

  public async addNote(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly conversationId: string;
    readonly expectedVersion: bigint;
    readonly body: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:conversations:reply");
    if (!(await this.repository.find(input.actor, input.conversationId)))
      throw new ConversationNotFoundError();
    const now = this.clock();
    const result = await this.repository.append({
      actor: input.actor,
      conversationId: input.conversationId,
      expectedVersion: input.expectedVersion,
      message: Object.freeze({
        id: randomUUID(),
        conversationId: input.conversationId,
        direction: "INTERNAL",
        kind: "TEXT",
        authorMemberId: input.actor.memberId,
        body: body(input.body),
        externalMessageId: null,
        deliveryStatus: "NOT_APPLICABLE",
        failureCode: null,
        fileId: null,
        documentId: null,
        documentSnapshot: null,
        createdAt: now,
        updatedAt: now,
      }),
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
    if (!result) throw new ConversationVersionConflictError();
    return result;
  }

  public async listQuickReplies(permissions: readonly IamPermission[]) {
    allow(permissions, "crm:conversations:read");
    return this.repository.listQuickReplies();
  }

  public async createQuickReply(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly title: string;
    readonly body: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:conversations:configure");
    const title = input.title.trim();
    if (title.length < 1 || title.length > 120) throw new ConversationValidationError();
    const now = this.clock();
    const reply: QuickReplyRecord = Object.freeze({
      id: randomUUID(),
      title,
      body: body(input.body),
      createdByMemberId: input.actor.memberId,
      createdAt: now,
      updatedAt: now,
    });
    return this.repository.createQuickReply({
      actor: input.actor,
      reply,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
  }
}
