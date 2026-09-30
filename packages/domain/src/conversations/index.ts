import type { CommercialActor } from "../iam/index.js";

export type ConversationChannel = "EMAIL" | "WHATSAPP" | "WEBCHAT" | "SMS";
export type ConversationStatus = "OPEN" | "PENDING" | "ESCALATED" | "CLOSED";
export type ConversationAttentionMode = "AGENT" | "HUMAN";
export type ConversationMessageKind = "TEXT" | "IMAGE" | "AUDIO" | "DOCUMENT" | "SYSTEM";
export type ConversationDeliveryStatus =
  "RECEIVED" | "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "UNKNOWN" | "NOT_APPLICABLE";

export interface ConversationRecord {
  readonly id: string;
  readonly contactId: string;
  readonly channel: ConversationChannel;
  readonly externalThreadId: string | null;
  readonly assigneeMemberId: string | null;
  readonly status: ConversationStatus;
  readonly attentionMode: ConversationAttentionMode;
  readonly subject: string | null;
  readonly lastMessagePreview: string | null;
  readonly lastMessageAt: Date | null;
  readonly unreadCount: number;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ConversationMessageRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly sequence: bigint;
  readonly direction: "INBOUND" | "OUTBOUND" | "INTERNAL";
  readonly kind: ConversationMessageKind;
  readonly authorMemberId: string | null;
  readonly body: string;
  readonly externalMessageId: string | null;
  readonly deliveryStatus: ConversationDeliveryStatus;
  readonly failureCode: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ConversationHistoryRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly eventType:
    | "CREATED"
    | "ASSIGNED"
    | "TRANSFERRED"
    | "STATUS_CHANGED"
    | "ATTENTION_CHANGED"
    | "MESSAGE_ADDED"
    | "NOTE_ADDED";
  readonly actorMemberId: string;
  readonly previousValue: string | null;
  readonly nextValue: string | null;
  readonly createdAt: Date;
}

export interface QuickReplyRecord {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly createdByMemberId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ConversationListFilters {
  readonly cursor?: string;
  readonly limit: number;
  readonly query?: string;
  readonly channel?: ConversationChannel;
  readonly status?: ConversationStatus;
  readonly attentionMode?: ConversationAttentionMode;
  readonly assigneeMemberId?: string;
  readonly unassigned?: boolean;
}

export interface ConversationRepository {
  readonly list: (
    actor: CommercialActor,
    filters: ConversationListFilters,
  ) => Promise<{
    readonly items: readonly ConversationRecord[];
    readonly nextCursor: string | null;
  }>;
  readonly find: (actor: CommercialActor, id: string) => Promise<ConversationRecord | null>;
  readonly thread: (
    actor: CommercialActor,
    id: string,
  ) => Promise<{
    readonly conversation: ConversationRecord;
    readonly messages: readonly ConversationMessageRecord[];
    readonly history: readonly ConversationHistoryRecord[];
  } | null>;
  readonly create: (input: {
    readonly actor: CommercialActor;
    readonly conversation: ConversationRecord;
    readonly message: ConversationMessageRecord;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<ConversationRecord>;
  readonly update: (input: {
    readonly actor: CommercialActor;
    readonly id: string;
    readonly expectedVersion: bigint;
    readonly status?: ConversationStatus;
    readonly attentionMode?: ConversationAttentionMode;
    readonly assigneeMemberId?: string | null;
    readonly now: Date;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<ConversationRecord | null>;
  readonly append: (input: {
    readonly actor: CommercialActor;
    readonly conversationId: string;
    readonly expectedVersion: bigint;
    readonly message: Omit<ConversationMessageRecord, "sequence">;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<ConversationMessageRecord | null>;
  readonly listQuickReplies: () => Promise<readonly QuickReplyRecord[]>;
  readonly createQuickReply: (input: {
    readonly actor: CommercialActor;
    readonly reply: QuickReplyRecord;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<QuickReplyRecord>;
}

export class ConversationNotFoundError extends Error {
  public constructor() {
    super("Conversation not found");
    this.name = "ConversationNotFoundError";
  }
}
export class ConversationValidationError extends Error {
  public constructor() {
    super("Invalid conversation state");
    this.name = "ConversationValidationError";
  }
}
export class ConversationVersionConflictError extends Error {
  public constructor() {
    super("Conversation has changed");
    this.name = "ConversationVersionConflictError";
  }
}

export { ConversationService } from "./conversation-service.js";
