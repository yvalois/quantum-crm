import { describe, expect, it, vi } from "vitest";
import { IamAuthorizationError, type CommercialActor } from "../iam/index.js";
import { HistoricalImportValidationError, type HistoricalImportSource } from "../shared/historical-import.js";
import {
  HistoricalConversationNotFoundError,
  HistoricalConversationService,
  type HistoricalConversationRepository,
  type HistoricalMessageInput,
  type HistoricalThreadInput,
} from "./historical-conversation-service.js";

const actor: CommercialActor = { memberId: "019b0000-0000-7000-8000-000000000001", scope: "PROFILE" };
const source: HistoricalImportSource = { system: "GHL", locationId: "fixture-location", externalId: "fixture-message", payloadHash: "a".repeat(64), raw: {} };
const message: HistoricalMessageInput = {
  sourceContactId: "missing-source-contact", rawChannel: "TYPE_CALL", rawType: "1",
  rawDirection: "outbound", rawStatus: "pending", body: "", attachmentCount: 1,
  sourceCreatedAt: new Date("2020-01-01T13:00:00Z"), sourceUpdatedAt: null,
};
const thread: HistoricalThreadInput = {
  sourceThreadPresent: false, contactId: null, sourceContactId: "missing-source-contact",
  assigneeMemberId: null, rawChannel: null, rawStatus: null, subject: null,
  sourceCreatedAt: null, sourceUpdatedAt: null,
};
function setup(contactExists = true) {
  const result = { id: "019b0000-0000-7000-8000-000000000002", status: "CREATED" as const };
  const repository: HistoricalConversationRepository = {
    importThread: vi.fn(async () => result), importMessage: vi.fn(async () => result),
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
    find: vi.fn(async () => null), messages: vi.fn(async () => null),
    verifyImports: vi.fn(async () => ({ threadCount: 0, messageCount: 0, mappedThreadCount: 0, mappedMessageCount: 0, unresolvedThreadCount: 0, unresolvedContactThreadCount: 0, inconsistentMessageCount: 0, invalidParentCount: 0, outboxCount: 0 })),
  };
  const references = { contactExistsFor: vi.fn(async () => contactExists), isActiveMember: vi.fn(async () => true) };
  return { repository, references, service: new HistoricalConversationService(repository, references) };
}

describe("historical conversations", () => {
  it("preserves empty body, unknown provider channel, pending source status and original date without a send command", async () => {
    const { service, repository } = setup();
    await service.importMessage({ actor, permissions: ["crm:conversations:configure"], source, threadSourceExternalId: "absent-thread", message });
    expect(repository.importMessage).toHaveBeenCalledWith(expect.objectContaining({ message }));
    expect(message.body).toBe("");
    expect(message.rawStatus).toBe("pending");
  });

  it("preserves whitespace and HTML as original inert text", async () => {
    const { service, repository } = setup();
    const body = "  <script>source text only</script>\n" + "a".repeat(17_000);
    await service.importMessage({ actor, permissions: ["crm:conversations:configure"], source, threadSourceExternalId: "source-thread", message: { ...message, body } });
    expect(repository.importMessage).toHaveBeenCalledWith(expect.objectContaining({ message: expect.objectContaining({ body }) }));
  });

  it("requires profile scope and configuration permission before any write", async () => {
    const { service, repository } = setup();
    await expect(service.importThread({ actor, permissions: [], source, thread })).rejects.toBeInstanceOf(IamAuthorizationError);
    await expect(service.importMessage({ actor: { ...actor, scope: "OWN" }, permissions: ["crm:conversations:configure"], source, threadSourceExternalId: "source-thread", message })).rejects.toBeInstanceOf(IamAuthorizationError);
    expect(repository.importThread).not.toHaveBeenCalled();
    expect(repository.importMessage).not.toHaveBeenCalled();
  });

  it("keeps absent source threads and contacts explicitly unresolved", async () => {
    const { service, repository, references } = setup();
    await service.importThread({ actor, permissions: ["crm:conversations:configure"], source, thread });
    expect(repository.importThread).toHaveBeenCalledWith(expect.objectContaining({ thread }));
    expect(references.contactExistsFor).not.toHaveBeenCalled();
    expect(references.isActiveMember).not.toHaveBeenCalled();
  });

  it("rejects a supplied contact mapping that the owning module cannot confirm", async () => {
    const { service, repository } = setup(false);
    await expect(service.importThread({ actor, permissions: ["crm:conversations:configure"], source, thread: { ...thread, contactId: "019b0000-0000-7000-8000-000000000003" } })).rejects.toBeInstanceOf(HistoricalConversationNotFoundError);
    expect(repository.importThread).not.toHaveBeenCalled();
  });

  it("rejects invalid dates and PostgreSQL-incompatible NUL content instead of truncating", async () => {
    const { service, repository } = setup();
    for (const invalid of [{ ...message, sourceCreatedAt: new Date("invalid") }, { ...message, body: "source\u0000text" }]) {
      await expect(service.importMessage({ actor, permissions: ["crm:conversations:configure"], source, threadSourceExternalId: "source-thread", message: invalid })).rejects.toBeInstanceOf(HistoricalImportValidationError);
    }
    expect(repository.importMessage).not.toHaveBeenCalled();
  });

  it("protects historical reads and enforces bounded pagination", async () => {
    const { service, repository } = setup();
    await expect(service.list(actor, [], { limit: 50 })).rejects.toBeInstanceOf(IamAuthorizationError);
    await expect(service.list(actor, ["crm:conversations:read"], { limit: 101 })).rejects.toBeInstanceOf(HistoricalImportValidationError);
    await expect(service.messages(actor, ["crm:conversations:read"], "019b0000-0000-7000-8000-000000000002", { limit: 50 })).rejects.toBeInstanceOf(HistoricalConversationNotFoundError);
    expect(repository.list).not.toHaveBeenCalled();
  });
});
