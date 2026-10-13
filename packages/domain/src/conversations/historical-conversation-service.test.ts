import { describe, expect, it, vi } from "vitest";
import { IamAuthorizationError, type CommercialActor } from "../iam/index.js";
import {
  HistoricalImportValidationError,
  type HistoricalImportSource,
} from "../shared/historical-import.js";
import {
  HistoricalConversationNotFoundError,
  HistoricalAttachmentConflictError,
  HistoricalConversationService,
  type HistoricalConversationRepository,
  type HistoricalMessageInput,
  type HistoricalThreadInput,
  type HistoricalAttachmentRecord,
} from "./historical-conversation-service.js";

const actor: CommercialActor = {
  memberId: "019b0000-0000-7000-8000-000000000001",
  scope: "PROFILE",
};
const source: HistoricalImportSource = {
  system: "GHL",
  locationId: "fixture-location",
  externalId: "fixture-message",
  payloadHash: "a".repeat(64),
  raw: {},
};
const message: HistoricalMessageInput = {
  sourceContactId: "missing-source-contact",
  rawChannel: "TYPE_CALL",
  rawType: "1",
  rawDirection: "outbound",
  rawStatus: "pending",
  body: "",
  attachmentCount: 1,
  sourceCreatedAt: new Date("2020-01-01T13:00:00Z"),
  sourceUpdatedAt: null,
};
const thread: HistoricalThreadInput = {
  sourceThreadPresent: false,
  contactId: null,
  sourceContactId: "missing-source-contact",
  assigneeMemberId: null,
  rawChannel: null,
  rawStatus: null,
  subject: null,
  sourceCreatedAt: null,
  sourceUpdatedAt: null,
};
const attachment: HistoricalAttachmentRecord = {
  id: "019b0000-0000-7000-8000-000000000004",
  messageId: "019b0000-0000-7000-8000-000000000002",
  attachmentIndex: 0,
  sourceHash: "b".repeat(64),
  fileId: null,
  status: "PENDING",
  errorCode: null,
  name: null,
  mimeType: null,
  size: null,
};
const context = { actor, permissions: ["crm:conversations:configure"] as const };
function setup(contactExists = true) {
  const result = { id: "019b0000-0000-7000-8000-000000000002", status: "CREATED" as const };
  const repository: HistoricalConversationRepository = {
    reserveAttachment: vi.fn(async () => attachment),
    findAttachment: vi.fn(async () => attachment),
    setAttachmentResult: vi.fn(async () => attachment),
    verifyAttachments: vi.fn(async () => ({
      expectedCount: 1,
      reservedCount: 1,
      availableCount: 0,
      pendingCount: 1,
      rejectedCount: 0,
      failedCount: 0,
      missingCount: 0,
      totalBytes: 0,
    })),
    importThread: vi.fn(async () => result),
    importMessage: vi.fn(async () => result),
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
    find: vi.fn(async () => null),
    messages: vi.fn(async () => null),
    verifyImports: vi.fn(async () => ({
      threadCount: 0,
      messageCount: 0,
      mappedThreadCount: 0,
      mappedMessageCount: 0,
      unresolvedThreadCount: 0,
      unresolvedContactThreadCount: 0,
      inconsistentMessageCount: 0,
      invalidParentCount: 0,
      outboxCount: 0,
    })),
  };
  const references = {
    contactExistsFor: vi.fn(async () => contactExists),
    isActiveMember: vi.fn(async () => true),
  };
  const files = {
    fileForAttachment: vi.fn(async () => ({
      id: "019b0000-0000-7000-8000-000000000005",
      status: "AVAILABLE",
      owner: {
        kind: "existing" as const,
        module: "conversations" as const,
        type: "historical_attachment" as const,
        id: attachment.id,
      },
      originalName: "attachment.png",
      mimeType: "image/png",
      size: 1234,
    })),
  };
  return {
    repository,
    references,
    files,
    service: new HistoricalConversationService(repository, references, files),
  };
}

