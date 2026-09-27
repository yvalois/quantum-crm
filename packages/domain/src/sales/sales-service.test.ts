import { describe, expect, it } from "vitest";

import { IamAuthorizationError } from "../iam/index.js";
import { SalesService, SalesValidationError, type SalesRepository } from "./index.js";

const actor = { memberId: "019b0000-0000-7000-8000-000000000007", scope: "OWN" as const };
const repository: SalesRepository = {
  listPipelines: async () => [],
  createPipeline: async (input) => input.pipeline,
  addStage: async (input) => input.stage,
  listOpportunities: async () => [],
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
});
