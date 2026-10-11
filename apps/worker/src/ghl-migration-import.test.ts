import type {
  GhlImportOperationIdentity, HistoricalImportContext, HistoricalImportResult,
  HistoricalImportSource,
} from "@quantum-crm/domain";
import { describe, expect, it, vi } from "vitest";

import { importGhlArtifact, type GhlMigrationImportPorts } from "./ghl-migration-import.js";
import {
  importStreams, type GhlImportArtifact, type ImportRecord, type ImportStream,
} from "./ghl-migration-import-artifact.js";

const memberId = "019b0000-0000-7000-8000-000000000001";
const identity: GhlImportOperationIdentity = {
  operationId: "019b0000-0000-7000-8000-000000000002",
  tenantId: "019b0000-0000-7000-8000-000000000003",
  exportId: "019b0000-0000-7000-8000-000000000004",
  locationId: "synthetic_location", artifactSha256: "a".repeat(64),
  currency: "GTQ", operatorMemberId: memberId,
};
const context: HistoricalImportContext = {
  actor: { memberId, scope: "PROFILE" },
  permissions: ["crm:contacts:create", "crm:sales:create", "crm:sales:configure", "crm:conversations:configure"],
};
const contactRecord: ImportRecord = {
  id: "contact_one", locationId: identity.locationId, firstName: "Synthetic", lastName: "Contact",
  email: "synthetic@example.test", tags: ["VIP"],
  customFields: [{ id: "field_file", value: "https://files.example.test/a?token=synthetic-private" }],
  assignedTo: "source_advisor", dateAdded: "2024-01-01T00:00:00Z",
};

function fixture(overrides: Partial<Record<ImportStream, readonly ImportRecord[]>> = {}): GhlImportArtifact {
  const records = new Map<ImportStream, readonly ImportRecord[]>(importStreams.map((stream) => [stream, []]));
  records.set("CUSTOM_FIELDS", [{ id: "field_file", fieldKey: "contact.file", name: "File", dataType: "FILE_UPLOAD", locationId: identity.locationId }]);
  records.set("TAGS", [{ id: "tag_one", name: "VIP", locationId: identity.locationId }]);
  records.set("CONTACTS", [contactRecord]);
  records.set("PIPELINES", [{ id: "pipeline_one", name: "Synthetic pipeline", locationId: identity.locationId,
    stages: [{ id: "stage_two", name: "Second", position: 9 }, { id: "stage_one", name: "First", position: 2 }] }]);
  records.set("OPPORTUNITIES", [{ id: "opportunity_one", contactId: "contact_one", pipelineId: "pipeline_one", pipelineStageId: "stage_two",
    name: "Synthetic opportunity", monetaryValue: "25.60", status: "open", locationId: identity.locationId }]);
  records.set("MESSAGES_NON_EMAIL", [{ id: "message_one", conversationId: "missing_thread", contactId: "deleted_contact",
    body: "", type: 19, messageType: "TYPE_SMS", attachments: ["https://files.example.test/a?token=synthetic"], locationId: identity.locationId }]);
  for (const stream of importStreams) if (overrides[stream]) records.set(stream, overrides[stream]);
  return { records, generatedAt: new Date("2026-10-11T12:00:00Z"),
    recordCount: [...records.values()].reduce((sum, rows) => sum + rows.length, 0),
    locationId: identity.locationId, exportId: identity.exportId };
}

function harness() {
  const ledger = new Map<string, { id: string; hash: string; localValue: string }>();
  let sequence = 10;
  let failContactId: string | null = null;
  const mapped = (kind: string, origin: HistoricalImportSource, localValue = ""): HistoricalImportResult => {
    const key = `${kind}:${origin.externalId}`;
    const previous = ledger.get(key);
    if (previous) return { id: previous.id, status: previous.hash === origin.payloadHash ? "REPLAYED" : "SOURCE_CHANGED" };
    const id = `019b0000-0000-7000-8000-${String(sequence++).padStart(12, "0")}`;
    ledger.set(key, { id, hash: origin.payloadHash, localValue });
    return { id, status: "CREATED" };
  };
  const ports: GhlMigrationImportPorts = {
    settings: { importCustomField: vi.fn(async (input) => mapped("field", input.source)) },
    contacts: {
      importLabel: vi.fn(async (input) => mapped("label", input.source)),
      importContact: vi.fn(async (input) => {
        if (input.source.externalId === failContactId) { failContactId = null; throw new Error("Synthetic interruption"); }
        return mapped("contact", input.source, input.displayName);
      }),
    },
    sales: {
      importPipeline: vi.fn(async (input) => ({ ...mapped("pipeline", input.source),
        stages: input.stages.map((stage, index) => ({ externalId: stage.externalId,
          id: `019b0000-0000-7000-8000-${String(100 + index).padStart(12, "0")}` })) })),
      importOpportunity: vi.fn(async (input) => mapped("opportunity", input.source)),
    },
    conversations: {
      importThread: vi.fn(async (input) => mapped("thread", input.source)),
      importMessage: vi.fn(async (input) => mapped("message", input.source)),
    },
    operations: {
      begin: vi.fn(async () => undefined), checkpoint: vi.fn(async () => undefined),
      finish: vi.fn(async () => undefined), inspect: vi.fn(async () => null), close: vi.fn(async () => undefined),
    },
  };
  return { ports, ledger, failNextContact: (id: string) => { failContactId = id; } };
}

