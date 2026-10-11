import type {
  Contact,
  Conversation,
  ConversationMessage,
  HistoricalConversation,
  HistoricalConversationMessage,
  HistoricalConversationAttachment,
} from "@quantum-crm/contracts";
import { expect, test, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:3107";
const timestamp = "2026-10-11T15:00:00.000Z";
const memberId = "019b0000-0000-7000-8000-000000000001";
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
  contact(3, "Última Sintética"),
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
  createdAt: timestamp,
  updatedAt: timestamp,
};
const historical: HistoricalConversation = {
  id: historicalId,
  source: "GHL",
  sourceExternalId: "synthetic-thread",
  sourceThreadPresent: true,
  contactId: primaryContact.id,
  assigneeMemberId: memberId,
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

async function workspaceFixture(page: Page, media?: SyntheticMedia) {
  const queries: URLSearchParams[] = [];
  const writes: string[] = [];
  const unexpected: string[] = [];
  const authorizations = new Map<string, number>();
  const mediaRequests: string[] = [];
  const visibleThread = media ? { ...historical, rawChannel: "TYPE_WHATSAPP" } : historical;
  const visibleMessage = media
    ? {
        ...historicalMessage,
        rawChannel: null,
        rawType: "TYPE_WHATSAPP",
        attachmentCount: 5,
        attachments: mediaAttachments(media),
      }
    : historicalMessage;
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
      if (path === "/api/custom-field-definitions") {
        expect(url.searchParams.get("model")).toBe("contact");
        expect(url.searchParams.get("limit")).toBe("100");
        await respond({
          data: [
            {
              id: "019b0000-0000-7000-8000-000000000098",
              key: "vehicle",
              label: "Vehículo preferido",
              description: "Preferencia sintética",
              dataType: "TEXT",
              model: "contact",
            },
            {
              id: "019b0000-0000-7000-8000-000000000097",
              key: "synthetic-empty",
              label: "Preferencia sin completar",
              description: "Campo sintético vacío",
              dataType: "TEXT",
              model: "contact",
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
      if (path === "/api/members" || path === "/api/tasks/assignees") {
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
      if (path === "/api/conversations/historical") {
        await respond({
          data:
            url.searchParams.get("contactState") === "UNLINKED"
              ? [
                  {
                    ...historical,
                    id: "019b0000-0000-7000-8000-000000000009",
                    contactId: null,
                    sourceExternalId: "orphan-123456",
                    subject: "Conversación histórica sin ficha actual en GHL",
                    sourceThreadPresent: false,
                  },
                ]
              : [visibleThread],
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
      if (path === "/api/conversations") {
        await respond({ data: [conversation] });
        return;
      }
      if (path === `/api/conversations/${conversationId}`) {
        await respond({ data: { conversation, messages: [message], history: [] } });
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
        if (mediaId === imageFileId && url.searchParams.get("attempt") === "1") {
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
  return { queries, writes, unexpected, authorizations, mediaRequests };
}

async function expectContainedViewport(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}

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
  await page.getByRole("button", { name: "Bandeja activa", exact: true }).click();
  const list = page.getByRole("region", { name: "Lista de conversaciones", exact: true });
  const thread = page.getByRole("region", { name: "Conversación seleccionada", exact: true });
  const context = page.getByRole("complementary", { name: "Contexto de conversación" });
  await expect(list.getByRole("button", { name: /Andrea Sintética/u })).toBeVisible();
  await expect(thread.getByText(message.body, { exact: true })).toBeVisible();
  await expect(context.getByRole("heading", { name: "Andrea Sintética" })).toBeVisible();
  await expect(context.getByText("Sedán sintético", { exact: true })).toBeVisible();
  await expect(context.getByText("Cliente frecuente", { exact: true })).toBeVisible();
  const draft = thread.getByPlaceholder("Responder por Correo…");
  await draft.fill("Borrador sintético sin enviar");
  await expect(thread.getByRole("button", { name: "Enviar", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("inbox-desktop.png") });
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

test("imported history remains read only and downloads only the verified synthetic attachment", async ({
  page,
}, testInfo) => {
  const fixture = await workspaceFixture(page);
  await page.goto("/inbox");
  await page.getByRole("button", { name: "Historial GHL", exact: true }).click();
  await page.getByRole("button", { name: /Andrea Sintética/u }).click();
  const card = page.getByRole("region", { name: "Ficha del cliente" });
  await expect(card.getByRole("heading", { name: "Andrea Sintética" })).toBeVisible();
  await expect(card.getByText("Vehículo preferido", { exact: true })).toBeVisible();
  await expect(card.getByText("Sedán sintético", { exact: true })).toBeVisible();
  await expect(card.getByText("Cliente frecuente", { exact: true })).toBeVisible();
  const originalContact = card.getByRole("region", { name: "Responsables originales de contacto" });
  await expect(
    originalContact.getByText("Lucía Propietaria Sintética", { exact: true }),
  ).toBeVisible();
  await expect(
    originalContact.getByText("Mateo Seguidor Sintético", { exact: true }),
  ).toBeVisible();
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

test("historical verified images, audio and video render with fresh access and recognizable channels", async ({
  page,
}, testInfo) => {
  const media = await syntheticMedia(page);
  const fixture = await workspaceFixture(page, media);
  await page.goto("/inbox");
  await page.getByRole("button", { name: "Historial GHL", exact: true }).click();
  const threadButton = page.getByRole("button", { name: /Andrea Sintética/u });
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
