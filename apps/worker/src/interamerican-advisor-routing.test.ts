import type { CrmPostgresDatabase } from "@quantum-crm/database";
import { describe, expect, it, vi } from "vitest";

import { routeInterAmericanAdvisor } from "./interamerican-advisor-routing.js";

const contactId = "019b0000-0000-7000-8000-000000000001";
const carlosId = "019b0000-0000-7000-8000-000000000002";
const julioId = "019b0000-0000-7000-8000-000000000003";
const conversationId = "019b0000-0000-7000-8000-000000000005";

function database(
  input: {
    previousOwner?: string;
    previousStatus?: "OPEN" | "WON";
    existingThreadOwner?: string | null;
    linkedConversationId?: string | null;
    anotherOpenOpportunity?: boolean;
  } = {},
) {
  const contact = {
    id: contactId,
    displayName: "Cliente de prueba",
    ownerMemberId: null,
    archivedAt: null,
    version: 1n,
  };
  const conversation = {
    id: conversationId,
    contactId,
    channel: "WHATSAPP",
    externalThreadId: "ycloud:1234567890123456:50255556666",
    assigneeMemberId: input.existingThreadOwner ?? null,
    attentionMode: "AGENT",
    status: "OPEN",
    version: 1n,
  };
  const opportunity = input.previousOwner
    ? [
        {
          id: "019b0000-0000-7000-8000-000000000004",
          contactId,
          sourceConversationId: input.linkedConversationId ?? null,
          ownerMemberId: input.previousOwner,
          status: input.previousStatus ?? "OPEN",
          version: 1n,
          updatedAt: new Date("2026-10-14T18:00:00Z"),
        },
      ]
    : [];
  if (input.anotherOpenOpportunity) {
    opportunity.push({
      id: "019b0000-0000-7000-8000-000000000006",
      contactId,
      sourceConversationId: null,
      ownerMemberId: julioId,
      status: "OPEN",
      version: 1n,
      updatedAt: new Date("2026-10-14T19:00:00Z"),
    });
  }
  const reserveAdvisor = vi.fn(
    async (route: { previousMemberId: string | null }) => route.previousMemberId ?? carlosId,
  );
  const updateContact = vi.fn(async () => ({ ...contact, ownerMemberId: carlosId }));
  const updateOpportunity = vi.fn(async () => opportunity[0]);
  const createOpportunity = vi.fn(async () => opportunity[0]);
  const mock = {
    members: {
      list: vi.fn(async () => ({
        members: [
          { id: carlosId, displayName: "Carlos Mejía", roleCode: "ADVISOR", status: "INVITED" },
          { id: julioId, displayName: "Julio Rafael", roleCode: "ADVISOR", status: "INVITED" },
        ],
        nextCursor: null,
      })),
    },
    commercial: {
      externalConversations: {
        reserveAdvisor,
      },
      conversations: {
        find: vi.fn(async () => conversation),
        update: vi.fn(async () => conversation),
      },
      contacts: { find: vi.fn(async () => contact), update: updateContact },
      sales: {
        resolveImportedStage: vi.fn(async () => ({ pipelineId: "pipeline", stageId: "stage" })),
        listOpportunities: vi.fn(async () => opportunity),
        updateOpportunity,
        createOpportunity,
      },
    },
  };
  return { mock, db: mock as unknown as CrmPostgresDatabase };
}

describe("InterAmerican advisor routing", () => {
  it("keeps the previous authorized advisor on chat, contact and open opportunity", async () => {
    const { db, mock } = database({ previousOwner: julioId, linkedConversationId: conversationId });
    expect(await routeInterAmericanAdvisor(db, { conversationId })).toBe(julioId);
    expect(mock.commercial.externalConversations.reserveAdvisor).toHaveBeenCalledWith(
      expect.objectContaining({ previousMemberId: julioId }),
    );
    expect(mock.commercial.contacts.update).toHaveBeenCalledWith(
      expect.objectContaining({ contact: expect.objectContaining({ ownerMemberId: julioId }) }),
    );
    expect(mock.commercial.sales.updateOpportunity).not.toHaveBeenCalled();
    expect(mock.commercial.conversations.update).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeMemberId: julioId }),
    );
  });

  it("creates one opportunity in the imported qualified stage when none is open", async () => {
    const { db, mock } = database();
    expect(await routeInterAmericanAdvisor(db, { conversationId })).toBe(carlosId);
    expect(mock.commercial.sales.createOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunity: expect.objectContaining({ ownerMemberId: carlosId, currency: "GTQ" }),
      }),
    );
  });

  it("creates a fresh opportunity after the prior one has closed", async () => {
    const { db, mock } = database({ previousOwner: julioId, previousStatus: "WON" });
    await routeInterAmericanAdvisor(db, { conversationId });
    expect(mock.commercial.sales.createOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `agent-route-${conversationId}`,
        opportunity: expect.objectContaining({ sourceConversationId: conversationId }),
      }),
    );
  });

  it("links the sole open opportunity to the conversation before handoff", async () => {
    const { db, mock } = database({ previousOwner: carlosId });
    await routeInterAmericanAdvisor(db, { conversationId });
    expect(mock.commercial.sales.updateOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunity: expect.objectContaining({ sourceConversationId: conversationId }),
      }),
    );
    expect(mock.commercial.sales.createOpportunity).not.toHaveBeenCalled();
  });

  it("does not steal an arbitrary opportunity when the contact has multiple open leads", async () => {
    const { db, mock } = database({ previousOwner: julioId, anotherOpenOpportunity: true });
    await routeInterAmericanAdvisor(db, { conversationId });
    expect(mock.commercial.sales.updateOpportunity).not.toHaveBeenCalled();
    expect(mock.commercial.sales.createOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `agent-route-${conversationId}`,
        opportunity: expect.objectContaining({ sourceConversationId: conversationId }),
      }),
    );
  });

  it("preserves a chat manually assigned outside the two-advisor pool", async () => {
    const { db, mock } = database({ existingThreadOwner: "019b0000-0000-7000-8000-000000000099" });
    expect(await routeInterAmericanAdvisor(db, { conversationId })).toBeUndefined();
    expect(mock.commercial.externalConversations.reserveAdvisor).not.toHaveBeenCalled();
    expect(mock.commercial.contacts.update).not.toHaveBeenCalled();
    expect(mock.commercial.sales.createOpportunity).not.toHaveBeenCalled();
    expect(mock.commercial.conversations.update).not.toHaveBeenCalled();
  });
});
