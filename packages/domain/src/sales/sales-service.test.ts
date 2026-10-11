import { describe, expect, it, vi } from "vitest";

import { IamAuthorizationError } from "../iam/index.js";
import {
  SalesNotFoundError,
  SalesService,
  SalesValidationError,
  SalesVersionConflictError,
  type Opportunity,
  type SalesRepository,
} from "./index.js";

const actor = { memberId: "019b0000-0000-7000-8000-000000000007", scope: "OWN" as const };
const repository: SalesRepository = {
  listPipelines: async () => [],
  createPipeline: async (input) => input.pipeline,
  addStage: async (input) => input.stage,
  listOpportunities: async () => [],
  listOpportunityHistory: async () => [],
  findOpportunity: async () => null,
  findOpportunityCommandResult: async () => null,
  findStage: async () => ({
    id: "019b0000-0000-7000-8000-000000000008",
    pipelineId: "019b0000-0000-7000-8000-000000000009",
    name: "Qualified",
    description: "Qualified",
    position: 0,
  }),
  createOpportunity: async (input) => input.opportunity,
  moveOpportunity: async () => null,
  updateOpportunity: async (input) => input.opportunity,
};

const opportunity: Opportunity = {
  id: "019b0000-0000-7000-8000-000000000010",
  ownerMemberId: actor.memberId,
  contactId: "019b0000-0000-7000-8000-000000000011",
  pipelineId: "019b0000-0000-7000-8000-000000000009",
  stageId: "019b0000-0000-7000-8000-000000000008",
  title: "Synthetic deal",
  amountMinor: 10000n,
  currency: "COP",
  status: "OPEN",
  closeReason: null,
  closedAt: null,
  version: 2n,
  createdAt: new Date("2026-10-11T12:00:00.000Z"),
  updatedAt: new Date("2026-10-11T12:00:01.000Z"),
};

