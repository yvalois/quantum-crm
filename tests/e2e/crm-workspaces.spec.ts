import type {
  Contact,
  Conversation,
  ConversationMessage,
  HistoricalConversation,
  HistoricalConversationMessage,
} from "@quantum-crm/contracts";
import { expect, test, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:3107";
const timestamp = "2026-10-11T15:00:00.000Z";
const memberId = "019b0000-0000-7000-8000-000000000001";
const conversationId = "019b0000-0000-7000-8000-000000000002";
const historicalId = "019b0000-0000-7000-8000-000000000003";
const fileId = "019b0000-0000-7000-8000-000000000004";

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
    source: "MANUAL",
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

async function workspaceFixture(page: Page) {
  const queries: URLSearchParams[] = [];
  const writes: string[] = [];
  const unexpected: string[] = [];
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
    if (path === `/api/files/${fileId}/download-authorizations` && method === "POST") {
      expect(request.headers()["x-csrf-token"]).toBe("synthetic-csrf-token");
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      await respond({
        data: {
          method: "GET",
          url: `${origin}/api/synthetic-download`,
          expiresAt: "2026-10-11T15:05:00.000Z",
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
              : [historical],
          page: { nextCursor: null },
        });
        return;
      }
      if (path === `/api/conversations/historical/${historicalId}`) {
        await respond({ data: historical });
        return;
      }
      if (path === `/api/conversations/historical/${historicalId}/messages`) {
        await respond({ data: [historicalMessage], page: { nextCursor: null } });
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
  return { queries, writes, unexpected };
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
