import { createHash, randomUUID } from "node:crypto";
import { parseDatabaseConfig } from "@quantum-crm/config";
import {
  acquireGhlAttachmentImportGuard,
  createContactsHistoricalImportPort,
  createCrmPostgresDatabase,
  createGhlImportOperationRepository,
  createHistoricalConversationPostgresRepository,
  createSalesHistoricalImportPort,
  createSettingsHistoricalImportPort,
} from "@quantum-crm/database";
import {
  HistoricalConversationService,
  HistoricalAttachmentConflictError,
  FileService,
  FileNotFoundError,
  FileStateConflictError,
  HistoricalImportValidationError,
  IamAuthorizationError,
  type CommercialActor,
  type HistoricalImportContext,
  type HistoricalImportSource,
  type HistoricalJsonValue,
  type HistoricalMessageInput,
  type HistoricalThreadInput,
} from "@quantum-crm/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tenantA = "00000000-0000-4000-8000-00000000000a";
const tenantB = "00000000-0000-4000-8000-00000000000b";
function configuration(tenantId: string, path: string) {
  return parseDatabaseConfig(
    "ghl-historical-import-integration",
    { target: "crm", requiresTenant: true },
    "test",
    {
      QCRM_TENANT_ID: tenantId,
      QCRM_DATABASE_URL_FILE: path,
    },
  );
}
const configA = configuration(tenantA, "/run/secrets/ghl_import_test_a_database_url");
const configB = configuration(tenantB, "/run/secrets/ghl_import_test_b_database_url");
const poolA = new Pool({
  connectionString: configA.connectionUrl.expose(),
  max: 5,
  connectionTimeoutMillis: 5000,
});
const poolB = new Pool({
  connectionString: configB.connectionUrl.expose(),
  max: 5,
  connectionTimeoutMillis: 5000,
});
const databaseA = createCrmPostgresDatabase(configA, "ghl-integration-a");
const databaseB = createCrmPostgresDatabase(configB, "ghl-integration-b");
const actor: CommercialActor = { memberId: randomUUID(), scope: "PROFILE" };
const context: HistoricalImportContext = {
  actor,
  permissions: [
    "crm:contacts:create",
    "crm:sales:create",
    "crm:sales:configure",
    "crm:conversations:configure",
    "crm:conversations:read",
  ],
};
const originalAt = new Date("2020-02-03T14:05:06.000Z");

function source(
  locationId: string,
  externalId: string,
  raw: HistoricalJsonValue = {},
): HistoricalImportSource {
  return {
    system: "GHL",
    locationId,
    externalId,
    raw,
    payloadHash: createHash("sha256").update(JSON.stringify(raw)).digest("hex"),
  };
}
const membersA = {
  isActive: async (memberId: string) =>
    (await databaseA.members.findById(memberId))?.status === "ACTIVE",
};
const contactsA = createContactsHistoricalImportPort(poolA, membersA);
const salesA = createSalesHistoricalImportPort(poolA, {
  contacts: {
    existsFor: async (viewer, contactId) =>
      (await databaseA.commercial.contacts.find(viewer, contactId)) !== null,
  },
  members: membersA,
});
const settingsA = createSettingsHistoricalImportPort(poolA);
const historyA = new HistoricalConversationService(
  createHistoricalConversationPostgresRepository(poolA),
  {
    contactExistsFor: async (viewer, contactId) =>
      (await databaseA.commercial.contacts.find(viewer, contactId)) !== null,
    isActiveMember: membersA.isActive,
  },
);
const historyB = new HistoricalConversationService(
  createHistoricalConversationPostgresRepository(poolB),
  {
    contactExistsFor: async (viewer, contactId) =>
      (await databaseB.commercial.contacts.find(viewer, contactId)) !== null,
    isActiveMember: async (memberId) =>
      (await databaseB.members.findById(memberId))?.status === "ACTIVE",
  },
);
function orphan(): HistoricalThreadInput {
  return {
    sourceThreadPresent: false,
    contactId: null,
    sourceContactId: "absent-source-contact",
    assigneeMemberId: null,
    rawChannel: null,
    rawStatus: null,
    subject: null,
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
  };
}
function message(): HistoricalMessageInput {
  return {
    sourceContactId: "absent-source-contact",
    rawChannel: "TYPE_CALL",
    rawType: "1",
    rawDirection: "outbound",
    rawStatus: "pending",
    body: "",
    attachmentCount: 2,
    sourceCreatedAt: originalAt,
    sourceUpdatedAt: null,
  };
}