describe("historical conversations", () => {
  it("reserves only authorized bounded source identities", async () => {
    const { service, repository } = setup();
    const input = {
      locationId: "fixture-location",
      externalMessageId: "message",
      attachmentIndex: 0,
      sourceHash: attachment.sourceHash,
    };
    await service.reserveAttachment(context, input);
    await expect(
      service.reserveAttachment({ ...context, actor: { ...actor, scope: "OWN" } }, input),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
    await expect(
      service.reserveAttachment(context, { ...input, attachmentIndex: -1 }),
    ).rejects.toBeInstanceOf(HistoricalImportValidationError);
    expect(repository.reserveAttachment).toHaveBeenCalledTimes(1);
  });

  it("requires the Files owner and AVAILABLE state before making an attachment usable", async () => {
    const { service, files, repository } = setup();
    const file = await files.fileForAttachment();
    const input = {
      attachmentId: attachment.id,
      fileId: file.id,
      status: "AVAILABLE" as const,
      errorCode: null,
    };
    files.fileForAttachment.mockResolvedValueOnce({ ...file, status: "QUARANTINED" });
    await expect(service.setAttachmentResult(context, input)).rejects.toBeInstanceOf(
      HistoricalAttachmentConflictError,
    );
    files.fileForAttachment.mockResolvedValueOnce({
      ...file,
      owner: { ...file.owner, id: actor.memberId },
    });
    await expect(service.setAttachmentResult(context, input)).rejects.toBeInstanceOf(
      HistoricalAttachmentConflictError,
    );
    expect(repository.setAttachmentResult).not.toHaveBeenCalled();
    await service.setAttachmentResult(context, input);
    expect(repository.setAttachmentResult).toHaveBeenCalledWith(context, {
      ...input,
      name: "attachment.png",
      mimeType: "image/png",
      size: 1234,
    });
  });

  it("binds a pending file durably and prevents substitution on retry", async () => {
    const { service, files, repository } = setup();
    const file = await files.fileForAttachment();
    files.fileForAttachment.mockResolvedValue({ ...file, status: "PENDING" });
    await service.setAttachmentResult(context, {
      attachmentId: attachment.id,
      fileId: file.id,
      status: "PENDING",
      errorCode: null,
    });
    vi.mocked(repository.findAttachment).mockResolvedValue({ ...attachment, fileId: file.id });
    await expect(
      service.setAttachmentResult(context, {
        attachmentId: attachment.id,
        fileId: actor.memberId,
        status: "PENDING",
        errorCode: null,
      }),
    ).rejects.toBeInstanceOf(HistoricalAttachmentConflictError);
    vi.mocked(repository.findAttachment).mockResolvedValue(null);
    expect(await service.canUseAttachmentOwner({ ...actor, scope: "OWN" }, attachment.id)).toBe(
      false,
    );
  });
  it("preserves empty body, unknown provider channel, pending source status and original date without a send command", async () => {
    const { service, repository } = setup();
    await service.importMessage({
      actor,
      permissions: ["crm:conversations:configure"],
      source,
      threadSourceExternalId: "absent-thread",
      message,
    });
    expect(repository.importMessage).toHaveBeenCalledWith(expect.objectContaining({ message }));
    expect(message.body).toBe("");
    expect(message.rawStatus).toBe("pending");
  });

  it("preserves whitespace and HTML as original inert text", async () => {
    const { service, repository } = setup();
    const body = "  <script>source text only</script>\n" + "a".repeat(17_000);
    await service.importMessage({
      actor,
      permissions: ["crm:conversations:configure"],
      source,
      threadSourceExternalId: "source-thread",
      message: { ...message, body },
    });
    expect(repository.importMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ body }) }),
    );
  });

  it("requires profile scope and configuration permission before any write", async () => {
    const { service, repository } = setup();
    await expect(
      service.importThread({ actor, permissions: [], source, thread }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
    await expect(
      service.importMessage({
        actor: { ...actor, scope: "OWN" },
        permissions: ["crm:conversations:configure"],
        source,
        threadSourceExternalId: "source-thread",
        message,
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
    expect(repository.importThread).not.toHaveBeenCalled();
    expect(repository.importMessage).not.toHaveBeenCalled();
  });

  it("keeps absent source threads and contacts explicitly unresolved", async () => {
    const { service, repository, references } = setup();
    await service.importThread({
      actor,
      permissions: ["crm:conversations:configure"],
      source,
      thread,
    });
    expect(repository.importThread).toHaveBeenCalledWith(expect.objectContaining({ thread }));
    expect(references.contactExistsFor).not.toHaveBeenCalled();
    expect(references.isActiveMember).not.toHaveBeenCalled();
  });

  it("rejects a supplied contact mapping that the owning module cannot confirm", async () => {
    const { service, repository } = setup(false);
    await expect(
      service.importThread({
        actor,
        permissions: ["crm:conversations:configure"],
        source,
        thread: { ...thread, contactId: "019b0000-0000-7000-8000-000000000003" },
      }),
    ).rejects.toBeInstanceOf(HistoricalConversationNotFoundError);
    expect(repository.importThread).not.toHaveBeenCalled();
  });

  it("rejects invalid dates and PostgreSQL-incompatible NUL content instead of truncating", async () => {
    const { service, repository } = setup();
    for (const invalid of [
      { ...message, sourceCreatedAt: new Date("invalid") },
      { ...message, body: "source\u0000text" },
    ]) {
      await expect(
        service.importMessage({
          actor,
          permissions: ["crm:conversations:configure"],
          source,
          threadSourceExternalId: "source-thread",
          message: invalid,
        }),
      ).rejects.toBeInstanceOf(HistoricalImportValidationError);
    }
    expect(repository.importMessage).not.toHaveBeenCalled();
  });

  it("protects historical reads and enforces bounded pagination", async () => {
    const { service, repository } = setup();
    await expect(service.list(actor, [], { limit: 50 })).rejects.toBeInstanceOf(
      IamAuthorizationError,
    );
    await expect(
      service.list(actor, ["crm:conversations:read"], { limit: 101 }),
    ).rejects.toBeInstanceOf(HistoricalImportValidationError);
    await expect(
      service.messages(actor, ["crm:conversations:read"], "019b0000-0000-7000-8000-000000000002", {
        limit: 50,
      }),
    ).rejects.toBeInstanceOf(HistoricalConversationNotFoundError);
    expect(repository.list).not.toHaveBeenCalled();
  });
  it("only permits an authorized operator to assign an imported chat to an active member", async () => {
    const { repository, references } = setup();
    const assigneeMemberId = "019b0000-0000-7000-8000-000000000009";
    const assign = vi.fn(async () => ({
      id: "019b0000-0000-7000-8000-000000000002",
      source: "GHL" as const,
      sourceExternalId: "thread-1",
      sourceThreadPresent: true,
      contactId: null,
      assigneeMemberId,
      rawChannel: null,
      rawStatus: null,
      subject: null,
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      messageCount: 0,
      lastMessageAt: null,
      importedAt: new Date("2026-10-12T00:00:00Z"),
    }));
    const service = new HistoricalConversationService({ ...repository, assign }, references);
    const input = {
      actor,
      threadId: "019b0000-0000-7000-8000-000000000002",
      expectedAssigneeMemberId: null,
      assigneeMemberId,
    };
    await expect(
      service.assign({ ...input, permissions: ["crm:conversations:read"] }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
    expect(assign).not.toHaveBeenCalled();
    await expect(
      service.assign({ ...input, permissions: ["crm:conversations:assign"] }),
    ).resolves.toMatchObject({ assigneeMemberId });
    expect(assign).toHaveBeenCalledWith(actor, input.threadId, null, assigneeMemberId);
  });
});
