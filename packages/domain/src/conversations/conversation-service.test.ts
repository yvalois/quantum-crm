import { describe, expect, it, vi } from "vitest";

import { IamAuthorizationError, type CommercialActor } from "../iam/index.js";
import {
  ConversationNotFoundError,
  ConversationService,
  ConversationValidationError,
  ConversationVersionConflictError,
  type ConversationRecord,
  type ConversationRepository,
} from "./index.js";

const actor: CommercialActor = Object.freeze({
  memberId: "019b0000-0000-7000-8000-000000000001",
  scope: "PROFILE",
});
const now = new Date("2026-09-30T18:00:00.000Z");
const existing: ConversationRecord = Object.freeze({
  id: "019b0000-0000-7000-8000-000000000002",
  contactId: "019b0000-0000-7000-8000-000000000003",
  channel: "WHATSAPP",
  externalThreadId: null,
  assigneeMemberId: actor.memberId,
  status: "OPEN",
  attentionMode: "HUMAN",
  subject: null,
  lastMessagePreview: "Hola",
  lastMessageAt: now,
  unreadCount: 0,
  version: 2n,
  createdAt: now,
  updatedAt: now,
});

function repository(record: ConversationRecord | null = existing): ConversationRepository {
  return {
    list: vi.fn(async () => ({ items: record ? [record] : [], nextCursor: null })),
    find: vi.fn(async () => record),
    thread: vi.fn(async () =>
      record ? { conversation: record, messages: [], history: [] } : null,
    ),
    create: vi.fn(async (input) => input.conversation),
    update: vi.fn(async (input) =>
      record && input.expectedVersion === record.version
        ? Object.freeze({
            ...record,
            ...(input.status === undefined ? {} : { status: input.status }),
            ...(input.attentionMode === undefined ? {} : { attentionMode: input.attentionMode }),
            ...(input.assigneeMemberId === undefined
              ? {}
              : { assigneeMemberId: input.assigneeMemberId }),
            version: record.version + 1n,
          })
        : null,
    ),
    append: vi.fn(async (input) =>
      record && input.expectedVersion === record.version
        ? Object.freeze({ ...input.message, sequence: 3n })
        : null,
    ),
    listQuickReplies: vi.fn(async () => []),
    createQuickReply: vi.fn(async (input) => input.reply),
  };
}

function references(contact = true, member = true) {
  return {
    contactExistsFor: vi.fn(async () => contact),
    isActiveMember: vi.fn(async () => member),
  };
}

describe("ConversationService", () => {
  it("denies a reply without consulting the repository", async () => {
    const store = repository();
    const service = new ConversationService(store, references(), () => now);
    await expect(
      service.send({
        actor,
        permissions: [],
        conversationId: existing.id,
        expectedVersion: existing.version,
        body: "Respuesta",
        kind: "TEXT",
        idempotencyKey: "message-12345678",
        payloadHash: "a".repeat(64),
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
    expect(store.find).not.toHaveBeenCalled();
  });

  it("creates an assigned human conversation with a queued outbound message", async () => {
    const store = repository();
    const service = new ConversationService(store, references(), () => now);
    const created = await service.create({
      actor,
      permissions: ["crm:conversations:reply"],
      contactId: existing.contactId,
      channel: "EMAIL",
      initialMessage: " Primer contacto ",
      idempotencyKey: "create-12345678",
      payloadHash: "b".repeat(64),
    });
    expect(created.attentionMode).toBe("HUMAN");
    expect(created.assigneeMemberId).toBe(actor.memberId);
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          body: "Primer contacto",
          direction: "OUTBOUND",
          deliveryStatus: "QUEUED",
        }),
      }),
    );
  });

  it("prevents outbound replies while the agent owns the conversation", async () => {
    const service = new ConversationService(
      repository(Object.freeze({ ...existing, attentionMode: "AGENT" })),
      references(),
      () => now,
    );
    await expect(
      service.send({
        actor,
        permissions: ["crm:conversations:reply"],
        conversationId: existing.id,
        expectedVersion: existing.version,
        body: "Duplicada",
        kind: "TEXT",
        idempotencyKey: "message-12345678",
        payloadHash: "c".repeat(64),
      }),
    ).rejects.toBeInstanceOf(ConversationValidationError);
  });

  it("takes an unassigned conversation for the human actor", async () => {
    const unassigned = Object.freeze({
      ...existing,
      attentionMode: "AGENT" as const,
      assigneeMemberId: null,
    });
    const store = repository(unassigned);
    const service = new ConversationService(store, references(), () => now);
    await service.update({
      actor,
      permissions: ["crm:conversations:control-agent"],
      id: existing.id,
      expectedVersion: existing.version,
      attentionMode: "HUMAN",
      idempotencyKey: "takeover-12345678",
      payloadHash: "d".repeat(64),
    });
    expect(store.update).toHaveBeenCalledWith(
      expect.objectContaining({ attentionMode: "HUMAN", assigneeMemberId: actor.memberId }),
    );
  });

  it("rejects unknown contacts and stale versions", async () => {
    const missingContact = new ConversationService(repository(), references(false), () => now);
    await expect(
      missingContact.create({
        actor,
        permissions: ["crm:conversations:reply"],
        contactId: existing.contactId,
        channel: "EMAIL",
        initialMessage: "Hola",
        idempotencyKey: "create-12345678",
        payloadHash: "e".repeat(64),
      }),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);

    const stale = new ConversationService(repository(), references(), () => now);
    await expect(
      stale.addNote({
        actor,
        permissions: ["crm:conversations:reply"],
        conversationId: existing.id,
        expectedVersion: 1n,
        body: "Contexto",
        idempotencyKey: "note-12345678",
        payloadHash: "f".repeat(64),
      }),
    ).rejects.toBeInstanceOf(ConversationVersionConflictError);
  });
});