beforeAll(async () => {
  // Hard fail before any write if a fixture points at a real profile or an elevated role.
  for (const [pool, tenantId] of [
    [poolA, tenantA],
    [poolB, tenantB],
  ] as const) {
    const suffix = tenantId.replaceAll("-", "");
    const identity = await pool.query<{ database_name: string; runtime_role: string }>(
      "SELECT current_database() AS database_name, current_user AS runtime_role",
    );
    expect(identity.rows[0]).toEqual({
      database_name: `qcrm_t_${suffix}`,
      runtime_role: `qcrm_r_${suffix}`,
    });
    await pool.query(
      `INSERT INTO iam.members(id, oidc_subject, display_name, email, status, commercial_scope)
      VALUES ($1::uuid, $2, 'Synthetic GHL integration operator', $3, 'active', 'profile')`,
      [actor.memberId, `ghl-fixture-${actor.memberId}`, `ghl-${actor.memberId}@example.test`],
    );
    await pool.query(
      "INSERT INTO iam.member_roles(member_id, role_id) SELECT $1::uuid, id FROM iam.roles WHERE code = 'ADMINISTRATOR'",
      [actor.memberId],
    );
  }
  await Promise.all([databaseA.connect(), databaseB.connect()]);
});
afterAll(async () => {
  // This suite owns only synthetic rows in the disposable profiles; host setup owns disposal.
  await Promise.all([databaseA.close(), databaseB.close(), poolA.end(), poolB.end()]);
});

