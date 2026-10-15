import { createHash, randomUUID } from "node:crypto";
import { parseDatabaseConfig } from "@quantum-crm/config";
import type { UnifiedInboxListQuery } from "@quantum-crm/contracts";
import {
  acquireGhlAttachmentImportGuard,
  createContactsHistoricalImportPort,
  createCrmPostgresDatabase,
  createGhlImportOperationRepository,
  createIamExternalParticipantDirectory,
  createHistoricalConversationPostgresRepository,
  createSalesHistoricalImportPort,
  createSettingsHistoricalImportPort,
  createUnifiedInboxPostgresRepository,
} from "@quantum-crm/database";
import {
  HistoricalConversationService,
  CustomFieldDefinitionService,
  ContactService,
  ContactNotFoundError,
  SalesService,
  ExternalParticipantConflictError,
  HistoricalConversationNotFoundError,
  HistoricalAttachmentConflictError,
  FileService,
  FileNotFoundError,
  FileStateConflictError,
  HistoricalImportValidationError,
  IamAuthorizationError,
  UnifiedInboxService,
  type CommercialActor,
  type HistoricalImportContext,
  type HistoricalImportSource,
  type HistoricalJsonValue,
  type HistoricalMessageInput,
  type HistoricalThreadInput,
} from "@quantum-crm/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
  it("pages one mixed inbox without timestamp-tie loss and applies filters, permissions and profile scope to both sources", async () => {
    const locationId = randomUUID();
    const marker = `inbox-${locationId}`;
    const privateSource = `private-source-${locationId}`;
    const bodyNeedle = `body-${locationId}-%_`;
    const teammate = randomUUID();
    const outsider = randomUUID();
    const teamId = randomUUID();
    for (const memberId of [teammate, outsider]) {
      await poolA.query(
        `INSERT INTO iam.members(id, oidc_subject, display_name, email, status, commercial_scope)
         VALUES ($1::uuid, $2, 'Synthetic inbox member', $3, 'active', 'assigned')`,
        [memberId, `inbox-${memberId}`, `inbox-${memberId}@example.test`],
      );
    }
    await poolA.query("INSERT INTO iam.teams(id, name) VALUES ($1::uuid, $2)", [teamId, marker]);
    await poolA.query(
      "INSERT INTO iam.team_members(team_id, member_id) VALUES ($1::uuid, $2::uuid), ($1::uuid, $3::uuid)",
      [teamId, actor.memberId, teammate],
    );
    const contact = await contactsA.importContact({
      ...context,
      source: source(locationId, "inbox-contact"),
      displayName: "Synthetic unified inbox contact",
      email: null,
      phone: null,
      ownerMemberId: actor.memberId,
      labelIds: [],
      customFields: [],
      createdAt: originalAt,
      updatedAt: originalAt,
    });
    const records: {
      id: string;
      source: "QUANTUM" | "GHL";
      label: string;
      at: string;
    }[] = [];
    const pairs = [
      {
        label: "own-one",
        owner: actor.memberId,
        at: "2035-01-01T00:00:00.123457Z",
        channel: "email",
        status: "open",
      },
      {
        label: "own-two",
        owner: actor.memberId,
        at: "2035-01-01T00:00:00.123457Z",
        channel: "email",
        status: "open",
      },
      {
        label: "team",
        owner: teammate,
        at: "2035-01-01T00:00:00.123456Z",
        channel: "whatsapp",
        status: "pending",
      },
      {
        label: "outside",
        owner: outsider,
        at: "2035-01-01T00:00:01.000000Z",
        channel: "sms",
        status: "closed",
      },
      {
        label: "unassigned",
        owner: null,
        at: "2034-12-31T00:00:00.000000Z",
        channel: "email",
        status: "open",
      },
    ] as const;
    for (const fixture of pairs) {
      const id = randomUUID();
      const body = fixture.label === "own-one" ? bodyNeedle : `body-${locationId}-XY`;
      await poolA.query(
        `INSERT INTO conversations.conversations
         (id, contact_id, channel, assignee_member_id, status, attention_mode, subject,
          last_message_at, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, 'human', $6,
          $7::timestamptz, $7::timestamptz, $7::timestamptz)`,
        [
          id,
          contact.id,
          fixture.channel,
          fixture.owner,
          fixture.status,
          `${marker} ${fixture.label}`,
          fixture.at,
        ],
      );
      await poolA.query(
        `INSERT INTO conversations.messages
         (id, conversation_id, sequence, direction, kind, body, delivery_status, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, 1, 'inbound', 'text', $3, 'received', $4::timestamptz, $4::timestamptz)`,
        [randomUUID(), id, body, fixture.at],
      );
      records.push({ id, source: "QUANTUM", label: fixture.label, at: fixture.at });
      const imported = await historyA.importThread({
        ...context,
        source: source(locationId, fixture.label, { privateAttribute: privateSource }),
        thread: {
          ...orphan(),
          sourceThreadPresent: true,
          contactId: contact.id,
          sourceContactId: privateSource,
          assigneeMemberId: fixture.owner,
          rawChannel:
            fixture.channel === "whatsapp"
              ? "TYPE_WHATS_APP"
              : `TYPE_${fixture.channel.toUpperCase()}`,
          rawStatus: fixture.label === "unassigned" ? "unread" : fixture.status.toUpperCase(),
          subject: `${marker} ${fixture.label}`,
          sourceCreatedAt: new Date(fixture.at),
        },
      });
      await historyA.importMessage({
        ...context,
        source: source(locationId, `${fixture.label}-message`),
        threadSourceExternalId: fixture.label,
        message: { ...message(), body, attachmentCount: 0, sourceCreatedAt: new Date(fixture.at) },
      });
      // PostgreSQL timestamps retain microseconds that JavaScript Date cannot represent.
      await poolA.query(
        "UPDATE conversations.historical_threads SET last_message_at = $2::timestamptz WHERE id = $1::uuid",
        [imported.id, fixture.at],
      );
      records.push({ id: imported.id, source: "GHL", label: fixture.label, at: fixture.at });
    }
    for (const fixture of [
      { label: "orphan", contactId: null, at: "2035-01-01T00:00:03.000000Z" },
      { label: "missing-thread", contactId: contact.id, at: "2035-01-01T00:00:02.000000Z" },
    ]) {
      const imported = await historyA.importThread({
        ...context,
        source: source(locationId, fixture.label, { privateAttribute: privateSource }),
        thread: {
          ...orphan(),
          contactId: fixture.contactId,
          assigneeMemberId: actor.memberId,
          subject: `${marker} ${fixture.label}`,
          sourceUpdatedAt: new Date(fixture.at),
        },
      });
      records.push({ id: imported.id, source: "GHL", label: fixture.label, at: fixture.at });
    }
    const inbox = new UnifiedInboxService(createUnifiedInboxPostgresRepository(poolA));
    const inboxB = new UnifiedInboxService(createUnifiedInboxPostgresRepository(poolB));
    const query = { limit: 50, contactState: "ALL", query: marker } as const;
    const key = (item: { source: string; id: string }) => `${item.source}:${item.id}`;
    const ordered = [...records].sort(
      (left, right) =>
        right.at.localeCompare(left.at) ||
        Number(right.source === "QUANTUM") - Number(left.source === "QUANTUM") ||
        right.id.localeCompare(left.id),
    );
    const expected = (predicate: (item: (typeof records)[number]) => boolean) =>
      ordered.filter(predicate).map(key);
    const list = async (
      filters: Partial<UnifiedInboxListQuery> = {},
      viewer: CommercialActor = actor,
    ) =>
      (await inbox.list(viewer, context.permissions, { ...query, ...filters })).items.map((item) =>
        key({ source: item.source, id: item.conversation.id }),
      );

    // Every equal timestamp and source tie crosses a page boundary at limit 1.
    let cursor: string | undefined;
    const paged: string[] = [];
    for (let index = 0; index < records.length; index += 1) {
      const page = await inbox.list(actor, context.permissions, {
        ...query,
        limit: 1,
        ...(cursor ? { cursor } : {}),
      });
      expect(page.items).toHaveLength(1);
      paged.push(
        ...page.items.map((item) => key({ source: item.source, id: item.conversation.id })),
      );
      expect(page.nextCursor === null).toBe(index === records.length - 1);
      cursor = page.nextCursor ?? undefined;
    }
    expect(paged).toEqual(ordered.map(key));
    expect(new Set(paged).size).toBe(records.length);
    expect(await list()).toEqual(paged);
    expect(await list({ query: bodyNeedle })).toEqual(expected((item) => item.label === "own-one"));
    expect(await list({ channel: "WHATSAPP", status: "PENDING" })).toEqual(
      expected((item) => item.label === "team"),
    );
    expect(await list({ channel: "EMAIL", status: "OPEN" })).toEqual(
      expected(
        (item) =>
          item.label.startsWith("own-") ||
          (item.label === "unassigned" && item.source === "QUANTUM"),
      ),
    );
    expect(await list({ unassigned: true })).toEqual(
      expected((item) => item.label === "unassigned"),
    );
    expect(await list({ contactId: contact.id })).toEqual(
      expected((item) => item.label !== "orphan"),
    );
    expect(await list({ contactState: "LINKED" })).toEqual(
      expected((item) => item.label !== "orphan"),
    );
    expect(await list({ contactState: "UNLINKED" })).toEqual(
      expected((item) => item.label === "orphan"),
    );
    expect(await list({ attentionMode: "HUMAN" })).toEqual(
      expected((item) => item.source === "QUANTUM"),
    );
    for (const scope of ["OWN", "ASSIGNED"] as const) {
      expect(await list({}, { ...actor, scope })).toEqual(
        expected((item) => item.label.startsWith("own-")),
      );
    }
    expect(await list({}, { ...actor, scope: "TEAM" })).toEqual(
      expected((item) => item.label.startsWith("own-") || item.label === "team"),
    );
    expect(await list({}, { memberId: randomUUID(), scope: "OWN" })).toEqual([]);
    expect(await list({ contactState: "UNLINKED" }, { ...actor, scope: "TEAM" })).toEqual([]);
    await expect(inbox.list(actor, [], query)).rejects.toBeInstanceOf(IamAuthorizationError);
    expect(await inboxB.list(actor, context.permissions, query)).toEqual({
      items: [],
      nextCursor: null,
    });
    const visible = await inbox.list(actor, context.permissions, query);
    for (const item of visible.items) {
      expect(item.conversation).not.toHaveProperty("source_payload");
      expect(item.conversation).not.toHaveProperty("sourceParticipantReferences");
      expect(item.conversation).not.toHaveProperty("sourceContactId");
      expect(item.conversation).not.toHaveProperty("privateAttribute");
    }
    expect(
      JSON.stringify(visible, (_name, value: unknown) =>
        typeof value === "bigint" ? String(value) : value,
      ),
    ).not.toContain(privateSource);
  });

  it("filters every inbox channel and provider alias, preserves inferred display channels and excludes other channels", async () => {
    const locationId = randomUUID();
    const marker = `channels-${locationId}`;
    const contact = await contactsA.importContact({
      ...context,
      source: source(locationId, "channel-contact"),
      displayName: "Synthetic channel filter contact",
      email: null,
      phone: null,
      ownerMemberId: actor.memberId,
      labelIds: [],
      customFields: [],
      createdAt: originalAt,
      updatedAt: originalAt,
    });
    const groups = [
      { channel: "EMAIL", rawChannels: ["EMAIL", " type_email "] },
      { channel: "WHATSAPP", rawChannels: ["WHATSAPP", " type_whats_app "] },
      { channel: "SMS", rawChannels: ["SMS", " type_mms "] },
      { channel: "WEBCHAT", rawChannels: ["WEBCHAT", "WEB_CHAT", "LIVECHAT", " type_live_chat "] },
      { channel: "INSTAGRAM", rawChannels: ["INSTAGRAM", " type_instagram "] },
      {
        channel: "FACEBOOK",
        rawChannels: ["FB", "FACEBOOK", "MESSENGER", " type_facebook_messenger "],
      },
      { channel: "TIKTOK", rawChannels: ["TIKTOK", " type_tiktok "] },
      { channel: "GOOGLE", rawChannels: ["GMB", " type_google_business "] },
      { channel: "CALL", rawChannels: ["CALL", " type_phone_call "] },
      { channel: "FORM", rawChannels: ["FORM_SUBMISSION", " type_form_submission "] },
      { channel: "UNKNOWN", rawChannels: [null, "", "   ", "TYPE_PHONE", "CUSTOM_CHANNEL"] },
    ] as const;
    const expected = new Map<string, { channel: string; rawChannel?: string | null }>();
    for (const group of groups) {
      for (const rawChannel of group.rawChannels) {
        const imported = await historyA.importThread({
          ...context,
          source: source(locationId, `channel-${expected.size}`),
          thread: {
            ...orphan(),
            sourceThreadPresent: true,
            contactId: contact.id,
            assigneeMemberId: actor.memberId,
            rawChannel,
            subject: marker,
          },
        });
        expected.set(imported.id, { channel: group.channel, rawChannel: rawChannel || null });
      }
    }
    // The displayed channel comes from the latest message only when the thread has none.
    for (const fixture of [
      { rawChannel: null, channel: "INSTAGRAM" },
      { rawChannel: "TYPE_EMAIL", channel: "EMAIL" },
      { rawChannel: "CUSTOM_THREAD", channel: "UNKNOWN" },
    ]) {
      const externalId = `inferred-${fixture.channel}`;
      const imported = await historyA.importThread({
        ...context,
        source: source(locationId, externalId),
        thread: { ...orphan(), rawChannel: fixture.rawChannel, subject: marker },
      });
      await historyA.importMessage({
        ...context,
        source: source(locationId, `${externalId}-message`),
        threadSourceExternalId: externalId,
        message: {
          ...message(),
          rawChannel: null,
          rawType: "TYPE_INSTAGRAM",
          attachmentCount: 0,
        },
      });
      expected.set(imported.id, {
        channel: fixture.channel,
        rawChannel: fixture.rawChannel ?? "TYPE_INSTAGRAM",
      });
    }
    for (const channel of ["EMAIL", "WHATSAPP", "WEBCHAT", "SMS"]) {
      const id = randomUUID();
      await poolA.query(
        `INSERT INTO conversations.conversations
         (id, contact_id, channel, assignee_member_id, subject, status, attention_mode,
          created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, 'open', 'human', $6, $6)`,
        [id, contact.id, channel.toLowerCase(), actor.memberId, marker, originalAt],
      );
      expected.set(id, { channel });
    }
    const inbox = new UnifiedInboxService(createUnifiedInboxPostgresRepository(poolA));
    const baseQuery = { limit: 50, contactState: "ALL", query: marker } as const;
    const all = await inbox.list(actor, context.permissions, baseQuery);
    expect(new Set(all.items.map((item) => item.conversation.id))).toEqual(
      new Set(expected.keys()),
    );
    for (const { channel } of groups) {
      const page = await inbox.list(actor, context.permissions, { ...baseQuery, channel });
      expect(page.nextCursor).toBeNull();
      expect(new Set(page.items.map((item) => item.conversation.id))).toEqual(
        new Set([...expected].filter(([, item]) => item.channel === channel).map(([id]) => id)),
      );
      for (const item of page.items) {
        if (item.source === "GHL")
          expect(item.conversation.rawChannel).toBe(expected.get(item.conversation.id)?.rawChannel);
        else expect(item.conversation.channel).toBe(channel);
      }
    }
    const filter = { ...baseQuery, channel: "INSTAGRAM" } as const;
    expect(
      (await inbox.list(actor, context.permissions, { ...filter, attentionMode: "HUMAN" })).items,
    ).toEqual([]);
    expect(
      (await inbox.list({ memberId: randomUUID(), scope: "OWN" }, context.permissions, filter))
        .items,
    ).toEqual([]);
    await expect(inbox.list(actor, [], filter)).rejects.toBeInstanceOf(IamAuthorizationError);
    const inboxB = new UnifiedInboxService(createUnifiedInboxPostgresRepository(poolB));
    expect((await inboxB.list(actor, context.permissions, filter)).items).toEqual([]);
  });

  it("resolves original participants without accounts or effects, isolates sources and replays atomically", async () => {
    const locationId = randomUUID();
    const directoryA = createIamExternalParticipantDirectory(poolA);
    const directoryB = createIamExternalParticipantDirectory(poolB);
    const authorized: HistoricalImportContext = {
      ...context,
      permissions: [...context.permissions, "iam:members:update"],
    };
    const input = {
      operationId: randomUUID(),
      locationId,
      participants: [
        { externalId: "source-advisor", displayName: "Original advisor" },
        { externalId: "source-follower", displayName: "Original follower" },
      ],
    };
    const before = await poolA.query<{ members: number; outbox: number }>(
      "SELECT (SELECT count(*)::int FROM iam.members) AS members, (SELECT count(*)::int FROM conversations.outbox) AS outbox",
    );
    await expect(directoryA.importDirectory(context, input)).rejects.toBeInstanceOf(
      IamAuthorizationError,
    );
    const results = await Promise.all([
      directoryA.importDirectory(authorized, input),
      directoryA.importDirectory(authorized, input),
    ]);
    expect(results.map((item) => item.created).sort()).toEqual([0, 2]);
    await expect(
      directoryA.importDirectory(authorized, {
        ...input,
        participants: [{ externalId: "source-advisor", displayName: "Changed source name" }],
      }),
    ).rejects.toBeInstanceOf(ExternalParticipantConflictError);
    const references = [
      { locationId, ownerExternalId: "source-advisor", followerExternalIds: ["source-follower"] },
    ];
    expect(await directoryA.resolve(references)).toHaveLength(2);
    expect(await directoryB.resolve(references)).toEqual([]);
    expect(await directoryA.resolve([{ ...references[0]!, locationId: randomUUID() }])).toEqual([]);
    const raw = {
      assignedTo: "source-advisor",
      followers: ["source-follower"],
      privateAttribute: "must not escape",
    };
    const contact = await contactsA.importContact({
      ...context,
      source: source(locationId, "participant-contact", raw),
      displayName: "Synthetic participant contact",
      email: null,
      phone: null,
      ownerMemberId: actor.memberId,
      labelIds: [],
      customFields: [],
      createdAt: originalAt,
      updatedAt: originalAt,
    });
    const pipeline = await salesA.importPipeline({
      ...context,
      source: source(locationId, "participant-pipeline"),
      name: `Participants ${locationId}`,
      description: "Synthetic participant pipeline",
      createdAt: originalAt,
      stages: [
        { externalId: "participant-stage", name: "First", description: "", position: 0 },
        { externalId: "participant-next", name: "Next", description: "", position: 1 },
      ],
    });
    const opportunity = await salesA.importOpportunity({
      ...context,
      source: source(locationId, "participant-opportunity", raw),
      contactId: contact.id,
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0]!.id,
      ownerMemberId: actor.memberId,
      title: "Synthetic participant opportunity",
      amountMinor: 0n,
      currency: "GTQ",
      status: "OPEN",
      closeReason: null,
      closedAt: null,
      createdAt: originalAt,
      updatedAt: originalAt,
    });
    const thread = await historyA.importThread({
      ...context,
      source: source(locationId, "participant-thread", raw),
      thread: {
        ...orphan(),
        sourceThreadPresent: true,
        contactId: contact.id,
        assigneeMemberId: actor.memberId,
      },
    });
    const resolve = vi.fn(directoryA.resolve);
    const contacts = new ContactService(databaseA.commercial.contacts, undefined, { resolve });
    const sales = new SalesService(
      databaseA.commercial.sales,
      { existsFor: async () => true },
      membersA,
      undefined,
      { resolve },
    );
    const conversations = new HistoricalConversationService(
      createHistoricalConversationPostgresRepository(poolA),
      {
        contactExistsFor: async () => true,
        isActiveMember: membersA.isActive,
      },
      undefined,
      { resolve },
    );
    const expected = {
      source: "GHL",
      owner: { externalId: "source-advisor", displayName: "Original advisor" },
      followers: [{ externalId: "source-follower", displayName: "Original follower" }],
    };
    const contactResult = await contacts.get(actor, ["crm:contacts:read"], contact.id);
    const opportunityResult = await sales.getOpportunity({
      actor,
      permissions: ["crm:sales:read"],
      opportunityId: opportunity.id,
    });
    const threadResult = await conversations.find(actor, context.permissions, thread.id);
    expect(contactResult).toMatchObject({
      ownerMemberId: actor.memberId,
      sourceParticipants: expected,
    });
    expect(opportunityResult).toMatchObject({
      ownerMemberId: actor.memberId,
      sourceParticipants: expected,
    });
    expect(threadResult).toMatchObject({
      assigneeMemberId: actor.memberId,
      sourceParticipants: expected,
    });
    for (const result of [contactResult, opportunityResult, threadResult]) {
      expect(result).not.toHaveProperty("sourceParticipantReferences");
      expect(result).not.toHaveProperty("source_payload");
      expect(result).not.toHaveProperty("privateAttribute");
    }
    resolve.mockClear();
    expect(() => contacts.get(actor, [], contact.id)).toThrow(IamAuthorizationError);
    const stranger = { memberId: randomUUID(), scope: "ASSIGNED" as const };
    await expect(contacts.get(stranger, ["crm:contacts:read"], contact.id)).rejects.toBeInstanceOf(
      ContactNotFoundError,
    );
    await expect(
      conversations.find(stranger, context.permissions, thread.id),
    ).rejects.toBeInstanceOf(HistoricalConversationNotFoundError);
    expect(resolve).not.toHaveBeenCalled();
    const after = await poolA.query<{ members: number; outbox: number }>(
      "SELECT (SELECT count(*)::int FROM iam.members) AS members, (SELECT count(*)::int FROM conversations.outbox) AS outbox",
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    const receipts = await poolA.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM iam.external_participant_imports WHERE operation_id = $1::uuid",
      [input.operationId],
    );
    expect(receipts.rows[0]?.count).toBe(1);
    await expect(
      poolA.query(
        "UPDATE iam.external_participants SET display_name = 'Forbidden' WHERE source_location_id = $1",
        [locationId],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      await contacts.update({
        actor,
        permissions: ["crm:contacts:update"],
        id: contact.id,
        expectedVersion: contactResult.version,
        displayName: "Edited in Quantum",
      }),
    ).toMatchObject({ sourceParticipants: expected, ownerMemberId: actor.memberId });
    const updateInput = {
      actor,
      permissions: ["crm:sales:update"] as const,
      opportunityId: opportunity.id,
      expectedVersion: opportunityResult.version,
      title: "Edited in Quantum",
      idempotencyKey: randomUUID(),
      payloadHash: "a".repeat(64),
    };
    const updatedOpportunity = await sales.updateOpportunity(updateInput);
    expect(updatedOpportunity).toMatchObject({
      sourceParticipants: expected,
      ownerMemberId: actor.memberId,
    });
    expect(await sales.updateOpportunity(updateInput)).toMatchObject({
      sourceParticipants: expected,
    });
    const moveInput = {
      actor,
      permissions: ["crm:sales:move"] as const,
      opportunityId: opportunity.id,
      stageId: pipeline.stages[1]!.id,
      expectedVersion: updatedOpportunity.version,
      idempotencyKey: randomUUID(),
      payloadHash: "b".repeat(64),
    };
    expect(await sales.moveOpportunity(moveInput)).toMatchObject({ sourceParticipants: expected });
    expect(await sales.moveOpportunity(moveInput)).toMatchObject({ sourceParticipants: expected });
    const emptyFollowers = await contactsA.importContact({
      ...context,
      source: source(locationId, "null-followers", { assignedTo: null, followers: null }),
      displayName: "Synthetic nullable followers",
      email: null,
      phone: null,
      ownerMemberId: null,
      labelIds: [],
      customFields: [],
      createdAt: originalAt,
      updatedAt: originalAt,
    });
    expect(await contacts.get(actor, ["crm:contacts:read"], emptyFollowers.id)).toMatchObject({
      sourceParticipants: { source: "GHL", owner: null, followers: [] },
    });
  });

  it("reserves attachments once, audits retries, binds immutable files and authorizes through the scoped historical thread", async () => {
    const locationId = randomUUID();
    const viewer: CommercialActor = { memberId: randomUUID(), scope: "ASSIGNED" };
    const stranger: CommercialActor = { memberId: randomUUID(), scope: "ASSIGNED" };
    await poolA.query(
      `INSERT INTO iam.members(id, oidc_subject, display_name, email, status, commercial_scope)
      VALUES ($1::uuid, $2, 'Synthetic attachment viewer', $3, 'active', 'assigned')`,
      [viewer.memberId, `ghl-fixture-${viewer.memberId}`, `ghl-${viewer.memberId}@example.test`],
    );
    const contact = await contactsA.importContact({
      ...context,
      permissions: [...context.permissions, "crm:contacts:assign"],
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
    // Catalog metadata is visible before any contact has a value, only in its configured profile.
    const catalogA = new CustomFieldDefinitionService(databaseA.commercial.customFieldDefinitions);
    const catalogB = new CustomFieldDefinitionService(databaseB.commercial.customFieldDefinitions);
    expect(
      (await catalogA.list(["crm:contacts:read"], { model: "contact", limit: 100 })).items,
    ).toContainEqual({
      id: custom.id,
      key: longFieldKey,
      label: longFieldName,
      description: "Synthetic field",
      dataType: "TEXT",
      options: [],
      model: "contact",
    });
    expect(
      (await catalogB.list(["crm:contacts:read"], { model: "contact", limit: 100 })).items,
    ).not.toContainEqual(expect.objectContaining({ id: custom.id }));
    expect(
      (await catalogA.list(["crm:sales:read"], { model: "opportunity", limit: 100 })).items,
    ).not.toContainEqual(expect.objectContaining({ id: custom.id }));
    expect(() => catalogA.list(["crm:sales:read"], { model: "contact", limit: 100 })).toThrow(
      IamAuthorizationError,
    );
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
        actor: { ...actor, scope: "ASSIGNED" },
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
      rawChannel: "TYPE_CALL",
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
      await historyA.list({ ...actor, scope: "ASSIGNED" }, context.permissions, {
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
