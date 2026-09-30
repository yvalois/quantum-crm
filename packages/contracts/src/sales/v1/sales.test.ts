import { describe, expect, it } from "vitest";

import { OpportunityListQuerySchema, OpportunitySchema, UpdateOpportunitySchema } from "./sales.js";

describe("sales contracts", () => {
  it("accepts a complete opportunity and bounded board filters", () => {
    expect(
      OpportunitySchema.parse({
        id: "01995f7e-7b52-7000-8000-000000000121",
        ownerMemberId: "01995f7e-7b52-7000-8000-000000000102",
        contactId: "01995f7e-7b52-7000-8000-000000000122",
        pipelineId: "01995f7e-7b52-7000-8000-000000000123",
        stageId: "01995f7e-7b52-7000-8000-000000000124",
        title: "Expansion",
        amountMinor: "250000000",
        currency: "COP",
        status: "OPEN",
        closeReason: null,
        closedAt: null,
        version: "1",
        createdAt: "2026-09-29T15:00:00.000Z",
        updatedAt: "2026-09-29T15:00:00.000Z",
      }).status,
    ).toBe("OPEN");
    expect(
      OpportunityListQuerySchema.parse({
        status: "OPEN",
        label: "Prioritario",
        createdFrom: "2026-09-01T00:00:00.000Z",
        createdTo: "2026-09-30T23:59:59.999Z",
      }).label,
    ).toBe("Prioritario");
  });

  it("rejects empty updates and inverted date ranges", () => {
    expect(UpdateOpportunitySchema.safeParse({}).success).toBe(false);
    expect(
      OpportunityListQuerySchema.safeParse({
        createdFrom: "2026-10-01T00:00:00.000Z",
        createdTo: "2026-09-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