describe("sales service", () => {
  it("loads an opportunity through the authorized resource scope", async () => {
    const findOpportunity = vi.fn(async () => opportunity);
    const service = new SalesService(
      { ...repository, findOpportunity },
      { existsFor: async () => true },
    );
    await expect(
      service.getOpportunity({ actor, permissions: [], opportunityId: opportunity.id }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
    expect(findOpportunity).not.toHaveBeenCalled();
    await expect(
      service.getOpportunity({
        actor,
        permissions: ["crm:sales:read"],
        opportunityId: opportunity.id,
      }),
    ).resolves.toBe(opportunity);
    expect(findOpportunity).toHaveBeenCalledWith(actor, opportunity.id);
    const hiddenService = new SalesService(repository, { existsFor: async () => true });
    await expect(
      hiddenService.getOpportunity({
        actor,
        permissions: ["crm:sales:read"],
        opportunityId: opportunity.id,
      }),
    ).rejects.toBeInstanceOf(SalesNotFoundError);
  });

  it.each(["move", "update"] as const)(
    "returns a committed %s replay before rejecting the original version",
    async (command) => {
      const findOpportunityCommandResult = vi.fn(async () => opportunity);
      const moveOpportunity = vi.fn(async () => null);
      const updateOpportunity = vi.fn(async () => null);
      const service = new SalesService(
        {
          ...repository,
          findOpportunity: async () => opportunity,
          findOpportunityCommandResult,
          moveOpportunity,
          updateOpportunity,
        },
        { existsFor: async () => true },
      );
      const input = {
        actor,
        opportunityId: opportunity.id,
        expectedVersion: 1n,
        idempotencyKey: "opportunity-retry-0001",
        payloadHash: "d".repeat(64),
      };
      const result =
        command === "move"
          ? await service.moveOpportunity({
              ...input,
              permissions: ["crm:sales:move"],
              stageId: opportunity.stageId,
            })
          : await service.updateOpportunity({
              ...input,
              permissions: ["crm:sales:update"],
              title: opportunity.title,
            });
      expect(result).toEqual(opportunity);
      expect(result.ownerMemberId).toBe(actor.memberId);
      expect(result.version).toBe(opportunity.version);
      expect(result.stageId).toBe(opportunity.stageId);
      expect(result).not.toHaveProperty("sourceParticipantReferences");
      expect(findOpportunityCommandResult).toHaveBeenCalledWith({
        actor,
        id: opportunity.id,
        command: `sales.opportunity.${command}`,
        idempotencyKey: input.idempotencyKey,
        payloadHash: input.payloadHash,
      });
      expect(moveOpportunity).not.toHaveBeenCalled();
      expect(updateOpportunity).not.toHaveBeenCalled();
    },
  );

  it("rejects stale new commands and never replays an unauthorized or hidden resource", async () => {
    const replay = vi.fn(async () => null);
    const service = new SalesService(
      {
        ...repository,
        findOpportunity: async () => opportunity,
        findOpportunityCommandResult: replay,
      },
      { existsFor: async () => true },
    );
    const input = {
      actor,
      opportunityId: opportunity.id,
      stageId: opportunity.stageId,
      expectedVersion: 1n,
      idempotencyKey: "opportunity-new-key-0001",
      payloadHash: "e".repeat(64),
    };
    await expect(service.moveOpportunity({ ...input, permissions: [] })).rejects.toBeInstanceOf(
      IamAuthorizationError,
    );
    expect(replay).not.toHaveBeenCalled();
    const hiddenService = new SalesService(
      { ...repository, findOpportunityCommandResult: replay },
      { existsFor: async () => true },
    );
    await expect(
      hiddenService.moveOpportunity({ ...input, permissions: ["crm:sales:move"] }),
    ).rejects.toBeInstanceOf(SalesNotFoundError);
    expect(replay).not.toHaveBeenCalled();
    await expect(
      service.moveOpportunity({ ...input, permissions: ["crm:sales:move"] }),
    ).rejects.toBeInstanceOf(SalesVersionConflictError);
    await expect(
      service.updateOpportunity({
        ...input,
        permissions: ["crm:sales:update"],
        title: "New title",
      }),
    ).rejects.toBeInstanceOf(SalesVersionConflictError);
  });

  it("rejects a stage from a pipeline other than the requested pipeline", async () => {
    const service = new SalesService(repository, { existsFor: async () => true });
    await expect(
      service.createOpportunity({
        actor,
        permissions: ["crm:sales:create"],
        contactId: "019b0000-0000-7000-8000-000000000010",
        pipelineId: "019b0000-0000-7000-8000-000000000011",
        stageId: "019b0000-0000-7000-8000-000000000008",
        title: "Deal",
        amountMinor: 0n,
        currency: "COP",
        idempotencyKey: "opportunity-0001",
        payloadHash: "a".repeat(64),
      }),
    ).rejects.toBeInstanceOf(SalesValidationError);
  });
  it("requires an active owner and a reason for a lost opportunity", async () => {
    const current = {
      id: "019b0000-0000-7000-8000-000000000010",
      ownerMemberId: actor.memberId,
      contactId: "019b0000-0000-7000-8000-000000000011",
      pipelineId: "019b0000-0000-7000-8000-000000000012",
      stageId: "019b0000-0000-7000-8000-000000000013",
      title: "Deal",
      amountMinor: 10000n,
      currency: "COP",
      status: "OPEN" as const,
      closeReason: null,
      closedAt: null,
      version: 1n,
      createdAt: new Date("2026-09-29T12:00:00.000Z"),
      updatedAt: new Date("2026-09-29T12:00:00.000Z"),
    };
    const service = new SalesService(
      { ...repository, findOpportunity: async () => current },
      { existsFor: async () => true },
      { isActive: async () => false },
    );
    await expect(
      service.updateOpportunity({
        actor,
        permissions: ["crm:sales:update"],
        opportunityId: current.id,
        expectedVersion: 1n,
        ownerMemberId: "019b0000-0000-7000-8000-000000000099",
        idempotencyKey: "opportunity-update-0001",
        payloadHash: "b".repeat(64),
      }),
    ).rejects.toBeInstanceOf(SalesValidationError);
    await expect(
      service.updateOpportunity({
        actor,
        permissions: ["crm:sales:update"],
        opportunityId: current.id,
        expectedVersion: 1n,
        status: "LOST",
        closeReason: null,
        idempotencyKey: "opportunity-update-0002",
        payloadHash: "c".repeat(64),
      }),
    ).rejects.toBeInstanceOf(SalesValidationError);
  });
  it("keeps configuration denied to an advisor and sends move idempotency to the owner repository", async () => {
    const moveOpportunity = async () => null;
    const service = new SalesService(
      { ...repository, moveOpportunity },
      { existsFor: async () => true },
    );
    expect(() =>
      service.createPipeline({
        actor,
        permissions: ["crm:sales:create"],
        name: "Pipeline",
        description: "x",
        idempotencyKey: "pipeline-create-0001",
        payloadHash: "a".repeat(64),
      }),
    ).toThrow(IamAuthorizationError);
    await expect(
      service.moveOpportunity({
        actor,
        permissions: [],
        opportunityId: "019b0000-0000-7000-8000-000000000010",
        stageId: "019b0000-0000-7000-8000-000000000008",
        expectedVersion: 1n,
        idempotencyKey: "opportunity-move-0001",
        payloadHash: "a".repeat(64),
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
  });

  it("creates all initial stages in their supplied order", async () => {
    let persisted: Parameters<SalesRepository["createPipeline"]>[0] | undefined;
    const service = new SalesService(
      {
        ...repository,
        createPipeline: async (input) => {
          persisted = input;
          return input.pipeline;
        },
      },
      { existsFor: async () => true },
    );

    const created = await service.createPipeline({
      actor,
      permissions: ["crm:sales:configure"],
      name: "Ventas",
      description: "Proceso principal",
      stages: [
        { name: "Prospección", description: "Contacto inicial" },
        { name: "Propuesta", description: "Oferta enviada" },
      ],
      idempotencyKey: "pipeline-stages-0001",
      payloadHash: "a".repeat(64),
    });

    expect(created.stages).toEqual([
      expect.objectContaining({ name: "Prospección", position: 0 }),
      expect.objectContaining({ name: "Propuesta", position: 1 }),
    ]);
    expect(created.stages[0]?.pipelineId).toBe(created.id);
    expect(created.stages[1]?.pipelineId).toBe(created.id);
    expect(persisted?.pipeline).toBe(created);
  });

  it("rejects duplicate initial stage names before persistence", () => {
    const createPipeline = async (_input: Parameters<SalesRepository["createPipeline"]>[0]) => {
      throw new Error("must not persist");
    };
    const service = new SalesService(
      { ...repository, createPipeline },
      { existsFor: async () => true },
    );

    expect(() =>
      service.createPipeline({
        actor,
        permissions: ["crm:sales:configure"],
        name: "Ventas",
        description: "Proceso principal",
        stages: [
          { name: "Calificación", description: "Primera etapa" },
          { name: " calificación ", description: "No debe persistir" },
        ],
        idempotencyKey: "pipeline-duplicates-0001",
        payloadHash: "a".repeat(64),
      }),
    ).toThrow(SalesValidationError);
  });
});
