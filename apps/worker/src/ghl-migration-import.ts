import { createHash } from "node:crypto";
import type {
  GhlImportOperationIdentity,
  GhlImportOperationRepository,
  GhlImportProgress,
  HistoricalContactImportPort,
  HistoricalSettingsImportPort,
  HistoricalSalesImportPort,
  HistoricalConversationService,
  HistoricalImportContext,
  HistoricalImportResult,
  HistoricalContactField,
  OpportunityStatus,
} from "@quantum-crm/domain";
import {
  array,
  date,
  identifier,
  moneyMinor,
  object,
  optionalText,
  source,
  text,
  type GhlImportArtifact,
  type ImportRecord,
  type ImportStream,
} from "./ghl-migration-import-artifact.js";

export interface GhlMigrationImportPorts {
  readonly contacts: HistoricalContactImportPort;
  readonly settings: HistoricalSettingsImportPort;
  readonly sales: HistoricalSalesImportPort;
  readonly conversations: Pick<HistoricalConversationService, "importThread" | "importMessage">;
  readonly operations: GhlImportOperationRepository;
}

export interface GhlImportSummary {
  readonly status: "COMPLETE" | "CONFLICTS";
  readonly progress: readonly GhlImportProgress[];
  readonly historicalThreadsWithoutCurrentSource: number;
  readonly attachmentReferencesPending: number;
}

function requiredMap(map: ReadonlyMap<string, string>, key: string): string {
  const result = map.get(key);
  if (!result) throw new Error("Unresolved import reference");
  return result;
}
function normalizeName(record: ImportRecord): string {
  const name =
    optionalText(record.contactName, 160) ??
    [optionalText(record.firstName, 160), optionalText(record.lastName, 160)]
      .filter(Boolean)
      .join(" ");
  if (!name.trim()) return "Contacto sin nombre en GHL";
  return text(name, 160);
}
function status(value: unknown): OpportunityStatus {
  const result = text(value).toUpperCase();
  if (result !== "OPEN" && result !== "WON" && result !== "LOST" && result !== "ABANDONED")
    throw new Error("Unsupported opportunity status");
  return result;
}

