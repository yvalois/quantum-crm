import type {
  Contact,
  Opportunity,
  OpportunityHistoryEntry,
  Pipeline,
} from "@quantum-crm/contracts";
import { expect, test, type Locator, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:3107";
const createdAt = "2026-10-11T15:00:00.000Z";
const memberId = "019b0000-0000-7000-8000-000000000001";
const pipelineId = "019b0000-0000-7000-8000-000000000002";
const otherPipelineId = "019b0000-0000-7000-8000-000000000003";
const initialStageId = "019b0000-0000-7000-8000-000000000004";
const proposalStageId = "019b0000-0000-7000-8000-000000000005";
const renewalStageId = "019b0000-0000-7000-8000-000000000006";
const firstContactId = "019b0000-0000-7000-8000-000000000007";
const secondContactId = "019b0000-0000-7000-8000-000000000008";

const pipelines: Pipeline[] = [
  {
    id: pipelineId,
    name: "Ventas sintéticas",
    description: "Proceso de ventas para comprobar interacción",
    stages: [
      {
        id: initialStageId,
        name: "Contacto inicial",
        description: "Primera conversación",
        position: 0,
      },
      { id: proposalStageId, name: "Propuesta", description: "Propuesta presentada", position: 1 },
    ],
    createdAt,
  },
  {
    id: otherPipelineId,
    name: "Renovaciones sintéticas",
    description: "Negocios de renovación aislados del primer tablero",
    stages: [
      {
        id: renewalStageId,
        name: "Renovación",
        description: "Seguimiento de renovación",
        position: 0,
      },
    ],
    createdAt,
  },
];

function contact(id: string, displayName: string): Contact {
  return {
    id,
    ownerMemberId: memberId,
    displayName,
    email: `${id}@example.test`,
    phone: "+573000000001",
    labels: [],
    customFields: [],
    source: "MANUAL",
    archivedAt: null,
    version: "1",
    createdAt,
    updatedAt: createdAt,
  };
}

const contacts = [
  contact(firstContactId, "Andrea Sintética"),
  contact(secondContactId, "Carolina Prueba"),
];

function opportunity(index: number): Opportunity {
  return {
    id: `019b0000-0000-7000-8000-${String(index + 100).padStart(12, "0")}`,
    ownerMemberId: memberId,
    contactId: secondContactId,
    pipelineId,
    stageId: initialStageId,
    title: `Acuerdo sintético ${index + 1}`,
    amountMinor: "12500000",
    currency: "COP",
    status: "OPEN",
    closeReason: null,
    closedAt: null,
    version: "1",
    createdAt,
    updatedAt: createdAt,
  };
}

interface Mutation {
  readonly opportunityId: string;
  readonly stageId: string;
  readonly ifMatch: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly csrf: string | undefined;
}

async function boardFixture(page: Page, count = 2) {
  const deals = Array.from({ length: count }, (_, index) => opportunity(index));
  const renewal = {
    ...opportunity(count),
    pipelineId: otherPipelineId,
    stageId: renewalStageId,
    title: "Renovación anual sintética",
  };
  const all = [...deals, renewal];
  const mutations: Mutation[] = [];
  const histories = new Map<string, OpportunityHistoryEntry[]>();
  let rejectNextMove = false;

  await page
    .context()
    .addCookies([
      {
        name: "qcrm_crm_session",
        value: "synthetic-browser-only",
        url: origin,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  // Fail closed: no browser API request reaches a live CRM or authentication service.
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(url.origin).toBe(origin);
    const respond = async (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (url.pathname === "/api/auth/session") {
      await respond({ authenticated: true, csrfToken: "synthetic-csrf-token" });
      return;
    }
    if (url.pathname === "/api/pipeline") {
      await respond({ data: pipelines });
      return;
    }
    if (url.pathname === "/api/members") {
      await respond({
        data: [
          {
            id: memberId,
            displayName: "María Asesora",
            status: "ACTIVE",
            email: "advisor@example.test",
          },
        ],
      });
      return;
    }
    if (url.pathname === "/api/contacts") {
      const secondPage = url.searchParams.has("cursor");
      await respond({
        data: [contacts[secondPage ? 1 : 0]],
        page: {
          limit: 100,
          total: 2,
          nextCursor: secondPage ? null : "synthetic-next-page",
          previousCursor: null,
        },
      });
      return;
    }
    const contactMatch = /^\/api\/contacts\/([^/]+)$/u.exec(url.pathname);
    if (contactMatch) {
      const found = contacts.find((item) => item.id === contactMatch[1]);
      await respond(
        found ? { data: found } : { title: "Contacto no encontrado" },
        found ? 200 : 404,
      );
      return;
    }
    if (url.pathname === "/api/opportunities" && request.method() === "GET") {
      await respond({
        data: all.filter(
          (item) =>
            (!url.searchParams.get("pipelineId") ||
              item.pipelineId === url.searchParams.get("pipelineId")) &&
            (!url.searchParams.get("stageId") ||
              item.stageId === url.searchParams.get("stageId")) &&
            (!url.searchParams.get("status") || item.status === url.searchParams.get("status")),
        ),
      });
      return;
    }
    const match = /^\/api\/opportunities\/([^/]+)(?:\/(move|history))?$/u.exec(url.pathname);
    const current = match ? all.find((item) => item.id === match[1]) : undefined;
    if (match && current) {
      if (match[2] === "history") {
        await respond({ data: histories.get(current.id) ?? [] });
        return;
      }
      if (request.method() === "GET") {
        await respond({ data: current });
        return;
      }
      if (match[2] === "move" && request.method() === "PATCH") {
        const body = request.postDataJSON() as { stageId: string };
        const headers = request.headers();
        mutations.push({
          opportunityId: current.id,
          stageId: body.stageId,
          ifMatch: headers["if-match"],
          idempotencyKey: headers["idempotency-key"],
          csrf: headers["x-csrf-token"],
        });
        if (rejectNextMove) {
          rejectNextMove = false;
          await respond({ title: "Conflicto sintético: vuelve a intentar", status: 412 }, 412);
          return;
        }
        expect(headers["if-match"]).toBe(`"${current.version}"`);
        expect(headers["idempotency-key"]).toBeTruthy();
        expect(headers["x-csrf-token"]).toBe("synthetic-csrf-token");
        const previousStageId = current.stageId;
        current.stageId = body.stageId;
        current.version = String(Number(current.version) + 1);
        histories.set(current.id, [
          {
            id: "019b0000-0000-7000-8000-000000000020",
            opportunityId: current.id,
            eventType: "STAGE_CHANGED",
            actorMemberId: memberId,
            previousStageId,
            nextStageId: body.stageId,
            previousOwnerMemberId: memberId,
            nextOwnerMemberId: memberId,
            previousStatus: "OPEN",
            nextStatus: "OPEN",
            previousAmountMinor: current.amountMinor,
            nextAmountMinor: current.amountMinor,
            note: null,
            createdAt,
          },
        ]);
        await respond({ data: current });
        return;
      }
    }
    await route.abort("blockedbyclient");
    throw new Error(`Unexpected synthetic API request: ${request.method()} ${url.pathname}`);
  });
  return {
    deals,
    mutations,
    rejectMove: () => {
      rejectNextMove = true;
    },
  };
}

function card(page: Page, title: string): Locator {
  return page.locator("article").filter({ has: page.getByText(title, { exact: true }) });
}

async function dragCard(page: Page, source: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded();
  const start = await source.boundingBox();
  const end = await target.boundingBox();
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  if (!start || !end) throw new Error("Drag source or target is not visible");
  await page.mouse.move(start.x + 12, start.y + 12);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y + 30, { steps: 4 });
  await page.mouse.move(end.x + end.width / 2, end.y + 160, { steps: 12 });
  await page.mouse.move(end.x + end.width / 2, end.y + 165);
  await page.mouse.up();
}

test("pipeline row opens its own board and an opportunity opens full details", async ({ page }) => {
  await boardFixture(page);
  await page.goto("/pipelines");
  await page.getByRole("link").filter({ hasText: "Renovaciones sintéticas" }).click();
  await expect(page).toHaveURL(new RegExp(`pipeline=${otherPipelineId}`, "u"));
  await expect(
    page.getByRole("region", { name: "Tablero Renovaciones sintéticas", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Renovación anual sintética", { exact: true })).toBeVisible();
  await expect(page.getByText("Acuerdo sintético 1", { exact: true })).toHaveCount(0);

  await page.goto(`/pipeline?pipeline=${pipelineId}`);
  await card(page, "Acuerdo sintético 1").click({ position: { x: 12, y: 12 } });
  const drawer = page.getByRole("dialog", { name: "Acuerdo sintético 1" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Carolina Prueba", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("spinbutton", { name: "Valor" })).toHaveValue("125000");
  await expect(drawer.getByRole("button", { name: "Guardar cambios", exact: true })).toBeEnabled();
  await expect(drawer.getByRole("heading", { name: "Historial de la oportunidad" })).toBeVisible();
});

test("card body and keyboard open details with contact information on desktop and tablet", async ({
  page,
}, testInfo) => {
  await boardFixture(page);
  await page.goto(`/pipeline?pipeline=${pipelineId}`);
  const deal = card(page, "Acuerdo sintético 1");
  await expect(deal).toContainText("Carolina Prueba");
  await deal.click({ position: { x: 12, y: 12 } });
  await expect(page.getByRole("dialog", { name: "Acuerdo sintético 1" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("pipeline-desktop-synthetic.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await deal.getByRole("button", { name: "Abrir oportunidad Acuerdo sintético 1" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Acuerdo sintético 1" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({
    path: testInfo.outputPath("pipeline-tablet-synthetic.png"),
    fullPage: true,
  });
  await deal.click({ position: { x: 12, y: 12 } });
  await expect(page.getByRole("dialog", { name: "Acuerdo sintético 1" })).toBeVisible();
});

test("pointer drag updates the column and counts, then selection moves the same opportunity back", async ({
  page,
}) => {
  const fixture = await boardFixture(page);
  await page.goto(`/pipeline?pipeline=${pipelineId}`);
  const initial = page.getByRole("region", { name: "Contacto inicial", exact: true });
  const proposal = page.getByRole("region", { name: "Propuesta", exact: true });
  await expect(initial.getByRole("heading")).toHaveText("Contacto inicial 2");
  await dragCard(page, card(page, "Acuerdo sintético 1"), proposal);
  await expect(page.getByText("Oportunidad movida a Propuesta.", { exact: true })).toBeVisible();
  await expect(proposal.getByText("Acuerdo sintético 1", { exact: true })).toBeVisible();
  await expect(initial.getByRole("heading")).toHaveText("Contacto inicial 1");
  await expect(proposal.getByRole("heading")).toHaveText("Propuesta 1");
  expect(fixture.mutations).toHaveLength(1);
  expect(fixture.mutations[0]).toMatchObject({ ifMatch: '"1"', stageId: proposalStageId });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await card(page, "Acuerdo sintético 1")
    .getByRole("button", { name: "Abrir oportunidad Acuerdo sintético 1" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Acuerdo sintético 1" })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.reload();
  await expect(proposal.getByText("Acuerdo sintético 1", { exact: true })).toBeVisible();
  await card(page, "Acuerdo sintético 1").click({ position: { x: 12, y: 12 } });
  await page
    .getByRole("combobox", { name: "Mover oportunidad a etapa" })
    .selectOption(initialStageId);
  await expect(page.getByRole("combobox", { name: "Mover oportunidad a etapa" })).toHaveValue(
    initialStageId,
  );
  expect(fixture.mutations).toHaveLength(2);
  expect(fixture.mutations[1]).toMatchObject({ ifMatch: '"2"', stageId: initialStageId });
  await expect(page.getByRole("dialog")).toContainText("Cambio de etapa");
});

test("a rejected move keeps the original card and counters and exposes the recoverable error", async ({
  page,
}) => {
  const fixture = await boardFixture(page);
  fixture.rejectMove();
  await page.goto(`/pipeline?pipeline=${pipelineId}`);
  const initial = page.getByRole("region", { name: "Contacto inicial", exact: true });
  const proposal = page.getByRole("region", { name: "Propuesta", exact: true });
  await expect(initial.getByRole("heading")).toHaveText("Contacto inicial 2");
  await dragCard(page, card(page, "Acuerdo sintético 1"), proposal);
  await expect(page.getByRole("alert")).toContainText("Otra persona actualizó");
  await expect(initial.getByText("Acuerdo sintético 1", { exact: true })).toBeVisible();
  await expect(initial.getByRole("heading")).toHaveText("Contacto inicial 2");
  await expect(proposal.getByText("Acuerdo sintético 1", { exact: true })).toHaveCount(0);
  expect(fixture.mutations).toHaveLength(1);
});

test("the board searches and opens the last of 1127 opportunities without truncating results", async ({
  page,
}) => {
  await boardFixture(page, 1127);
  await page.goto(`/pipeline?pipeline=${pipelineId}`);
  const summary = page.getByRole("region", { name: "Resumen del pipeline mostrado" });
  await expect(summary).toContainText("1127");
  await page.getByRole("searchbox", { name: "Buscar oportunidad" }).fill("Acuerdo sintético 1127");
  const last = card(page, "Acuerdo sintético 1127");
  await expect(last).toBeVisible();
  await expect(page.locator("article")).toHaveCount(1);
  await last.click({ position: { x: 12, y: 12 } });
  await expect(page.getByRole("dialog", { name: "Acuerdo sintético 1127" })).toBeVisible();
});