describe("GHL imports against migrated PostgreSQL runtime roles", () => {
  it("reserves attachments once, audits retries, binds immutable files and authorizes through the scoped historical thread", async () => {
    const locationId = randomUUID();
    const viewer: CommercialActor = { memberId: randomUUID(), scope: "OWN" };
    const stranger: CommercialActor = { memberId: randomUUID(), scope: "OWN" };
    await poolA.query(
      `INSERT INTO iam.members(id, oidc_subject, display_name, email, status, commercial_scope)
      VALUES ($1::uuid, $2, 'Synthetic attachment viewer', $3, 'active', 'own')`,
      [viewer.memberId, `ghl-fixture-${viewer.memberId}`, `ghl-${viewer.memberId}@example.test`],
    );
    const contact = await contactsA.importContact({
      ...context,
      source: source(locationId, "contact"),
      displayName: "Synthetic attachment contact",
      email: null,
      phone: null,
      ownerMemberId: viewer.memberId,
      labelIds: [],
      customFields: [],
      createdAt: originalAt,
      updatedAt: originalAt,
    });
    const thread = await historyA.importThread({
      ...context,
      source: source(locationId, "thread"),
      thread: {
        ...orphan(),
        sourceThreadPresent: true,
        contactId: contact.id,
        assigneeMemberId: viewer.memberId,
      },
    });
    await historyA.importMessage({
      ...context,
      source: source(locationId, "message"),
      threadSourceExternalId: "thread",
      message: message(),
    });
    const input = {
      locationId,
      externalMessageId: "message",
      attachmentIndex: 0,
      sourceHash: "a".repeat(64),
    };
    const [first, replay] = await Promise.all([
      historyA.reserveAttachment(context, input),
      historyA.reserveAttachment(context, input),
    ]);
    expect(first.id).toBe(replay.id);
    await expect(
      historyA.reserveAttachment(context, { ...input, sourceHash: "b".repeat(64) }),
    ).rejects.toBeInstanceOf(HistoricalAttachmentConflictError);
    await expect(
      historyA.reserveAttachment(context, { ...input, attachmentIndex: 2 }),
    ).rejects.toBeInstanceOf(HistoricalImportValidationError);
    expect(await historyA.canUseAttachmentOwner(viewer, first.id)).toBe(true);
    expect(await historyA.canUseAttachmentOwner(stranger, first.id)).toBe(false);
    expect(await historyB.canUseAttachmentOwner(actor, first.id)).toBe(false);

    // This test verifies persisted authorization and association, not storage/antivirus behavior.
    const storage = {
      authorizeUpload: async () => ({
        method: "POST" as const,
        url: "https://storage.example.test/upload",
        fields: {},
        expiresAt: new Date(),
      }),
      inspectUpload: async () => ({ versionId: "synthetic-version", receipt: "synthetic-receipt" }),
      authorizeDownload: async () => ({
        method: "GET" as const,
        url: "https://storage.example.test/download",
        objectVersionId: "synthetic-version",
        expiresAt: new Date(),
      }),
    };
    const files = new FileService(
      databaseA.commercial.files,
      {
        canUseOwner: async (who, owner) =>
          owner.kind === "existing" &&
          owner.module === "conversations" &&
          owner.type === "historical_attachment" &&
          historyA.canUseAttachmentOwner(who, owner.id),
      },
      storage,
    );
    const permissions = [
      ...context.permissions,
      "crm:files:read",
      "crm:files:download",
      "crm:files:upload",
      "crm:files:reference",
    ] as const;
    const reserved = await files.reserveUpload({
      actor,
      permissions,
      owner: {
        kind: "existing",
        module: "conversations",
        type: "historical_attachment",
        id: first.id,
      },
      fileClass: "IMAGE",
      originalName: "synthetic.png",
      declaredMime: "image/png",
      declaredSize: 123,
      expectedSha256: "A".repeat(43) + "=",
      idempotencyKey: `attachment-${first.id}`,
      payloadHash: "c".repeat(64),
    });
    const authorizedHistory = new HistoricalConversationService(
      createHistoricalConversationPostgresRepository(poolA),
      { contactExistsFor: async () => true, isActiveMember: async () => true },
      {
        fileForAttachment: async (who, fileId) => {
          const file = await files.get(who, permissions, fileId);
          return {
            id: file.id,
            status: file.status,
            owner: file.owner,
            originalName: file.originalName,
            mimeType: file.observedMime ?? file.declaredMime,
            size: file.observedSize ?? file.declaredSize,
          };
        },
      },
    );
    await authorizedHistory.setAttachmentResult(context, {
      attachmentId: first.id,
      fileId: reserved.file.id,
      status: "PENDING",
      errorCode: null,
    });
    expect((await files.get(viewer, permissions, reserved.file.id)).id).toBe(reserved.file.id);
    await expect(files.get(stranger, permissions, reserved.file.id)).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
    await expect(
      files.authorizeDownload({ actor: viewer, permissions, fileId: reserved.file.id }),
    ).rejects.toBeInstanceOf(FileStateConflictError);
    await expect(
      authorizedHistory.setAttachmentResult(context, {
        attachmentId: first.id,
        fileId: reserved.file.id,
        status: "AVAILABLE",
        errorCode: null,
      }),
    ).rejects.toBeInstanceOf(HistoricalAttachmentConflictError);
    await poolA.query(
      `UPDATE files.files SET status = 'available', object_key = $2, object_version_id = 'synthetic-version',
      verified_sha256 = expected_sha256, available_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
      [reserved.file.id, `objects/${reserved.file.id}`],
    );
    await files.attachReference({
      actor,
      permissions,
      fileId: reserved.file.id,
      owner: {
        kind: "existing",
        module: "conversations",
        type: "historical_attachment",
        id: first.id,
      },
      kind: "ATTACHMENT",
      idempotencyKey: `reference-${first.id}`,
      payloadHash: "d".repeat(64),
    });
    await authorizedHistory.setAttachmentResult(context, {
      attachmentId: first.id,
      fileId: reserved.file.id,
      status: "AVAILABLE",
      errorCode: null,
    });
    await authorizedHistory.setAttachmentResult(context, {
      attachmentId: first.id,
      fileId: reserved.file.id,
      status: "FAILED",
      errorCode: "TRANSFER_FAILED",
    });
    expect((await historyA.reserveAttachment(context, input)).status).toBe("AVAILABLE");
    await expect(
      files.authorizeDownload({ actor: viewer, permissions, fileId: reserved.file.id }),
    ).resolves.toMatchObject({ method: "GET" });
    await expect(
      files.authorizeDownload({ actor: stranger, permissions, fileId: reserved.file.id }),
    ).rejects.toBeInstanceOf(FileNotFoundError);
    expect(
      (await historyA.messages(viewer, permissions, thread.id, { limit: 50 })).items[0]
        ?.attachments,
    ).toHaveLength(1);
    expect(await historyA.verifyAttachments(context, locationId)).toEqual({
      expectedCount: 2,
      reservedCount: 1,
      availableCount: 1,
      pendingCount: 0,
      rejectedCount: 0,
      failedCount: 0,
      missingCount: 1,
      totalBytes: 123,
    });
    const audit = await poolA.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM conversations.historical_attachment_events WHERE attachment_id = $1::uuid",
      [first.id],
    );
    expect(audit.rows[0]?.count).toBe(3);
    expect((await historyA.verifyImports(context, locationId)).outboxCount).toBe(0);
  });

  it("imports fields, labels, contacts, stages and opportunities atomically, then preserves local edits on replay", async () => {
    const locationId = randomUUID();
    const longFieldKey = "k".repeat(1000);
    const longFieldName = "n".repeat(1000);
    const custom = await settingsA.importCustomField({
      ...context,
      source: source(locationId, "field"),
      key: longFieldKey,
      name: longFieldName,
      description: "Synthetic field",
      dataType: "TEXT",
      section: "contact",
      options: [],
    });
    const label = await contactsA.importLabel({
      ...context,
      source: source(locationId, "label"),
      name: `Fixture-${locationId}`,
    });
    const contactInput = {
      ...context,
      source: source(locationId, "contact"),
      displayName: "Synthetic historical contact",
      email: "synthetic@example.test",
      phone: null,
      ownerMemberId: actor.memberId,
      labelIds: [label.id],
      customFields: [
        {
          fieldId: custom.id,
          key: longFieldKey,
          label: longFieldName,
          dataType: "TEXT",
          value: "original",
        },
      ],
      createdAt: originalAt,
      updatedAt: originalAt,
    };
    const concurrent = await Promise.all([
      contactsA.importContact(contactInput),
      contactsA.importContact(contactInput),
    ]);
    expect(concurrent.map((item) => item.status).sort()).toEqual(["CREATED", "REPLAYED"]);
    expect(new Set(concurrent.map((item) => item.id)).size).toBe(1);
    const contactId = concurrent[0]!.id;
    const contact = await databaseA.commercial.contacts.find(actor, contactId);
    expect(contact).toMatchObject({
      displayName: contactInput.displayName,
      createdAt: originalAt,
      customFields: [
        { fieldId: custom.id, key: longFieldKey, label: longFieldName, value: "original" },
      ],
      labels: [{ id: label.id }],
    });
    const pipelineInput = {
      ...context,
      source: source(locationId, "pipeline"),
      name: `Fixture ${locationId}`,
      description: "Synthetic pipeline",
      createdAt: originalAt,
      stages: [
        { externalId: "stage-one", name: "First", description: "", position: 0 },
        { externalId: "stage-two", name: "Second", description: "", position: 1 },
      ],
    };
    const pipeline = await salesA.importPipeline(pipelineInput);
    expect(pipeline.stages).toHaveLength(2);
    const stageId = pipeline.stages.find((stage) => stage.externalId === "stage-one")!.id;
    const opportunityInput = {
      ...context,
      source: source(locationId, "opportunity"),
      contactId,
      pipelineId: pipeline.id,
      stageId,
      ownerMemberId: actor.memberId,
      title: "Synthetic historical opportunity",
      amountMinor: 12345n,
      currency: "GTQ",
      status: "OPEN" as const,
      closeReason: null,
      closedAt: null,
      createdAt: originalAt,
      updatedAt: originalAt,
    };
    const opportunity = await salesA.importOpportunity(opportunityInput);
    expect(await databaseA.commercial.sales.findOpportunity(actor, opportunity.id)).toMatchObject({
      contactId,
      pipelineId: pipeline.id,
      stageId,
      amountMinor: 12345n,
      currency: "GTQ",
      createdAt: originalAt,
    });
    await poolA.query(
      "UPDATE contacts.contacts SET display_name = 'Local edit preserved', version = version + 1 WHERE id = $1::uuid",
      [contactId],
    );
    await poolA.query(
      "UPDATE sales.opportunities SET title = 'Local opportunity edit', version = version + 1 WHERE id = $1::uuid",
      [opportunity.id],
    );
    expect((await contactsA.importContact(contactInput)).status).toBe("REPLAYED");
    expect((await salesA.importOpportunity(opportunityInput)).status).toBe("REPLAYED");
    expect((await salesA.importPipeline(pipelineInput)).stages).toEqual(pipeline.stages);
    expect(
      (
        await contactsA.importContact({
          ...contactInput,
          source: source(locationId, "contact", { changed: true }),
        })
      ).status,
    ).toBe("SOURCE_CHANGED");
    expect((await databaseA.commercial.contacts.find(actor, contactId))?.displayName).toBe(
      "Local edit preserved",
    );
    expect((await databaseA.commercial.sales.findOpportunity(actor, opportunity.id))?.title).toBe(
      "Local opportunity edit",
    );
    await expect(
      contactsA.importContact({
        ...contactInput,
        actor: { ...actor, scope: "OWN" },
        source: source(locationId, "denied-contact"),
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
  });

  it("retains orphan threads, empty messages, dates and attachments without queues; retries and pagination do not duplicate", async () => {
    const locationId = randomUUID();
    const before = await poolA.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM conversations.outbox",
    );
    const threadInput = {
      ...context,
      source: source(locationId, "orphan-thread"),
      thread: orphan(),
    };
    const thread = await historyA.importThread(threadInput);
    const input = {
      ...context,
      source: source(locationId, "message"),
      threadSourceExternalId: "orphan-thread",
      message: message(),
    };
    const repeated = await Promise.all([
      historyA.importMessage(input),
      historyA.importMessage(input),
    ]);
    expect(repeated.map((item) => item.status).sort()).toEqual(["CREATED", "REPLAYED"]);
    expect(
      (
        await historyA.importMessage({
          ...input,
          source: source(locationId, "message", { changed: true }),
          message: { ...message(), body: "must not replace" },
        })
      ).status,
    ).toBe("SOURCE_CHANGED");
    await historyA.importMessage({
      ...input,
      source: source(locationId, "message-two"),
      message: {
        ...message(),
        body: "  <script>inert original text</script>\n",
        sourceCreatedAt: null,
      },
    });
    const visible = await historyA.find(actor, context.permissions, thread.id);
    expect(visible).toMatchObject({
      sourceThreadPresent: false,
      contactId: null,
      sourceCreatedAt: null,
      messageCount: 2,
      lastMessageAt: originalAt,
    });
    expect(visible).not.toHaveProperty("sourceContactId");
    const first = await historyA.messages(actor, context.permissions, thread.id, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      body: "",
      rawChannel: "TYPE_CALL",
      rawStatus: "pending",
      attachmentCount: 2,
      sourceCreatedAt: originalAt,
    });
    expect(first.items[0]).not.toHaveProperty("sourceContactId");
    expect(first.nextCursor).not.toBeNull();
    const second = await historyA.messages(actor, context.permissions, thread.id, {
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.items[0]).toMatchObject({
      body: "  <script>inert original text</script>\n",
      sourceCreatedAt: null,
    });
    expect(second.nextCursor).toBeNull();
    expect(
      await historyA.list({ ...actor, scope: "OWN" }, context.permissions, {
        limit: 50,
        query: "inert original text",
      }),
    ).toMatchObject({ items: [] });
    await expect(
      historyA.importMessage({ ...input, source: source(`${locationId}-other`, "missing-parent") }),
    ).rejects.toBeInstanceOf(HistoricalImportValidationError);
    expect(await historyA.verifyImports(context, locationId)).toEqual({
      threadCount: 1,
      messageCount: 2,
      mappedThreadCount: 1,
      mappedMessageCount: 2,
      unresolvedThreadCount: 1,
      unresolvedContactThreadCount: 1,
      inconsistentMessageCount: 0,
      invalidParentCount: 0,
      outboxCount: 0,
    });
    const after = await poolA.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM conversations.outbox",
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    const failedMap = await poolA.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM conversations.historical_imports WHERE source_location_id = $1",
      [`${locationId}-other`],
    );
    expect(failedMap.rows[0]?.count).toBe(0);
  });

  it("isolates identical source identities between profiles and rejects cross-database credentials", async () => {
    const locationId = randomUUID();
    const input = {
      ...context,
      source: source(locationId, "same-external-thread"),
      thread: orphan(),
    };
    const [a, b] = await Promise.all([historyA.importThread(input), historyB.importThread(input)]);
    expect(a.id).not.toBe(b.id);
    expect(
      await createHistoricalConversationPostgresRepository(poolA).find(actor, b.id),
    ).toBeNull();
    expect(
      await createHistoricalConversationPostgresRepository(poolB).find(actor, a.id),
    ).toBeNull();
    const url = new URL(configA.connectionUrl.expose());
    url.pathname = `/qcrm_t_${tenantB.replaceAll("-", "")}`;
    const forbidden = new Pool({
      connectionString: url.toString(),
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    try {
      await expect(forbidden.query("SELECT 1")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await forbidden.end();
    }
  });

  it("persists operation checkpoints, rejects concurrent work and resumes without changing identity", async () => {
    const identity = {
      operationId: randomUUID(),
      tenantId: tenantA,
      locationId: randomUUID(),
      exportId: randomUUID(),
      artifactSha256: "a".repeat(64),
      currency: "GTQ",
      operatorMemberId: actor.memberId,
    };
    const progress = {
      resource: "messages",
      processed: 2,
      created: 2,
      replayed: 0,
      conflicts: 0,
      total: 2,
    };
    const operation = createGhlImportOperationRepository(poolA);
    const concurrent = createGhlImportOperationRepository(poolA);
    try {
      await operation.begin(identity);
      await operation.checkpoint(progress);
      expect(await operation.inspect(identity)).toMatchObject({
        status: "RUNNING",
        progress: [progress],
      });
      await expect(concurrent.begin(identity)).rejects.toThrow(
        "Import target or operation validation failed",
      );
      await operation.finish("FAILED");
    } finally {
      await operation.close();
      await concurrent.close();
    }
    const resumed = createGhlImportOperationRepository(poolA);
    try {
      await resumed.begin(identity);
      expect(await resumed.inspect(identity)).toMatchObject({
        status: "RUNNING",
        progress: [progress],
      });
      await expect(
        resumed.inspect({ ...identity, artifactSha256: "b".repeat(64) }),
      ).rejects.toThrow("Import operation identity conflict");
      await resumed.finish("COMPLETE");
      expect(await resumed.inspect(identity)).toMatchObject({
        status: "COMPLETE",
        progress: [progress],
      });
    } finally {
      await resumed.close();
    }
  });

  it("permits attachments only after the matching core import completes and serializes the location", async () => {
    const identity = {
      operationId: randomUUID(),
      tenantId: tenantA,
      locationId: randomUUID(),
      exportId: randomUUID(),
      artifactSha256: "e".repeat(64),
      currency: "GTQ",
      operatorMemberId: actor.memberId,
    };
    const operation = createGhlImportOperationRepository(poolA);
    await expect(acquireGhlAttachmentImportGuard(poolA, identity)).rejects.toThrow(
      "Attachment target is not approved or is busy",
    );
    try {
      await operation.begin(identity);
      await expect(acquireGhlAttachmentImportGuard(poolA, identity)).rejects.toThrow(
        "Attachment target is not approved or is busy",
      );
      await operation.finish("COMPLETE");
    } finally {
      await operation.close();
    }
    for (const changed of [
      { ...identity, artifactSha256: "f".repeat(64) },
      { ...identity, tenantId: tenantB },
      { ...identity, exportId: randomUUID() },
      { ...identity, operatorMemberId: randomUUID() },
    ]) {
      await expect(acquireGhlAttachmentImportGuard(poolA, changed)).rejects.toThrow(
        "Attachment target is not approved or is busy",
      );
    }
    await expect(acquireGhlAttachmentImportGuard(poolB, identity)).rejects.toThrow(
      "Attachment target is not approved or is busy",
    );
    const guard = await acquireGhlAttachmentImportGuard(poolA, identity);
    try {
      await guard.check();
      await expect(acquireGhlAttachmentImportGuard(poolA, identity)).rejects.toThrow(
        "Attachment target is not approved or is busy",
      );
    } finally {
      guard.close();
    }
    const resumed = await acquireGhlAttachmentImportGuard(poolA, identity);
    try {
      await resumed.check();
    } finally {
      resumed.close();
    }
  });
});
