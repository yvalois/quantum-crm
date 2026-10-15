import type { ConversationDocumentSnapshot } from "@quantum-crm/contracts";
import type { CommercialActor } from "../iam/index.js";

export type ConversationChannel = "EMAIL" | "WHATSAPP" | "WEBCHAT" | "SMS";
/** Audit identity of the profile-scoped agent, deliberately not a human member. */
export const agentRoutingPrincipalId = "00000000-0000-7000-8000-000000000007";
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
  readonly documentId: string | null;
  readonly documentSnapshot: ConversationDocumentSnapshot | null;
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
    | "AGENT_RESET"
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
  readonly contactId?: string;
  readonly query?: string;
  readonly channel?: ConversationChannel;
  readonly status?: ConversationStatus;
  readonly attentionMode?: ConversationAttentionMode;
  readonly assigneeMemberId?: string;
  readonly unassigned?: boolean;
}

export interface ExternalConversationMessage {
  readonly externalThreadId: string;
  readonly externalMessageId: string;
  readonly contactId: string;
  readonly contactDisplayName: string;
  readonly direction: "INBOUND" | "OUTBOUND";
  readonly kind: ConversationMessageKind;
  readonly body: string;
  readonly occurredAt: Date;
  readonly historical: boolean;
  readonly assigneeMemberId?: string;
}

/** Writes one verified provider message, including the thread, atomically and idempotently. */
export interface ExternalConversationReceiver {
  readonly findThreadAssignment: (externalThreadId: string) => Promise<{
    readonly contactId: string;
    readonly assigneeMemberId: string | null;
  } | null>;
  readonly receive: (message: ExternalConversationMessage) => Promise<"CREATED" | "DUPLICATE">;
  /** A contact keeps one authorized advisor; a new contact consumes one serialized turn. */
  readonly reserveAdvisor: (input: {
    readonly contactId: string;
    readonly eligibleMemberIds: readonly [string, string];
    readonly previousMemberId: string | null;
  }) => Promise<string>;
  readonly reconcileOutbound: (input: {
    readonly messageId: string;
    readonly externalThreadId: string;
    readonly externalMessageId: string;
    readonly status: "SENT" | "DELIVERED" | "READ" | "FAILED";
    readonly failureCode?: string;
  }) => Promise<boolean>;
}

export interface ConversationOutboundLease {
  readonly outboxId: string;
  readonly messageId: string;
  readonly externalThreadId: string;
  readonly body: string;
  readonly kind: ConversationMessageKind;
  readonly attempt: number;
}

export interface ConversationOutboundDispatcher {
  readonly claimNext: (input: {
    readonly workerId: string;
    readonly leaseSeconds: number;
  }) => Promise<ConversationOutboundLease | null>;
  readonly complete: (input: {
    readonly lease: ConversationOutboundLease;
    readonly workerId: string;
    readonly outcome: "SENT" | "RETRY" | "FAILED" | "UNKNOWN";
    readonly externalMessageId?: string;
    readonly errorCode?: string;
  }) => Promise<boolean>;
}

export interface ConversationAgentLease {
  readonly inboundMessageId: string;
  readonly conversationId: string;
  readonly question: string;
  readonly generation: bigint;
  readonly firstTurn: boolean;
}

export interface ConversationAgentContextMessage {
  readonly role: "customer" | "advisor" | "agent";
  readonly text: string;
}

export interface ConversationAgentContext {
  readonly threadId: string;
  readonly messages: readonly ConversationAgentContextMessage[];
}

/** Durable inbound trigger; outbound insertion is fenced and atomic with completion. */
export interface ConversationAgentDispatcher {
  readonly isLeasedExecution: (inboundMessageId: string) => Promise<boolean>;
  /** Resolve only the current leased execution; never accept a caller-chosen conversation. */
  readonly contextForExecution: (
    inboundMessageId: string,
  ) => Promise<ConversationAgentContext | null>;
  readonly claimNext: (input: {
    readonly workerId: string;
    readonly leaseSeconds: number;
  }) => Promise<ConversationAgentLease | null>;
  readonly complete: (input: {
    readonly lease: ConversationAgentLease;
    readonly workerId: string;
    readonly answer: string;
    readonly sourceIds: readonly string[];
    readonly handoffRequested?: boolean;
  }) => Promise<"COMPLETED" | "CANCELLED" | "STALE">;
  readonly fail: (input: {
    readonly lease: ConversationAgentLease;
    readonly workerId: string;
    readonly retry: boolean;
    readonly code: string;
  }) => Promise<boolean>;
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
    readonly resetAgent?: boolean;
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
export * from "./unified-inbox-service.js";
