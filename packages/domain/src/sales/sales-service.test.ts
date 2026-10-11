import { describe, expect, it } from "vitest";

import { IamAuthorizationError } from "../iam/index.js";
import { SalesService, SalesValidationError, type SalesRepository } from "./index.js";

const actor = { memberId: "019b0000-0000-7000-8000-000000000007", scope: "OWN" as const };
const repository: SalesRepository = {
  listPipelines: async () => [],
  createPipeline: async (input) => input.pipeline,
  addStage: async (input) => input.stage,
  listOpportunities: async () => [],
  listOpportunityHistory: async () => [],
  findOpportunity: async () => null,
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

describe("sales service", () => {
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
