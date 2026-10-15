import type { AgentConversationContext } from "@quantum-crm/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  answerAgentTurn,
  answerAgentTurnSafely,
  temporarilyUnavailableAnswer,
} from "./agent-response.js";
import { initialGreeting } from "./interamerican-greeting.js";

const threadId = "019b0000-0000-7000-8000-000000000001";
const source = {
  id: "019b0000-0000-7000-8000-000000000002",
  catalog: "individual" as const,
  page: 2,
  revision: "rev-1",
  text: "Renta de vehículos individuales.",
};

function gateway(messages: AgentConversationContext["messages"]) {
  return {
    context: vi.fn(async () => ({ threadId, messages })),
    search: vi.fn(async () => [source]),
    answerCatalog: vi.fn(async () => ({
      text: "Tenemos opciones de renta individual.",
      sourceIds: [source.id],
    })),
    answerConversation: vi.fn(async () => ({
      answer: "¿En qué fecha necesitas el vehículo?",
      handoffRequested: false,
    })),
  };
}

describe("InterAmerican agent memory", () => {
  it("greets the first turn and remembers the selected catalog on a later question", async () => {
    const first = gateway([]);
    expect((await answerAgentTurn({ question: "Hola", firstTurn: true }, first)).answer).toBe(
      initialGreeting,
    );
    expect(first.answerConversation).not.toHaveBeenCalled();

    const later = gateway([
      { role: "customer", text: "Hola" },
      { role: "agent", text: initialGreeting },
      { role: "customer", text: "Individual" },
      { role: "agent", text: "Tenemos opciones de renta individual." },
    ]);
    const result = await answerAgentTurn({ question: "¿Qué incluye?", firstTurn: false }, later);
    expect(later.search).toHaveBeenCalledWith({
      catalog: "individual",
      question: "¿Qué incluye?",
      limit: 8,
    });
    expect(later.answerCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        catalog: "individual",
        history: expect.arrayContaining([{ role: "customer", text: "Individual" }]),
      }),
    );
    expect(result.sourceIds).toEqual([source.id]);
  });

  it("answers a direct first request instead of showing the general menu", async () => {
    const current = gateway([]);
    const result = await answerAgentTurn(
      { question: "Quiero rentar un vehículo", firstTurn: true },
      current,
    );
    expect(current.answerConversation).toHaveBeenCalledWith({
      question: "Quiero rentar un vehículo",
      history: [],
      firstTurn: true,
      language: "es",
    });
    expect(result.answer).toContain("Soy Alex");
    expect(result.answer).toContain(
      "Hola 👋 gracias por escribir a InterAmerican Car Rental Guatemala.",
    );
    expect(result.answer).not.toBe(initialGreeting);
  });

  it("uses the rental flow rather than RAG when a company asks for a vehicle", async () => {
    const current = gateway([]);
    await answerAgentTurn(
      { question: "Soy una empresa y quiero un SUV por 3 días", firstTurn: true },
      current,
    );
    expect(current.answerConversation).toHaveBeenCalledOnce();
    expect(current.search).not.toHaveBeenCalled();
  });

  it("does not duplicate an introduction or the exact Renting exception", async () => {
    const introduced = gateway([]);
    introduced.answerConversation.mockResolvedValueOnce({
      answer:
        "Hola 👋 Soy Alex, asesor de InterAmerican Car Rental Guatemala. ¿Qué tipo de vehículo buscas?",
      handoffRequested: false,
    });
    const first = await answerAgentTurn(
      { question: "Quiero un carro", firstTurn: true },
      introduced,
    );
    expect(first.answer.match(/Soy Alex/gu)).toHaveLength(1);

    const renting = gateway([]);
    renting.answerConversation.mockResolvedValueOnce({
      answer:
        "Hola 👋 ¡Gracias por escribir a InterAmerican Car Rental Guatemala! Con gusto le comparto información sobre nuestro servicio de Renting 🚗",
      handoffRequested: false,
    });
    const second = await answerAgentTurn({ question: "Quiero Renting", firstTurn: true }, renting);
    expect(second.answer).not.toContain("Soy Alex");
  });

  it("starts without prior memory after reset while leaving the CRM transcript untouched", async () => {
    const afterReset = gateway([]);
    const result = await answerAgentTurn({ question: "Hola", firstTurn: true }, afterReset);
    expect(result.answer).toBe(initialGreeting);
    expect(afterReset.context).toHaveBeenCalledOnce();
    expect(afterReset.answerCatalog).not.toHaveBeenCalled();
  });

  it("uses Alex's original greeting for a transcribed voice greeting after reset", async () => {
    const afterReset = gateway([]);
    const result = await answerAgentTurn({ question: "Buenos días.", firstTurn: true }, afterReset);
    expect(result.answer).toBe(initialGreeting);
    expect(afterReset.answerConversation).not.toHaveBeenCalled();
  });

  it("uses only the context returned for this execution", async () => {
    const current = gateway([{ role: "customer", text: "Necesito un traslado" }]);
    await answerAgentTurn({ question: "¿Puede ser mañana?", firstTurn: false }, current);
    expect(current.answerConversation).toHaveBeenCalledWith({
      question: "¿Puede ser mañana?",
      history: [{ role: "customer", text: "Necesito un traslado" }],
      firstTurn: false,
      language: "es",
    });
    expect(current.search).not.toHaveBeenCalled();
  });

  it("answers short replies using conversation memory instead of rejecting them", async () => {
    const current = gateway([{ role: "customer", text: "Busco un carro individual" }]);
    await answerAgentTurn({ question: "Sí", firstTurn: false }, current);
    expect(current.answerConversation).toHaveBeenCalledWith({
      question: "Sí",
      history: [{ role: "customer", text: "Busco un carro individual" }],
      firstTurn: false,
      language: "es",
    });
    expect(current.search).not.toHaveBeenCalled();
  });

  it("keeps a requirement confirmation in the conversational handoff path", async () => {
    const current = gateway([
      { role: "customer", text: "Quiero rentar un carro individual" },
      { role: "agent", text: "¿Confirmas que cumples los requisitos?" },
    ]);
    await answerAgentTurn(
      { question: "Sí, confirmo que cumplo los requisitos", firstTurn: false },
      current,
    );
    expect(current.answerConversation).toHaveBeenCalledOnce();
    expect(current.search).not.toHaveBeenCalled();
  });

  it("does not introduce itself again if earlier messages exist despite a stale first-turn flag", async () => {
    const current = gateway([{ role: "customer", text: "Busco un carro individual" }]);
    const result = await answerAgentTurn({ question: "¿Qué incluye?", firstTurn: true }, current);
    expect(result.answer).toBe("Tenemos opciones de renta individual.");
    expect(result.answer).not.toContain("Soy Alex");
  });

  it("answers safely instead of becoming silent when a dependency fails", async () => {
    const broken = gateway([]);
    broken.context.mockRejectedValueOnce(new Error("MCP unavailable"));
    const onFailure = vi.fn();
    const result = await answerAgentTurnSafely(
      { question: "Individual", firstTurn: false },
      broken,
      onFailure,
    );
    expect(result).toEqual({
      answer: temporarilyUnavailableAnswer,
      sourceIds: [],
      grounded: false,
    });
    expect(onFailure).toHaveBeenCalledOnce();
  });
});