/** Compose public module ports only. No HTTP, SQL, queue or provider sends. */
export async function importGhlArtifact(
  artifact: GhlImportArtifact,
  identity: GhlImportOperationIdentity,
  context: HistoricalImportContext,
  ports: GhlMigrationImportPorts,
  onProgress: (progress: GhlImportProgress) => void = () => undefined,
): Promise<GhlImportSummary> {
  if (
    identity.operatorMemberId !== context.actor.memberId ||
    context.actor.scope !== "PROFILE" ||
    artifact.locationId !== identity.locationId ||
    artifact.exportId !== identity.exportId ||
    !(
      [
        "crm:contacts:create",
        "crm:sales:create",
        "crm:sales:configure",
        "crm:conversations:configure",
      ] as const
    ).every((permission) => context.permissions.includes(permission))
  ) {
    throw new Error("Import authorization or identity mismatch");
  }
  const rows = (stream: ImportStream) => artifact.records.get(stream) ?? [];
  const definitions = new Map(
    rows("CUSTOM_FIELDS").map((record) => [identifier(record.id), record]),
  );
  const contactSourceIds = new Set(rows("CONTACTS").map((record) => identifier(record.id)));
  const pipelineSources = new Map(
    rows("PIPELINES").map((record) => [identifier(record.id), record]),
  );
  const messages = [...rows("MESSAGES_NON_EMAIL"), ...rows("MESSAGES_EMAIL")];
  const threadSources = new Map(
    rows("CONVERSATIONS").map((record) => [identifier(record.id), record]),
  );
  const missingThreads = new Map<string, Set<string>>();
  let attachmentReferencesPending = 0;
  // Complete shape/reference preflight before the first destination mutation.
  for (const record of rows("CUSTOM_FIELDS")) {
    text(record.name, 1000);
    text(record.fieldKey, 1000);
    text(record.dataType, 80);
  }
  for (const record of rows("CONTACTS")) {
    normalizeName(record);
    const email = optionalText(record.email, 320),
      phone = optionalText(record.phone, 40);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
      throw new Error("Invalid imported email");
    if (phone && phone.length < 3) throw new Error("Invalid imported phone");
    for (const tag of array(record.tags ?? []))
      if (!text(tag, 80).trim()) throw new Error("Invalid imported tag");
    date(record.dateAdded);
    date(record.dateUpdated);
    for (const field of array(record.customFields ?? [])) {
      if (!definitions.has(identifier(object(field).id)))
        throw new Error("Missing custom field definition");
    }
  }
  for (const record of rows("PIPELINES")) {
    text(record.name, 160);
    date(record.dateAdded);
    const seen = new Set<string>();
    for (const item of array(record.stages)) {
      const stage = object(item);
      const id = identifier(stage.id);
      if (seen.has(id)) throw new Error("Duplicate pipeline stage");
      seen.add(id);
      text(stage.name, 160);
    }
  }
  for (const record of rows("OPPORTUNITIES")) {
    if (!contactSourceIds.has(identifier(record.contactId)))
      throw new Error("Opportunity contact missing");
    const pipeline = pipelineSources.get(identifier(record.pipelineId));
    if (
      !pipeline ||
      !array(pipeline.stages).some((stage) => object(stage).id === record.pipelineStageId)
    )
      throw new Error("Opportunity stage missing");
    text(record.name, 160);
    moneyMinor(record.monetaryValue);
    status(record.status);
    date(record.createdAt);
    date(record.updatedAt);
    date(record.lastStatusChangeAt);
  }
  for (const record of messages) {
    const threadId = identifier(record.conversationId);
    const sourceContactId = identifier(record.contactId);
    if (!threadSources.has(threadId)) {
      const contacts = missingThreads.get(threadId) ?? new Set<string>();
      contacts.add(sourceContactId);
      missingThreads.set(threadId, contacts);
    }
    text(record.body ?? "");
    date(record.dateAdded);
    date(record.dateUpdated);
    attachmentReferencesPending += array(record.attachments ?? []).length;
  }

  const contactIds = new Map<string, string>();
  const fieldIds = new Map<string, string>();
  const labelIds = new Map<string, string>();
  const pipelineIds = new Map<string, string>();
  const stageIds = new Map<string, string>();
  const progress: GhlImportProgress[] = [];
  for (const tag of rows("TAGS"))
    if (!text(tag.name, 80).trim()) throw new Error("Invalid imported tag");
  const run = async <T>(
    resource: string,
    records: readonly T[],
    apply: (record: T) => Promise<HistoricalImportResult>,
    concurrency = 1,
  ) => {
    let created = 0,
      replayed = 0,
      conflicts = 0,
      processed = 0;
    for (let offset = 0; offset < records.length; offset += 100) {
      const batch = records.slice(offset, offset + 100);
      for (let start = 0; start < batch.length; start += concurrency) {
        // allSettled ensures an in-flight sibling cannot continue after lock release on error.
        const results = await Promise.allSettled(
          batch.slice(start, start + concurrency).map(apply),
        );
        let failed = false;
        for (const result of results) {
          if (result.status === "rejected") {
            failed = true;
            continue;
          }
          processed++;
          if (result.value.status === "CREATED") created++;
          else if (result.value.status === "REPLAYED") replayed++;
          else conflicts++;
        }
        if (failed) throw new Error(`Import ${resource} batch failed`);
      }
      const checkpoint = {
        resource,
        total: records.length,
        processed,
        created,
        replayed,
        conflicts,
      };
      await ports.operations.checkpoint(checkpoint);
      onProgress(checkpoint);
    }
    const final = { resource, total: records.length, processed, created, replayed, conflicts };
    await ports.operations.checkpoint(final);
    progress.push(final);
  };
  await ports.operations.begin(identity);
  try {
    await run("CUSTOM_FIELDS", rows("CUSTOM_FIELDS"), async (record) => {
      const result = await ports.settings.importCustomField({
        ...context,
        source: source(identity.locationId, record),
        key: text(record.fieldKey, 1000),
        name: text(record.name, 1000),
        description: optionalText(record.placeholder) ?? "",
        dataType: text(record.dataType, 80),
        section: optionalText(record.model) ?? "contact",
        options: record.picklistOptions ?? [],
      });
      fieldIds.set(identifier(record.id), result.id);
      return result;
    });
    const tags = [...rows("TAGS")];
    const names = new Set(tags.map((record) => text(record.name).trim().toLowerCase()));
    for (const record of rows("CONTACTS"))
      for (const tag of array(record.tags ?? [])) {
        const name = text(tag, 80).trim();
        const key = name.toLowerCase();
        if (!names.has(key)) {
          names.add(key);
          tags.push({
            id: `derived_${createHash("sha256").update(key).digest("hex")}`,
            name,
            locationId: identity.locationId,
          });
        }
      }
    await run("TAGS", tags, async (record) => {
      const name = text(record.name, 80).trim();
      const result = await ports.contacts.importLabel({
        ...context,
        source: source(identity.locationId, record),
        name,
      });
      labelIds.set(name.toLowerCase(), result.id);
      return result;
    });
    await run("CONTACTS", rows("CONTACTS"), async (record) => {
      const customFields: HistoricalContactField[] = array(record.customFields ?? []).map(
        (item) => {
          const field = object(item);
          const id = identifier(field.id);
          const definition = definitions.get(id);
          if (!definition) throw new Error("Missing custom field definition");
          return {
            fieldId: requiredMap(fieldIds, id),
            key: text(definition.fieldKey),
            label: text(definition.name),
            dataType: text(definition.dataType),
            value:
              definition.dataType === "FILE_UPLOAD"
                ? { pendingFileMigration: true }
                : (field.value ?? null),
          };
        },
      );
      const safeRecord = {
        ...record,
        customFields: array(record.customFields ?? []).map((item) => {
          const field = object(item);
          return definitions.get(identifier(field.id))?.dataType === "FILE_UPLOAD"
            ? { ...field, value: "[ARCHIVO EN EXPORTACION CIFRADA]" }
            : field;
        }),
      };
      const origin = source(identity.locationId, record);
      const result = await ports.contacts.importContact({
        ...context,
        source: { ...origin, raw: source(identity.locationId, safeRecord).raw },
        displayName: normalizeName(record),
        email: optionalText(record.email, 320),
        phone: optionalText(record.phone, 40),
        ownerMemberId: null,
        labelIds: [
          ...new Set(
            array(record.tags ?? []).map((tag) =>
              requiredMap(labelIds, text(tag).trim().toLowerCase()),
            ),
          ),
        ],
        customFields,
        createdAt: date(record.dateAdded) ?? artifact.generatedAt,
        updatedAt: date(record.dateUpdated) ?? date(record.dateAdded) ?? artifact.generatedAt,
      });
      contactIds.set(identifier(record.id), result.id);
      return result;
    });
    await run("PIPELINES", rows("PIPELINES"), async (record) => {
      const stages = [...array(record.stages)]
        .map(object)
        .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
      const result = await ports.sales.importPipeline({
        ...context,
        source: source(identity.locationId, record),
        name: text(record.name, 160),
        description: "Importado de GHL. El origen no proporciona descripción.",
        createdAt: date(record.dateAdded) ?? artifact.generatedAt,
        stages: stages.map((stage, position) => ({
          externalId: identifier(stage.id),
          name: text(stage.name, 160),
          description: "Etapa importada de GHL; sin descripción de origen.",
          position: position + 1,
        })),
      });
      pipelineIds.set(identifier(record.id), result.id);
      for (const stage of result.stages)
        stageIds.set(`${identifier(record.id)}:${stage.externalId}`, stage.id);
      return result;
    });
    await run("OPPORTUNITIES", rows("OPPORTUNITIES"), async (record) => {
      const state = status(record.status);
      const closedAt =
        state === "OPEN"
          ? null
          : (date(record.lastStatusChangeAt) ?? date(record.updatedAt) ?? artifact.generatedAt);
      return ports.sales.importOpportunity({
        ...context,
        source: source(identity.locationId, record),
        contactId: requiredMap(contactIds, identifier(record.contactId)),
        pipelineId: requiredMap(pipelineIds, identifier(record.pipelineId)),
        stageId: requiredMap(
          stageIds,
          `${identifier(record.pipelineId)}:${identifier(record.pipelineStageId)}`,
        ),
        ownerMemberId: identity.operatorMemberId,
        title: text(record.name, 160),
        amountMinor: moneyMinor(record.monetaryValue),
        currency: identity.currency,
        status: state,
        closeReason:
          state === "LOST" || state === "ABANDONED"
            ? "Importado de GHL; motivo original no disponible en la exportación."
            : null,
        closedAt,
        createdAt: date(record.createdAt) ?? artifact.generatedAt,
        updatedAt: date(record.updatedAt) ?? date(record.createdAt) ?? artifact.generatedAt,
      });
    });
    const threads: { record: ImportRecord; present: boolean }[] = rows("CONVERSATIONS").map(
      (record) => ({ record, present: true }),
    );
    for (const [id, contactSet] of missingThreads)
      threads.push({
        record: {
          id,
          locationId: identity.locationId,
          contactId: contactSet.size === 1 ? ([...contactSet][0] ?? null) : null,
        },
        present: false,
      });
    await run("CONVERSATIONS", threads, async ({ record, present }) => {
      const contactId = optionalText(record.contactId);
      return ports.conversations.importThread({
        ...context,
        source: source(identity.locationId, record),
        thread: {
          sourceThreadPresent: present,
          sourceContactId: contactId,
          contactId: contactId ? (contactIds.get(contactId) ?? null) : null,
          assigneeMemberId: null,
          rawChannel: optionalText(record.lastMessageType),
          rawStatus: null,
          subject:
            optionalText(record.contactName) ??
            optionalText(record.fullName) ??
            (present
              ? "Conversación importada de GHL"
              : "Conversación histórica sin ficha actual en GHL"),
          sourceCreatedAt: date(record.dateAdded),
          sourceUpdatedAt: date(record.dateUpdated),
        },
      });
    });
    await run(
      "MESSAGES",
      messages,
      (record) =>
        ports.conversations.importMessage({
          ...context,
          source: source(identity.locationId, record),
          threadSourceExternalId: identifier(record.conversationId),
          message: {
            sourceContactId: optionalText(record.contactId),
            rawChannel: optionalText(record.messageType),
            rawType: record.type === undefined ? null : String(record.type),
            rawDirection: optionalText(record.direction),
            rawStatus: optionalText(record.status),
            body: text(record.body ?? ""),
            attachmentCount: array(record.attachments ?? []).length,
            sourceCreatedAt: date(record.dateAdded),
            sourceUpdatedAt: date(record.dateUpdated),
          },
        }),
      4,
    );
    const result: GhlImportSummary = {
      status: progress.some((item) => item.conflicts > 0) ? "CONFLICTS" : "COMPLETE",
      progress,
      historicalThreadsWithoutCurrentSource: missingThreads.size,
      attachmentReferencesPending,
    };
    await ports.operations.finish(result.status);
    return result;
  } catch (error) {
    await ports.operations.finish("FAILED").catch(() => undefined);
    throw error;
  } finally {
    await ports.operations.close();
  }
}
