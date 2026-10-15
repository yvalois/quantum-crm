import type {
  Contact,
  Conversation,
  ConversationMessage,
  HistoricalConversation,
  HistoricalConversationMessage,
  HistoricalConversationAttachment,
  UnifiedInboxItem,
} from "@quantum-crm/contracts";
import { expect, test, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:3107";
const timestamp = "2026-10-11T15:00:00.000Z";
const memberId = "019b0000-0000-7000-8000-000000000001";
const invitedMemberId = "019b0000-0000-7000-8000-000000000111";
const conversationId = "019b0000-0000-7000-8000-000000000002";
const historicalId = "019b0000-0000-7000-8000-000000000003";
const fileId = "019b0000-0000-7000-8000-000000000004";
const imageFileId = "019b0000-0000-7000-8000-000000000021";
const audioFileId = "019b0000-0000-7000-8000-000000000022";
const videoFileId = "019b0000-0000-7000-8000-000000000023";
const rejectedFileId = "019b0000-0000-7000-8000-000000000024";

interface SyntheticMedia {
  readonly image: Buffer;
  readonly audio: Buffer;
  readonly video: Buffer;
}

async function syntheticMedia(page: Page): Promise<SyntheticMedia> {
  await page.goto("about:blank");
  const visual = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Synthetic media canvas unavailable");
    context.fillStyle = "#d4ece3";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/png").split(",")[1];
    if (!image) throw new Error("Synthetic image unavailable");
    const stream = canvas.captureStream(20);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    const chunks: Blob[] = [];
    const video = await new Promise<number[]>((resolve, reject) => {
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onerror = () => reject(new Error("Synthetic recording failed"));
      recorder.onstop = () => {
        void new Blob(chunks, { type: "video/webm" }).arrayBuffer().then((bytes) => {
          for (const track of stream.getTracks()) track.stop();
          resolve(Array.from(new Uint8Array(bytes)));
        }, reject);
      };
      recorder.start();
      const started = performance.now();
      function frame(now: number): void {
        if (!context) return;
        context.fillStyle = "#d4ece3";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#146f61";
        context.fillRect(((now - started) / 5) % 120, 25, 30, 40);
        if (now - started >= 800) recorder.stop();
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    return { image, video };
  });
  const samples = 8_000;
  const audio = Buffer.alloc(44 + samples * 2);
  audio.write("RIFF", 0);
  audio.writeUInt32LE(36 + samples * 2, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8_000, 24);
  audio.writeUInt32LE(16_000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++)
    audio.writeInt16LE(
      Math.round(Math.sin((index * 440 * Math.PI * 2) / 8_000) * 1_000),
      44 + index * 2,
    );
  return { image: Buffer.from(visual.image, "base64"), audio, video: Buffer.from(visual.video) };
}

function mediaAttachments(media: SyntheticMedia): HistoricalConversationAttachment[] {
  return [
    ...historicalMessage.attachments,
    ...[
      {
        fileId: imageFileId,
        name: "synthetic-image.png",
        mimeType: "image/png",
        size: media.image.length,
      },
      {
        fileId: audioFileId,
        name: "synthetic-audio.wav",
        mimeType: "audio/wav",
        size: media.audio.length,
      },
      {
        fileId: videoFileId,
        name: "synthetic-video.webm",
        mimeType: "video/webm",
        size: media.video.length,
      },
    ].map((file, index): HistoricalConversationAttachment => ({
      id: file.fileId,
      attachmentIndex: index + 1,
      status: "AVAILABLE",
      errorCode: null,
      ...file,
    })),
    {
      id: rejectedFileId,
      attachmentIndex: 4,
      fileId: rejectedFileId,
      status: "REJECTED",
      errorCode: "SCAN_REJECTED",
      name: "synthetic-rejected.png",
      mimeType: "image/png",
      size: 20,
    },
  ];
}

function contact(index: number, displayName: string): Contact {
  return {
    id: `019b0000-0000-7000-8000-${String(index + 10).padStart(12, "0")}`,
    displayName,
    ownerMemberId: memberId,
    email: `contact-${index}@example.test`,
    phone: "+573000000001",
    labels: [{ id: "019b0000-0000-7000-8000-000000000099", name: "Cliente frecuente" }],
    customFields: [
      {
        fieldId: "019b0000-0000-7000-8000-000000000098",
        key: "vehicle",
        label: "Vehículo preferido",
        dataType: "TEXT",
        value: "Sedán sintético",
      },
      {
        fieldId: "019b0000-0000-7000-8000-000000000096",
        key: "sales_advisor",
        label: "Asesor de Ventas",
        dataType: "SINGLE_OPTIONS",
        value: "Si",
      },
    ],
    source: "MIGRATION",
    sourceParticipants: {
      source: "GHL",
      owner: {
        externalId: "synthetic-ghl-contact-owner",
        displayName: "Lucía Propietaria Sintética",
      },
      followers: [
        { externalId: "synthetic-ghl-contact-follower", displayName: "Mateo Seguidor Sintético" },
      ],
    },
    archivedAt: null,
    version: "1",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const contacts = [
  contact(1, "Andrea Sintética"),
  contact(2, "Bruno Sintético"),
  { ...contact(3, "Última Sintética"), ownerMemberId: invitedMemberId },
] as const;
const primaryContact = contacts[0];
const conversation: Conversation = {
  id: conversationId,
  contactId: primaryContact.id,
  channel: "EMAIL",
  externalThreadId: null,
  assigneeMemberId: memberId,
  status: "OPEN",
  attentionMode: "HUMAN",
  subject: "Consulta sintética de demostración",
  lastMessagePreview: "Mensaje sintético recibido",
  lastMessageAt: timestamp,
  unreadCount: 1,
  version: "1",
  createdAt: timestamp,
  updatedAt: timestamp,
};
const message: ConversationMessage = {
  id: "019b0000-0000-7000-8000-000000000005",
  conversationId,
  sequence: "1",
  direction: "INBOUND",
  kind: "TEXT",
  authorMemberId: null,
  body: "Mensaje sintético recibido",
  externalMessageId: null,
  deliveryStatus: "RECEIVED",
  failureCode: null,
  documentId: null,
  documentSnapshot: null,
  fileId: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const historical: HistoricalConversation = {
  id: historicalId,
  source: "GHL",
  sourceExternalId: "synthetic-thread",
  sourceThreadPresent: true,
  contactId: primaryContact.id,
  assigneeMemberId: invitedMemberId,
  rawChannel: "Email",
  rawStatus: "closed",
  subject: "Historial sintético conservado",
  sourceCreatedAt: timestamp,
  sourceUpdatedAt: timestamp,
  messageCount: 1,
  lastMessageAt: timestamp,
  importedAt: timestamp,
  sourceParticipants: {
    source: "GHL",
    owner: {
      externalId: "synthetic-ghl-thread-owner",
      displayName: "Valentina Responsable Sintética",
    },
    followers: [
      { externalId: "synthetic-ghl-thread-follower", displayName: "Nicolás Seguidor Sintético" },
    ],
  },
};
const historicalMessage: HistoricalConversationMessage = {
  id: "019b0000-0000-7000-8000-000000000006",
  threadId: historicalId,
  sourceExternalId: "synthetic-message",
  rawChannel: "Email",
  rawType: "TYPE_EMAIL",
  rawDirection: "inbound",
  rawStatus: "delivered",
  body: "Texto original sintético\nSegunda línea conservada.",
  attachmentCount: 1,
  attachments: [
    {
      id: "019b0000-0000-7000-8000-000000000007",
      attachmentIndex: 0,
      fileId,
      status: "AVAILABLE",
      errorCode: null,
      name: "synthetic.txt",
      mimeType: "text/plain",
      size: 20,
    },
  ],
  sourceCreatedAt: timestamp,
  sourceUpdatedAt: timestamp,
  importedAt: timestamp,
};

const channelSamples = [
  { channel: "FACEBOOK", key: "facebook", label: "Messenger", rawChannel: "TYPE_FACEBOOK" },
  { channel: "INSTAGRAM", key: "instagram", label: "Instagram", rawChannel: "TYPE_INSTAGRAM" },
  { channel: "TIKTOK", key: "tiktok", label: "TikTok", rawChannel: "TYPE_TIKTOK" },
  { channel: "GOOGLE", key: "google", label: "Google Business", rawChannel: "TYPE_GMB" },
  { channel: "CALL", key: "call", label: "Llamada", rawChannel: "TYPE_CALL" },
  { channel: "SMS", key: "sms", label: "SMS", rawChannel: "TYPE_SMS" },
  { channel: "EMAIL", key: "email", label: "Correo", rawChannel: "TYPE_EMAIL" },
  { channel: "WHATSAPP", key: "whatsapp", label: "WhatsApp", rawChannel: "TYPE_WHATSAPP" },
  { channel: "WEBCHAT", key: "chat", label: "Chat web", rawChannel: "TYPE_LIVE_CHAT" },
  {
    channel: "UNKNOWN",
    key: "unknown",
    label: "Canal no identificado",
    rawChannel: "TYPE_FUTURE_CHANNEL",
  },
] as const;

async function workspaceFixture(
  page: Page,
  media?: SyntheticMedia,
  options: {
    readonly channel?: string;
    readonly channelFiltering?: boolean;
    readonly message?: Partial<HistoricalConversationMessage>;
    readonly activeMessages?: () => readonly ConversationMessage[];
    readonly expireImageOnce?: boolean;
  } = {},
) {
  const queries: URLSearchParams[] = [];
  const inboxQueries: URLSearchParams[] = [];
  const writes: string[] = [];
  const unexpected: string[] = [];
  const authorizations = new Map<string, number>();
  const mediaRequests: string[] = [];
  const channelThreads = channelSamples.map((sample, index) => ({
    ...sample,
    conversation: {
      ...historical,
      id: `019b0000-0000-7000-8000-${String(index + 1_000).padStart(12, "0")}`,
      sourceExternalId: `synthetic-${sample.key}-thread`,
      rawChannel: sample.rawChannel,
      rawStatus: "open",
      subject: `Consulta sintética de ${sample.label}`,
    },
  }));
  const visibleThread = {
    ...historical,
    rawChannel: options.channel ?? (media ? "TYPE_WHATSAPP" : historical.rawChannel),
  };
  const visibleMessage = {
    ...(media
      ? {
          ...historicalMessage,
          rawChannel: null,
          rawType: "TYPE_WHATSAPP",
          attachmentCount: 5,
          attachments: mediaAttachments(media),
        }
      : historicalMessage),
    ...(options.channel ? { rawChannel: null, rawType: options.channel } : {}),
    ...options.message,
  };
  const orphanThread: HistoricalConversation = {
    ...visibleThread,
    id: "019b0000-0000-7000-8000-000000000009",
    contactId: null,
    sourceExternalId: "orphan-123456",
    subject: "Conversación histórica sin ficha actual en GHL",
    sourceThreadPresent: false,
  };
  await page.context().addCookies([
    {
      name: "qcrm_crm_session",
      value: "synthetic-browser-only",
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  // No browser API request can reach real authentication, storage or CRM data.
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (method !== "GET") writes.push(`${method} ${path}`);
    const respond = async (body: unknown) => route.fulfill({ status: 200, json: body });
    if (url.origin !== origin) {
      unexpected.push(`${method} ${url.origin}${path}`);
      await route.abort("blockedbyclient");
      return;
    }
    const authorizedId = [fileId, ...(media ? [imageFileId, audioFileId, videoFileId] : [])].find(
      (id) => path === `/api/files/${id}/download-authorizations`,
    );
    if (authorizedId && method === "POST") {
      expect(request.headers()["x-csrf-token"]).toBe("synthetic-csrf-token");
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      const attempt = (authorizations.get(authorizedId) ?? 0) + 1;
      authorizations.set(authorizedId, attempt);
      await respond({
        data: {
          method: "GET",
          url:
            authorizedId === fileId
              ? `${origin}/api/synthetic-download`
              : `${origin}/api/synthetic-media/${authorizedId}?attempt=${attempt}`,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          objectVersionId: "synthetic-version",
        },
      });
      return;
    }
    if (method === "GET") {
      if (path === "/api/auth/session") {
        await respond({ authenticated: true, csrfToken: "synthetic-csrf-token" });
        return;
      }
      if (path === "/api/auth/capabilities") {
        await respond({
          data: { canAssignContacts: true, canAssignConversations: true, canConfigureAgent: true },
        });
        return;
      }
      if (path === "/api/conversations/agent-control") {
        await respond({ data: { enabled: true, version: "1", updatedAt: timestamp } });
        return;
      }
      if (path === "/api/custom-field-definitions") {
        expect(url.searchParams.get("model")).toBe("contact");
        expect(url.searchParams.get("limit")).toBe("100");
        await respond({
          data: [
            {
              id: "019b0000-0000-7000-8000-000000000096",
              key: "sales_advisor",
              label: "Asesor de Ventas",
              description: "Selección binaria sintética",
              dataType: "SINGLE_OPTIONS",
              model: "contact",
              options: ["Si", "No"],
            },
            {
              id: "019b0000-0000-7000-8000-000000000098",
              key: "vehicle",
              label: "Vehículo preferido",
              description: "Preferencia sintética",
              dataType: "TEXT",
              model: "contact",
              options: [],
            },
            {
              id: "019b0000-0000-7000-8000-000000000097",
              key: "synthetic-empty",
              label: "Preferencia sin completar",
              description: "Campo sintético vacío",
              dataType: "TEXT",
              model: "contact",
              options: [],
            },
          ],
          page: { nextCursor: null },
        });
        return;
      }
      if (path === "/api/contacts") {
        queries.push(url.searchParams);
        if (url.searchParams.has("ids")) {
          await respond({
            data: contacts.filter((item) =>
              url.searchParams.get("ids")?.split(",").includes(item.id),
            ),
            page: { limit: 100, total: 1, nextCursor: null, previousCursor: null },
          });
          return;
        }
        const searching = Boolean(url.searchParams.get("q"));
        const secondPage = url.searchParams.get("cursor") === "synthetic-next";
        await respond({
          data: searching || secondPage ? [contacts[2]] : contacts.slice(0, 2),
          page: {
            limit: 50,
            total: searching ? 1 : contacts.length,
            nextCursor: searching || secondPage ? null : "synthetic-next",
            previousCursor: secondPage ? "synthetic-first" : null,
          },
        });
        return;
      }
      if (path === "/api/members") {
        await respond({
          data: [
            { id: memberId, displayName: "María Asesora Sintética", status: "ACTIVE" },
            { id: invitedMemberId, displayName: "Julio Asesor Invitado", status: "INVITED" },
          ].map((member) => ({
            ...member,
            email: `${member.id}@example.test`,
            authorizationRevision: "1",
            createdAt: timestamp,
            updatedAt: timestamp,
            deactivatedAt: null,
            commercialScope: "ASSIGNED",
          })),
          page: { nextCursor: null },
        });
        return;
      }
      if (path === "/api/tasks/assignees") {
        await respond({
          data: [
            {
              id: memberId,
              displayName: "María Asesora Sintética",
              status: "ACTIVE",
              email: "advisor@example.test",
            },
          ],
        });
        return;
      }
      if (path === "/api/conversations/inbox") {
        inboxQueries.push(url.searchParams);
        if (options.channelFiltering) {
          const params = url.searchParams;
          const catalog: { channel: string; item: UnifiedInboxItem }[] = [
            { channel: "EMAIL", item: { source: "QUANTUM", conversation } },
            ...channelThreads.map((entry) => ({
              channel: entry.channel,
              item: { source: "GHL" as const, conversation: entry.conversation },
            })),
          ];
          const filtered = catalog.filter(({ channel, item }) => {
            const itemStatus =
              item.source === "QUANTUM"
                ? item.conversation.status
                : item.conversation.rawStatus?.toUpperCase();
            return (
              (!params.has("channel") || params.get("channel") === channel) &&
              (!params.has("query") ||
                item.conversation.subject
                  ?.toLowerCase()
                  .includes(params.get("query")?.toLowerCase() ?? "")) &&
              (!params.has("contactId") ||
                params.get("contactId") === item.conversation.contactId) &&
              params.get("contactState") !== "UNLINKED" &&
              (!params.has("status") || params.get("status") === itemStatus) &&
              (!params.has("attentionMode") ||
                (item.source === "QUANTUM" &&
                  params.get("attentionMode") === item.conversation.attentionMode))
            );
          });
          const offset = Number(params.get("cursor")?.replace("synthetic-channels-", "") ?? 0);
          await respond({
            data: filtered.slice(offset, offset + 5).map((entry) => entry.item),
            page: {
              nextCursor: offset + 5 < filtered.length ? `synthetic-channels-${offset + 5}` : null,
            },
          });
          return;
        }
        const secondPage = url.searchParams.get("cursor") === "synthetic-inbox-next";
        const searching = Boolean(url.searchParams.get("query"));
        await respond({
          data:
            url.searchParams.get("contactState") === "UNLINKED"
              ? [{ source: "GHL", conversation: orphanThread }]
              : secondPage
                ? [
                    {
                      source: "GHL",
                      conversation: {
                        ...visibleThread,
                        id: "019b0000-0000-7000-8000-000000000008",
                        contactId: contacts[2].id,
                        subject: "Página siguiente sintética",
                      },
                    },
                  ]
                : searching
                  ? [{ source: "GHL", conversation: visibleThread }]
                  : [
                      { source: "QUANTUM", conversation },
                      { source: "GHL", conversation: visibleThread },
                    ],
          page: {
            nextCursor:
              secondPage || searching || url.searchParams.get("contactState") === "UNLINKED"
                ? null
                : "synthetic-inbox-next",
          },
        });
        return;
      }
      const channelThread = options.channelFiltering
        ? channelThreads.find(
            (entry) =>
              path === `/api/conversations/historical/${entry.conversation.id}` ||
              path === `/api/conversations/historical/${entry.conversation.id}/messages`,
          )
        : undefined;
      if (channelThread) {
        await respond(
          path.endsWith("/messages")
            ? {
                data: [
                  {
                    ...historicalMessage,
                    threadId: channelThread.conversation.id,
                    rawChannel: null,
                    rawType: channelThread.rawChannel,
                    body: `Mensaje sintético de ${channelThread.label}`,
                    attachmentCount: 0,
                    attachments: [],
                  },
                ],
                page: { nextCursor: null },
              }
            : { data: channelThread.conversation },
        );
        return;
      }
      if (path === "/api/conversations/historical") {
        await respond({
          data:
            url.searchParams.get("contactState") === "UNLINKED" ? [orphanThread] : [visibleThread],
          page: { nextCursor: null },
        });
        return;
      }
      if (path === `/api/conversations/historical/${historicalId}`) {
        await respond({ data: visibleThread });
        return;
      }
      if (path === `/api/conversations/historical/${historicalId}/messages`) {
        await respond({ data: [visibleMessage], page: { nextCursor: null } });
        return;
      }
      if (path === `/api/conversations/historical/${orphanThread.id}`) {
        await respond({ data: orphanThread });
        return;
      }
      if (path === `/api/conversations/historical/${orphanThread.id}/messages`) {
        await respond({
          data: [{ ...visibleMessage, threadId: orphanThread.id }],
          page: { nextCursor: null },
        });
        return;
      }
      if (path === "/api/conversations") {
        await respond({ data: [conversation] });
        return;
      }
      if (path === `/api/conversations/${conversationId}`) {
        await respond({
          data: {
            conversation: options.activeMessages
              ? { ...conversation, unreadCount: 0 }
              : conversation,
            messages: options.activeMessages?.() ?? [message],
            history: [],
          },
        });
        return;
      }
      if (path === "/api/synthetic-download") {
        await route.fulfill({
          status: 200,
          contentType: "text/plain",
          headers: { "content-disposition": 'attachment; filename="synthetic.txt"' },
          body: "synthetic attachment",
        });
        return;
      }
      if (media && path.startsWith("/api/synthetic-media/")) {
        const mediaId = path.slice("/api/synthetic-media/".length);
        mediaRequests.push(mediaId);
        if (
          mediaId === imageFileId &&
          url.searchParams.get("attempt") === "1" &&
          options.expireImageOnce !== false
        ) {
          await route.fulfill({ status: 403, body: "Synthetic expired media authorization" });
          return;
        }
        const file =
          mediaId === imageFileId
            ? { bytes: media.image, type: "image/png", name: "synthetic-image.png" }
            : mediaId === audioFileId
              ? { bytes: media.audio, type: "audio/wav", name: "synthetic-audio.wav" }
              : mediaId === videoFileId
                ? { bytes: media.video, type: "video/webm", name: "synthetic-video.webm" }
                : null;
        if (file) {
          await route.fulfill({
            status: 200,
            contentType: file.type,
            headers: {
              "content-disposition": `attachment; filename="${file.name}"`,
              "cache-control": "no-store",
            },
            body: file.bytes,
          });
          return;
        }
      }
      if (
        [
          "/api/pipeline",
          "/api/contacts/labels",
          "/api/automations",
          "/api/documents",
          "/api/opportunities",
          "/api/tasks",
          "/api/calendar/events",
          "/api/conversations/quick-replies",
        ].includes(path)
      ) {
        await respond({ data: [] });
        return;
      }
    }
    unexpected.push(`${method} ${path}`);
    await route.fulfill({ status: 500, json: { title: "Unexpected synthetic API request" } });
  });
  return { queries, inboxQueries, writes, unexpected, authorizations, mediaRequests };
}

async function expectContainedViewport(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}

test("an open chat receives new media and replaces pending previews without leaving or reloading", async ({
  page,
}) => {
  const media = await syntheticMedia(page);
  await page.clock.install();
  let activeMessages: ConversationMessage[] = [message];
  const fixture = await workspaceFixture(page, media, {
    activeMessages: () => activeMessages,
    expireImageOnce: false,
  });
  await page.goto("/inbox");
  await page.locator(`[data-source="QUANTUM"][data-conversation-id="${conversationId}"]`).click();
  const thread = page.getByRole("region", { name: /Conversaci.n seleccionada/ });
  await expect(thread.getByText(message.body, { exact: true })).toBeVisible();

  const receivedAt = new Date().toISOString();
  const imageMessage: ConversationMessage = {
    ...message,
    id: "019b0000-0000-7000-8000-000000000031",
    sequence: "2",
    kind: "IMAGE",
    body: "Imagen",
    fileId: null,
    createdAt: receivedAt,
    updatedAt: receivedAt,
  };
  activeMessages = [message, imageMessage];
  await page.clock.runFor(4_100);
  await expect(thread.getByText(/Imagen pendiente o no disponible/)).toBeVisible();

  const audioMessage: ConversationMessage = {
    ...imageMessage,
    id: "019b0000-0000-7000-8000-000000000032",
    sequence: "3",
    kind: "AUDIO",
    body: "Audio",
    fileId: null,
  };
  activeMessages = [message, { ...imageMessage, fileId: imageFileId }, audioMessage];
  await page.clock.runFor(2_100);
  await expect(thread.getByRole("button", { name: "Ampliar imagen" })).toBeVisible();
  await expect(thread.getByText(/Audio pendiente o no disponible/)).toBeVisible();

  activeMessages = [
    message,
    { ...imageMessage, fileId: imageFileId },
    { ...audioMessage, fileId: audioFileId },
  ];
  await page.clock.runFor(2_100);
  await expect(thread.getByRole("button", { name: "Reproducir audio" })).toHaveCount(1);
  await expect(thread.getByRole("slider", { name: "Posición del audio" })).toHaveCount(1);
  expect(
    (await thread.getByRole("slider", { name: "Posición del audio" }).boundingBox())?.width,
  ).toBeGreaterThan(120);
  await expect(thread.getByText(/pendiente o no disponible/)).toHaveCount(0);
  expect(fixture.authorizations.get(imageFileId)).toBe(1);
  expect(fixture.authorizations.get(audioFileId)).toBe(1);
  expect(fixture.unexpected.filter((request) => request.includes("/api/files/"))).toEqual([]);
});

test("contacts retain server pagination, search and contact detail on desktop and mobile", async ({
  page,
}, testInfo) => {
  const fixture = await workspaceFixture(page);
  await page.goto("/contacts");
  const table = page.getByRole("table", { name: "Lista de contactos" });
  const contactButton = (name: string) =>
    table.getByRole("button").filter({ has: page.getByText(name, { exact: true }) });
  await expect(contactButton("Andrea Sintética")).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath("contacts-desktop.png") });
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await expect(contactButton("Última Sintética")).toBeVisible();
  expect(fixture.queries.some((query) => query.get("cursor") === "synthetic-next")).toBe(true);
  const search = page.getByRole("textbox", { name: "Buscar contactos" });
  await search.fill("Última");
  await search.press("Enter");
  await expect.poll(() => fixture.queries.at(-1)?.get("q")).toBe("Última");
  expect(fixture.queries.at(-1)?.has("cursor")).toBe(false);
  await expect(page.getByRole("button", { name: "Siguiente", exact: true })).toBeDisabled();
  await contactButton("Última Sintética").click();
  const detail = page.getByRole("complementary", { name: "Ficha de Última Sintética" });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("heading", { name: "Última Sintética" })).toBeVisible();
  await expect(detail.getByText("Julio Asesor Invitado", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar ficha" }).click();
  await expect(detail).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(table).toBeVisible();
  await page.getByText("Filtros", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Aplicar filtros" })).toBeVisible();
  await expectContainedViewport(page);
  await page.getByText("Filtros", { exact: true }).click();
  await contactButton("Última Sintética").click();
  await expect(detail).toBeVisible();
  await expectContainedViewport(page);
  await page.screenshot({ path: testInfo.outputPath("contacts-mobile.png") });
  await page.getByRole("button", { name: "Cerrar ficha" }).click();
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test("active inbox preserves thread, draft composer and contact context at both widths", async ({
  page,
}, testInfo) => {
  const fixture = await workspaceFixture(page);
  await page.goto("/inbox");
  await expect(page.getByRole("button", { name: "Bandeja activa", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Historial GHL", exact: true })).toHaveCount(0);
  const list = page.getByRole("region", { name: "Lista de conversaciones", exact: true });
  const thread = page.getByRole("region", { name: "Conversación seleccionada", exact: true });
  const context = page.getByRole("complementary", { name: "Contexto de conversación" });
  await expect(list.locator('[data-source="QUANTUM"]')).toContainText("Andrea Sintética");
  await expect(list.locator('[data-source="GHL"]')).toContainText("Andrea Sintética");
  await list.locator('[data-source="QUANTUM"]').click();
  await expect(thread.getByText(message.body, { exact: true })).toBeVisible();
  await expect(context.getByRole("heading", { name: "Andrea Sintética" })).toBeVisible();
  await expect(thread.getByText("Asesor del chat:")).toBeVisible();
  await expect(thread.getByText("María Asesora Sintética", { exact: true })).toBeVisible();
  await expect(context.getByText("Sedán sintético", { exact: true })).toBeVisible();
  await expect(context.getByText("Cliente frecuente", { exact: true })).toBeVisible();
  await expect(context.getByText("Preferencia sin completar", { exact: true })).toHaveCount(0);
  await thread.getByRole("button", { name: "Cerrar ficha" }).click();
  await expect(context).toHaveCount(0);
  await thread.getByRole("button", { name: "Ver ficha del contacto" }).click();
  await expect(context.getByRole("heading", { name: "Andrea Sintética" })).toBeVisible();
  const draft = thread.getByPlaceholder("Responder por Correo…");
  await draft.fill("Borrador sintético sin enviar");
  await expect(thread.getByRole("button", { name: "Enviar", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("inbox-desktop.png") });
  await thread.getByRole("button", { name: "Cerrar ficha" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await thread.scrollIntoViewIfNeeded();
  await expect(draft).toHaveValue("Borrador sintético sin enviar");
  await thread.getByRole("tab", { name: "Nota interna" }).click();
  await expect(thread.getByText("Solo la ve el equipo", { exact: true })).toBeVisible();
  await expectContainedViewport(page);
  await page.screenshot({ path: testInfo.outputPath("inbox-mobile.png") });
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test("contact owner and binary custom field update directly from the conversation card", async ({
  page,
}) => {
  await workspaceFixture(page);
  let current: Contact = primaryContact;
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/contacts/*", async (route) => {
    const request = route.request();
    if (request.method() !== "PATCH") return route.fallback();
    expect(request.headers()["x-csrf-token"]).toBe("synthetic-csrf-token");
    expect(request.headers()["if-match"]).toBe(`"${current.version}"`);
    const patch = request.postDataJSON() as Record<string, unknown>;
    writes.push(patch);
    current = {
      ...current,
      ...(Object.hasOwn(patch, "ownerMemberId")
        ? { ownerMemberId: patch.ownerMemberId as string | null }
        : {}),
      ...(patch.customField
        ? {
            customFields: current.customFields.map((field) =>
              field.fieldId === (patch.customField as { fieldId: string }).fieldId
                ? { ...field, value: (patch.customField as { value: string }).value }
                : field,
            ),
          }
        : {}),
      version: String(Number(current.version) + 1),
    };
    await route.fulfill({ json: { data: current } });
  });

  await page.goto("/inbox");
  await page.locator(`[data-source="QUANTUM"][data-conversation-id="${conversationId}"]`).click();
  const card = page.getByRole("region", { name: "Ficha del cliente" });
  const owner = card.getByRole("combobox", { name: "Responsable del contacto" });
  await expect(owner).toHaveValue(memberId);
  await owner.selectOption("");
  await expect(owner).toHaveValue("");
  await owner.selectOption(memberId);
  await expect(owner).toHaveValue(memberId);

  await card.getByRole("button", { name: "Asesor de Ventas: Si. Cambiar valor" }).click();
  const choices = card.getByRole("group", { name: "Asesor de Ventas" });
  await expect(choices.getByRole("button")).toHaveCount(2);
  await expect(choices.getByRole("button", { name: "Si" })).toBeVisible();
  await expect(choices.getByRole("button", { name: "No" })).toBeVisible();
  await choices.getByRole("button", { name: "No" }).click();
  await expect(
    card.getByRole("button", { name: "Asesor de Ventas: No. Cambiar valor" }),
  ).toBeVisible();
  expect(writes).toEqual([
    { ownerMemberId: null },
    { ownerMemberId: memberId },
    { customField: { fieldId: "019b0000-0000-7000-8000-000000000096", value: "No" } },
  ]);
});

test("one inbox preserves mixed pagination, shared search, selection and legacy contact links", async ({
  page,
}) => {
  const fixture = await workspaceFixture(page);
  await page.goto(`/inbox?history=1&contactId=${primaryContact.id}`);
  const list = page.getByRole("region", { name: "Lista de conversaciones", exact: true });
  await expect(list.locator("[data-source]")).toHaveCount(2);
  expect(fixture.inboxQueries[0]?.get("contactId")).toBe(primaryContact.id);
  expect(fixture.inboxQueries[0]?.get("contactState")).not.toBe("LINKED");
  await list.locator('[data-source="QUANTUM"]').click();
  await expect(page.getByText(message.body, { exact: true }).last()).toBeVisible();
  await list.locator('[data-source="GHL"]').click();
  await expect(
    page
      .getByRole("region", { name: "Mensajes históricos", exact: true })
      .getByText(historicalMessage.body, { exact: true }),
  ).toBeVisible();
  await list.locator('[data-source="QUANTUM"]').click();
  await expect(
    page
      .getByRole("region", { name: "Conversación seleccionada", exact: true })
      .getByText(historicalMessage.body, { exact: true }),
  ).toHaveCount(0);
  const pagination = page.getByRole("navigation", { name: "Páginas de conversaciones" });
  await pagination.getByRole("button", { name: "Siguiente", exact: true }).click();
  await expect(list.locator("[data-source]")).toHaveCount(1);
  await expect(list.locator('[data-source="GHL"]')).toContainText("Última Sintética");
  expect(fixture.inboxQueries.at(-1)?.get("cursor")).toBe("synthetic-inbox-next");
  const search = page.getByRole("searchbox", { name: "Buscar conversaciones" });
  await search.fill("Texto original");
  await search.press("Enter");
  await expect.poll(() => fixture.inboxQueries.at(-1)?.get("query")).toBe("Texto original");
  expect(fixture.inboxQueries.at(-1)?.has("cursor")).toBe(false);
  await expect(list.locator('[data-source="GHL"]')).toContainText("Andrea Sintética");
  await expect(list.locator('[data-source="QUANTUM"]')).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test("channel filters reset pagination and preserve or clear shared inbox filters", async ({
  page,
}) => {
  const fixture = await workspaceFixture(page, undefined, { channelFiltering: true });
  await page.goto(`/inbox?contactId=${primaryContact.id}`);
  const list = page.getByRole("region", { name: "Lista de conversaciones", exact: true });
  const rows = list.locator("[data-source]");
  const search = page.getByRole("searchbox", { name: "Buscar conversaciones" });
  const pagination = page.getByRole("navigation", { name: "Páginas de conversaciones" });
  await expect(rows).toHaveCount(5);
  await search.fill("consulta");
  await search.press("Enter");
  await expect.poll(() => fixture.inboxQueries.at(-1)?.get("query")).toBe("consulta");
  await page.getByLabel("Vínculo del contacto").selectOption("LINKED");
  await expect.poll(() => fixture.inboxQueries.at(-1)?.get("contactState")).toBe("LINKED");
  const openView = page.getByRole("button", { name: "Abiertas", exact: true });
  await openView.click();
  await expect.poll(() => fixture.inboxQueries.at(-1)?.get("status")).toBe("OPEN");
  await pagination.getByRole("button", { name: "Siguiente", exact: true }).click();
  await expect.poll(() => fixture.inboxQueries.at(-1)?.get("cursor")).toBe("synthetic-channels-5");
  await expect(rows).toHaveCount(5);
  await page.getByRole("button", { name: "Mostrar filtros" }).click();
  const channel = page.getByRole("combobox", { name: "Canal", exact: true });
  await channel.selectOption("FACEBOOK");
  await expect.poll(() => fixture.inboxQueries.at(-1)?.get("channel")).toBe("FACEBOOK");
  expect(fixture.inboxQueries.at(-1)?.has("cursor")).toBe(false);
  expect(fixture.inboxQueries.at(-1)?.get("query")).toBe("consulta");
  expect(fixture.inboxQueries.at(-1)?.get("status")).toBe("OPEN");
  expect(fixture.inboxQueries.at(-1)?.get("contactState")).toBe("LINKED");
  expect(fixture.inboxQueries.at(-1)?.get("contactId")).toBe(primaryContact.id);
  await expect(openView).toHaveAttribute("aria-pressed", "true");
  await expect(rows).toHaveCount(1);
  await expect(rows.locator('[data-channel="facebook"]')).toHaveText("Messenger");
  await expect(pagination.getByRole("button", { name: "Siguiente", exact: true })).toBeDisabled();

  await channel.selectOption("FORM");
  await expect.poll(() => fixture.inboxQueries.at(-1)?.get("channel")).toBe("FORM");
  await expect(list.getByText("Esta vista está vacía", { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(0);
  await expect(list.getByRole("alert")).toHaveCount(0);
  await channel.selectOption("");
  await expect.poll(() => fixture.inboxQueries.at(-1)?.has("channel")).toBe(false);
  expect(fixture.inboxQueries.at(-1)?.get("query")).toBe("consulta");
  expect(fixture.inboxQueries.at(-1)?.get("status")).toBe("OPEN");
  expect(fixture.inboxQueries.at(-1)?.get("contactState")).toBe("LINKED");
  await expect(rows).toHaveCount(5);

  for (const sample of channelSamples.slice(4)) {
    await channel.selectOption(sample.channel);
    await expect.poll(() => fixture.inboxQueries.at(-1)?.get("channel")).toBe(sample.channel);
    await expect(rows).toHaveCount(sample.channel === "EMAIL" ? 2 : 1);
    await expect(rows.locator(`[data-channel="${sample.key}"]`)).toHaveCount(
      sample.channel === "EMAIL" ? 2 : 1,
    );
    if (sample.channel === "EMAIL") {
      await expect(list.locator('[data-source="QUANTUM"]')).toContainText("Correo");
      await expect(list.locator('[data-source="GHL"]')).toContainText("Correo");
    }
  }

  await channel.selectOption("EMAIL");
  await expect(rows).toHaveCount(2);
  await page.getByRole("combobox", { name: "Atención", exact: true }).selectOption("HUMAN");
  await page.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
  await expect.poll(() => fixture.inboxQueries.at(-1)?.get("attentionMode")).toBe("HUMAN");
  await expect(rows).toHaveCount(1);
  await channel.selectOption("WHATSAPP");
  await expect(list.getByText("Esta vista está vacía", { exact: true })).toBeVisible();
  expect(fixture.inboxQueries.at(-1)?.get("attentionMode")).toBe("HUMAN");
  await page.getByRole("button", { name: "Limpiar filtros", exact: true }).click();
  await expect.poll(() => fixture.inboxQueries.at(-1)?.has("attentionMode")).toBe(false);
  for (const filter of ["channel", "query", "status", "contactId", "cursor"]) {
    expect(fixture.inboxQueries.at(-1)?.has(filter)).toBe(false);
  }
  expect(fixture.inboxQueries.at(-1)?.get("contactState")).toBe("ALL");
  await expect(search).toHaveValue("");
  await expect(channel).toHaveValue("");
  await expect(page.getByLabel("Vínculo del contacto")).toHaveValue("ALL");
  expect(new URL(page.url()).searchParams.has("contactId")).toBe(false);
  await expect(rows).toHaveCount(5);
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test("recognized brands keep their own icons in filtered rows, thread headers and messages", async ({
  page,
}) => {
  const fixture = await workspaceFixture(page, undefined, { channelFiltering: true });
  await page.goto("/inbox");
  const list = page.getByRole("region", { name: "Lista de conversaciones", exact: true });
  await expect(list.locator("[data-source]")).toHaveCount(5);
  await page.getByRole("button", { name: "Mostrar filtros" }).click();
  for (const sample of channelSamples.slice(0, 4)) {
    await page.getByRole("combobox", { name: "Canal", exact: true }).selectOption(sample.channel);
    await expect.poll(() => fixture.inboxQueries.at(-1)?.get("channel")).toBe(sample.channel);
    const row = list.locator('[data-source="GHL"]');
    await expect(row).toHaveCount(1);
    await expect(row.getByText(sample.label, { exact: true })).toBeVisible();
    await expect(row.locator(`[data-brand-icon="${sample.key}"]`)).toBeVisible();
    await row.click();
    const history = page.getByRole("region", { name: "Mensajes históricos", exact: true });
    await expect(
      history.getByText(`Mensaje sintético de ${sample.label}`, { exact: true }),
    ).toBeVisible();
    await expect(history.locator(`[data-channel="${sample.key}"]`)).toHaveCount(2);
    await expect(history.locator(`[data-brand-icon="${sample.key}"]`)).toHaveCount(2);
    await expect(
      history.locator(`[data-direction="inbound"] [data-brand-icon="${sample.key}"]`),
    ).toBeVisible();
    await expect(history.getByText("Solo lectura", { exact: true })).toBeVisible();
    await expect(history.getByRole("button", { name: "Enviar", exact: true })).toHaveCount(0);
  }
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test("imported history remains read only and downloads only the verified synthetic attachment", async ({
  page,
}, testInfo) => {
  const fixture = await workspaceFixture(page);
  await page.goto("/inbox");
  await page.locator(`[data-source="GHL"][data-conversation-id="${historicalId}"]`).click();
  await expect(page.getByRole("region", { name: "Mensajes históricos" })).toContainText(
    "Julio Asesor Invitado",
  );
  const card = page.getByRole("region", { name: "Ficha del cliente" });
  await expect(card.getByRole("heading", { name: "Andrea Sintética" })).toBeVisible();
  await expect(card.getByText("Vehículo preferido", { exact: true })).toBeVisible();
  await expect(card.getByText("Sedán sintético", { exact: true })).toBeVisible();
  await expect(card.getByText("Cliente frecuente", { exact: true })).toBeVisible();
  await card.getByText("Responsables originales", { exact: true }).click();
  const originalContact = card.getByRole("region", { name: "Responsables originales de contacto" });
  await expect(
    originalContact.getByText("Lucía Propietaria Sintética", { exact: true }),
  ).toBeVisible();
  await expect(
    originalContact.getByText("Mateo Seguidor Sintético", { exact: true }),
  ).toBeVisible();
  await page.getByText("Participantes originales", { exact: true }).click();
  const originalThread = page.getByRole("region", {
    name: "Responsables originales de conversación",
  });
  await expect(
    originalThread.getByText("Valentina Responsable Sintética", { exact: true }),
  ).toBeVisible();
  await expect(
    originalThread.getByText("Nicolás Seguidor Sintético", { exact: true }),
  ).toBeVisible();
  await expect(originalThread).toContainText("No equivalen a cuentas ni permisos de Quantum");
  await card.getByLabel("Incluir campos vacíos").check();
  await expect(card.getByText("Preferencia sin completar", { exact: true })).toBeVisible();
  await expect(card.getByText("Sin valor guardado", { exact: true })).toBeVisible();
  await card.getByRole("searchbox", { name: "Buscar campos" }).fill("preferido");
  await expect(card.getByText("Sedán sintético", { exact: true })).toBeVisible();
  await expect(card.getByText("Preferencia sin completar", { exact: true })).toHaveCount(0);
  await card.getByRole("searchbox", { name: "Buscar campos" }).fill("");
  const history = page.getByRole("region", { name: "Mensajes históricos", exact: true });
  await expect(history.getByText(historicalMessage.body, { exact: true })).toBeVisible();
  await expect(history.getByRole("textbox")).toHaveCount(0);
  await expect(history.getByRole("button", { name: "Enviar", exact: true })).toHaveCount(0);
  await expect(history.getByRole("link", { name: "Abrir contacto" })).toHaveAttribute(
    "href",
    `/contacts?contact=${primaryContact.id}`,
  );
  await page.screenshot({ path: testInfo.outputPath("history-desktop.png") });
  const downloadEvent = page.waitForEvent("download");
  await history.getByRole("button", { name: "Descargar", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("synthetic.txt");
  expect(await download.failure()).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  await expectContainedViewport(page);
  await page.getByLabel("Vínculo del contacto").selectOption("UNLINKED");
  await expect(
    page.getByRole("button", { name: /Sin contacto vinculado · 123456/u }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Andrea Sintética/u })).toHaveCount(0);
  expect(fixture.writes).toEqual([`POST /api/files/${fileId}/download-authorizations`]);
  expect(fixture.unexpected).toEqual([]);
});

test("TikTok has its own icon and CRM labels omit the import provider while preserving message content", async ({
  page,
}) => {
  const originalBody = "Mensaje original: nuestro equipo usaba GHL.";
  const fixture = await workspaceFixture(page, undefined, {
    channel: "TYPE_TIKTOK",
    message: { rawDirection: "outbound", body: originalBody },
  });
  await page.goto("/inbox");
  const list = page.getByRole("region", { name: "Lista de conversaciones", exact: true });
  const context = page.getByRole("complementary", { name: "Contexto de conversación" });
  await expect(list.locator("[data-source]")).toHaveCount(2);
  const imported = list.locator(`[data-source="GHL"][data-conversation-id="${historicalId}"]`);
  const listIcon = imported.locator('[data-channel="tiktok"] path[data-brand-icon="tiktok"]');
  await expect(imported.getByText("TikTok", { exact: true })).toBeVisible();
  await expect(listIcon).toBeVisible();
  await expect(listIcon).toHaveAttribute("fill", "currentColor");
  await expect(listIcon).toHaveAttribute("stroke", "none");
  await list.locator('[data-source="QUANTUM"]').click();
  await expect(context.getByRole("heading", { name: "Andrea Sintética" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/GHL/u);

  await imported.click();
  const history = page.getByRole("region", { name: "Mensajes históricos", exact: true });
  await expect(history.getByText(originalBody, { exact: true })).toBeVisible();
  await expect(history.getByText("Enviado", { exact: true })).toBeVisible();
  await expect(history.getByText("Solo lectura", { exact: true })).toBeVisible();
  await expect(context.getByText("Solo lectura", { exact: true })).toBeVisible();
  await expect(history.locator('path[data-brand-icon="tiktok"]')).toHaveCount(2);
  await expect(
    history.locator('[data-direction="outbound"] path[data-brand-icon="tiktok"]'),
  ).toBeVisible();
  await expect(context).not.toContainText(/GHL/u);
  await expect(list).not.toContainText(/GHL/u);
  await expect(page.getByText(/GHL/u)).toHaveText(originalBody);

  await page.getByLabel("Vínculo del contacto").selectOption("UNLINKED");
  const orphan = list.getByRole("button", { name: /Sin contacto vinculado · 123456/u });
  await expect(orphan).toBeVisible();
  await expect(list).not.toContainText(/GHL/u);
  await orphan.click();
  await expect(
    history.getByRole("heading", { name: "Sin contacto vinculado · 123456" }),
  ).toBeVisible();
  await expect(history.getByText(originalBody, { exact: true })).toBeVisible();
  await expect(history).toContainText("su ficha original no está disponible");
  await expect(context.getByRole("region", { name: "Ficha del cliente" })).toContainText(
    "Esta conversación no tiene un contacto vinculado",
  );
  await expect(page.getByText(/GHL/u)).toHaveText(originalBody);

  await page.goto("/contacts");
  await page
    .getByRole("table", { name: "Lista de contactos" })
    .getByRole("button")
    .filter({
      has: page.getByText("Andrea Sintética", { exact: true }),
    })
    .click();
  const detail = page.getByRole("complementary", { name: "Ficha de Andrea Sintética" });
  await detail.getByRole("button", { name: "Conversaciones", exact: true }).click();
  await expect(
    detail.getByRole("link", { name: "Ver conversaciones", exact: true }),
  ).toHaveAttribute("href", `/inbox?contactId=${primaryContact.id}`);
  await expect(page.locator("body")).not.toContainText(/GHL/u);
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test("historical verified images, audio and video render with fresh access and recognizable channels", async ({
  page,
}, testInfo) => {
  const media = await syntheticMedia(page);
  const fixture = await workspaceFixture(page, media);
  await page.goto("/inbox");
  const threadButton = page.locator(`[data-source="GHL"][data-conversation-id="${historicalId}"]`);
  await expect(threadButton.getByText("WhatsApp", { exact: true })).toBeVisible();
  await threadButton.click();
  const history = page.getByRole("region", { name: "Mensajes históricos", exact: true });
  await expect(history.getByText("WhatsApp", { exact: true })).toHaveCount(2);
  const attachments = history.getByRole("list", { name: "Adjuntos del mensaje" });
  const attachment = (name: string) =>
    attachments.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
  const image = attachment("synthetic-image.png");
  await image.scrollIntoViewIfNeeded();
  await expect(image.getByRole("alert")).toContainText("No se pudo mostrar");
  await image.getByRole("button", { name: "Reintentar vista previa" }).click();
  const inlineImage = image.getByRole("img", { name: "synthetic-image.png" });
  await expect(inlineImage).toBeVisible();
  await expect
    .poll(() => inlineImage.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBe(160);
  expect(fixture.authorizations.get(imageFileId)).toBe(2);

  const audioAttachment = attachment("synthetic-audio.wav");
  expect(fixture.authorizations.has(audioFileId)).toBe(false);
  await audioAttachment.getByRole("button", { name: "Cargar audio" }).click();
  const audio = audioAttachment.locator("audio");
  await expect(audio).toHaveAttribute("controls", "");
  await expect(audio).not.toHaveAttribute("autoplay", "");
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await audio.evaluate(async (element: HTMLAudioElement) => {
    element.muted = true;
    await element.play();
  });
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(0);
  await audio.evaluate((element: HTMLAudioElement) => element.pause());

  const videoAttachment = attachment("synthetic-video.webm");
  expect(fixture.authorizations.has(videoFileId)).toBe(false);
  await videoAttachment.getByRole("button", { name: "Cargar video" }).click();
  const video = videoAttachment.locator("video");
  await expect(video).toHaveAttribute("controls", "");
  await expect(video).not.toHaveAttribute("autoplay", "");
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth))
    .toBe(160);
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
  });
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0);
  await video.evaluate((element: HTMLVideoElement) => element.pause());

  const rejected = attachment("synthetic-rejected.png");
  await expect(rejected).toContainText("No disponible: formato o contenido rechazado.");
  await expect(rejected.getByRole("button")).toHaveCount(0);
  expect(fixture.authorizations.has(rejectedFileId)).toBe(false);
  expect(fixture.mediaRequests).not.toContain(rejectedFileId);
  const document = attachment("synthetic.txt");
  for (let attempt = 0; attempt < 2; attempt++) {
    const event = page.waitForEvent("download");
    await document.getByRole("button", { name: "Descargar", exact: true }).click();
    const download = await event;
    expect(await download.failure()).toBeNull();
  }
  expect(fixture.authorizations.get(fileId)).toBe(2);
  expect(fixture.unexpected).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await image.scrollIntoViewIfNeeded();
  await expect(inlineImage).toBeVisible();
  await expectContainedViewport(page);
  await page.screenshot({ path: testInfo.outputPath("historical-media-mobile.png") });
});
