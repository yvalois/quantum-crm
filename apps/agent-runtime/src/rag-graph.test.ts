import { describe, expect, it, vi } from "vitest";

import { askCatalog, type RagGateway, type RagSource } from "./rag-graph.js";

const source: RagSource = {
  id: "individual-7-a",
  catalog: "individual",
  page: 7,
  text: "Condición de prueba del catálogo individual.",
  revision: "rev-1",
};

function gateway(sources: readonly RagSource[]): RagGateway {
  return {
    search: vi.fn().mockResolvedValue(sources),
    answer: vi.fn().mockResolvedValue({ text: "Respuesta respaldada.", sourceIds: [source.id] }),
  };
}

describe("RAG del primer agente", () => {
  it("restringe la consulta al catálogo elegido y expone la página citada", async () => {
    const adapter = gateway([source]);
    const result = await askCatalog(adapter, {
      catalog: "individual",
      question: "¿Cuál es la condición?",
    });
    expect(adapter.search).toHaveBeenCalledWith({
      catalog: "individual",
      question: "¿Cuál es la condición?",
      limit: 8,
    });
    expect(result).toEqual({
      answer: "Respuesta respaldada.",
      sources: [{ id: source.id, catalog: "individual", page: 7, revision: "rev-1" }],
      grounded: true,
    });
  });

  it("se abstiene cuando no hay evidencia sin invocar el modelo", async () => {
    const adapter = gateway([]);
    const result = await askCatalog(adapter, {
      catalog: "corporativo",
      question: "¿Cuánto cuesta?",
    });
    expect(result.grounded).toBe(false);
    expect(result.sources).toEqual([]);
    expect(adapter.answer).not.toHaveBeenCalled();
  });

  it("rechaza resultados mezclados entre catálogos", async () => {
    await expect(
      askCatalog(gateway([source]), {
        catalog: "corporativo",
        question: "¿Qué incluye?",
      }),
    ).rejects.toThrow("another catalog");
  });

  it("no muestra respuestas sin citas verificables", async () => {
    const adapter: RagGateway = {
      search: vi.fn().mockResolvedValue([source]),
      answer: vi.fn().mockResolvedValue({ text: "No comprobado", sourceIds: ["otro"] }),
    };
    const result = await askCatalog(adapter, {
      catalog: "individual",
      question: "¿Qué incluye?",
    });
    expect(result.grounded).toBe(false);
    expect(result.answer).toContain("No encontré información suficiente");
  });
});