describe("GHL import orchestration", () => {
  it("preserves orphan history, GTQ cents, ordered stages and private attachment references through historical ports", async () => {
    const { ports } = harness();
    const result = await importGhlArtifact(fixture(), identity, context, ports);
    expect(result).toMatchObject({ status: "COMPLETE", historicalThreadsWithoutCurrentSource: 1, attachmentReferencesPending: 1 });
    expect(ports.contacts.importContact).toHaveBeenCalledTimes(1);
    expect(ports.contacts.importContact).toHaveBeenCalledWith(expect.objectContaining({
      ownerMemberId: null, customFields: [expect.objectContaining({ value: { pendingFileMigration: true } })],
    }));
    const contactInput = vi.mocked(ports.contacts.importContact).mock.calls[0]?.[0];
    expect(JSON.stringify(contactInput?.source.raw)).not.toContain("synthetic-private");
    expect(ports.sales.importOpportunity).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 2560n, currency: "GTQ", ownerMemberId: memberId }));
    const pipeline = vi.mocked(ports.sales.importPipeline).mock.calls[0]?.[0];
    expect(pipeline?.stages.map((stage) => [stage.externalId, stage.position])).toEqual([["stage_one", 1], ["stage_two", 2]]);
    expect(ports.conversations.importThread).toHaveBeenCalledWith(expect.objectContaining({
      thread: expect.objectContaining({ sourceThreadPresent: false, sourceContactId: "deleted_contact", contactId: null }),
    }));
    expect(ports.conversations.importMessage).toHaveBeenCalledWith(expect.objectContaining({
      threadSourceExternalId: "missing_thread", message: expect.objectContaining({ body: "", attachmentCount: 1, rawType: "19" }),
    }));
    expect(ports.operations.finish).toHaveBeenCalledWith("COMPLETE");
    // The composed dependency surface contains only historical import methods; no live-send method.
    expect(Object.keys(ports.conversations).sort()).toEqual(["importMessage", "importThread"]);
  });

  it("resumes a partial import through stable mappings while preserving edits made in Quantum", async () => {
    const { ports, ledger, failNextContact } = harness();
    const artifact = fixture({ CONTACTS: [contactRecord, { ...contactRecord, id: "contact_two" }] });
    failNextContact("contact_two");
    await expect(importGhlArtifact(artifact, identity, context, ports)).rejects.toThrow("CONTACTS batch failed");
    expect(ports.operations.finish).toHaveBeenCalledWith("FAILED");
    const first = ledger.get("contact:contact_one");
    if (!first) throw new Error("Synthetic contact was not persisted");
    first.localValue = "Edited in Quantum";
    const result = await importGhlArtifact(artifact, identity, context, ports);
    expect(result.status).toBe("COMPLETE");
    expect(result.progress.find((item) => item.resource === "CONTACTS")).toMatchObject({ created: 1, replayed: 1, processed: 2 });
    expect(ledger.get("contact:contact_one")?.localValue).toBe("Edited in Quantum");
    expect([...ledger.keys()].filter((name) => name.startsWith("contact:"))).toHaveLength(2);
    expect(ports.operations.close).toHaveBeenCalledTimes(2);
    const changedSource = fixture({ CONTACTS: [{ ...contactRecord, firstName: "Changed at source" }, { ...contactRecord, id: "contact_two" }] });
    const conflicted = await importGhlArtifact(changedSource, identity, context, ports);
    expect(conflicted.status).toBe("CONFLICTS");
    expect(conflicted.progress.find((item) => item.resource === "CONTACTS")?.conflicts).toBe(1);
    expect(ledger.get("contact:contact_one")?.localValue).toBe("Edited in Quantum");
  });

  it("rejects invalid references and adapter-incompatible values before beginning destination work", async () => {
    const cases = [
      fixture({ OPPORTUNITIES: [{ id: "bad", contactId: "absent", pipelineId: "pipeline_one", pipelineStageId: "stage_one", name: "Bad", monetaryValue: 1, status: "open" }] }),
      fixture({ CONTACTS: [{ ...contactRecord, phone: "1" }] }),
      fixture({ TAGS: [{ id: "long_tag", name: "x".repeat(81) }] }),
    ];
    for (const artifact of cases) {
      const { ports } = harness();
      await expect(importGhlArtifact(artifact, identity, context, ports)).rejects.toThrow();
      expect(ports.operations.begin).not.toHaveBeenCalled();
      expect(ports.settings.importCustomField).not.toHaveBeenCalled();
    }
  });

  it("denies mismatched source/operator and insufficient scope before writes", async () => {
    const cases = [
      { artifact: { ...fixture(), locationId: "other_location" }, context },
      { artifact: fixture(), context: { ...context, actor: { ...context.actor, memberId: identity.tenantId } } },
      { artifact: fixture(), context: { ...context, actor: { ...context.actor, scope: "OWN" as const } } },
    ];
    for (const input of cases) {
      const { ports } = harness();
      await expect(importGhlArtifact(input.artifact, identity, input.context, ports)).rejects.toThrow("mismatch");
      expect(ports.operations.begin).not.toHaveBeenCalled();
    }
  });
});
