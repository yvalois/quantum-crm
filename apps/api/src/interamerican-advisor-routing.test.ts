import type { CrmPostgresDatabase } from "@quantum-crm/database";
import { describe, expect, it, vi } from "vitest";

import { routeInterAmericanAdvisor } from "./interamerican-advisor-routing.js";

const contactId = "019b0000-0000-7000-8000-000000000001";
const carlosId = "019b0000-0000-7000-8000-000000000002";
const julioId = "019b0000-0000-7000-8000-000000000003";
const threadId = "ycloud:1234567890123456:50255556666";

function database(input: { previousOwner?: string; existingThreadOwner?: string | null } = {}) {
  const contact = {
    id: contactId,
    displayName: "Cliente de prueba",
    ownerMemberId: null,
    archivedAt: null,
    version: 1n,
  };
  const opportunity = input.previousOwner
    ? [
        {
          id: "019b0000-0000-7000-8000-000000000004",
          contactId,
          ownerMemberId: input.previousOwner,
          status: "OPEN",
          version: 1n,
          updatedAt: new Date("2026-10-14T18:00:00Z"),
        },
      ]
    : [];
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
        findThreadAssignment: vi.fn(async () =>
          input.existingThreadOwner === undefined
            ? null
            : { contactId, assigneeMemberId: input.existingThreadOwner },
        ),
        reserveAdvisor,
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
    const { db, mock } = database({ previousOwner: julioId });
    expect(await routeInterAmericanAdvisor(db, { contactId, externalThreadId: threadId })).toBe(
      julioId,
    );
    expect(mock.commercial.externalConversations.reserveAdvisor).toHaveBeenCalledWith(
      expect.objectContaining({ previousMemberId: julioId }),
    );
    expect(mock.commercial.contacts.update).toHaveBeenCalledWith(
      expect.objectContaining({ contact: expect.objectContaining({ ownerMemberId: julioId }) }),
    );
    expect(mock.commercial.sales.updateOpportunity).not.toHaveBeenCalled();
  });

  it("creates one opportunity in the imported qualified stage when none is open", async () => {
    const { db, mock } = database();
    expect(await routeInterAmericanAdvisor(db, { contactId, externalThreadId: threadId })).toBe(
      carlosId,
    );
    expect(mock.commercial.sales.createOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunity: expect.objectContaining({ ownerMemberId: carlosId, currency: "GTQ" }),
      }),
    );
  });

  it("preserves a chat manually assigned outside the two-advisor pool", async () => {
    const { db, mock } = database({ existingThreadOwner: "019b0000-0000-7000-8000-000000000099" });
    expect(
      await routeInterAmericanAdvisor(db, { contactId, externalThreadId: threadId }),
    ).toBeUndefined();
    expect(mock.commercial.externalConversations.reserveAdvisor).not.toHaveBeenCalled();
    expect(mock.commercial.contacts.update).not.toHaveBeenCalled();
    expect(mock.commercial.sales.createOpportunity).not.toHaveBeenCalled();
  });
});
