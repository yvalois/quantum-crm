import { describe, expect, it } from "vitest";

import {
  CreatePipelineSchema,
  OpportunityListQuerySchema,
  OpportunitySchema,
  UpdateOpportunitySchema,
} from "./sales.js";

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

  it("accepts initial stages while preserving empty-pipeline compatibility", () => {
    expect(
      CreatePipelineSchema.parse({
        name: "Ventas corporativas",
        description: "Proceso comercial B2B",
        stages: [
          { name: "Descubrimiento", description: "Necesidad inicial validada" },
          { name: "Propuesta", description: "Propuesta enviada" },
        ],
      }).stages,
    ).toHaveLength(2);
    expect(
      CreatePipelineSchema.parse({
        name: "Compatibilidad",
        description: "Sin etapas iniciales",
      }).stages,
    ).toBeUndefined();
    expect(
      CreatePipelineSchema.safeParse({
        name: "Duplicados",
        description: "No deben crearse",
        stages: [
          { name: "Calificación", description: "Primera etapa" },
          { name: " calificación ", description: "No permitida" },
        ],
      }).success,
    ).toBe(false);
    expect(
      CreatePipelineSchema.safeParse({
        name: "Sin etapas",
        description: "Una colección explícita debe contener una etapa",
        stages: [],
      }).success,
    ).toBe(false);
    expect(
      CreatePipelineSchema.safeParse({
        name: "Etapa vacía",
        description: "No debe aceptarse",
        stages: [{ name: " ", description: "Sin nombre" }],
      }).success,
    ).toBe(false);
    expect(
      CreatePipelineSchema.safeParse({
        name: "Demasiadas etapas",
        description: "Debe respetar el límite del flujo guiado",
        stages: Array.from({ length: 26 }, (_, index) => ({
          name: `Etapa ${index + 1}`,
          description: "Etapa inicial",
        })),
      }).success,
    ).toBe(false);
  });
});
