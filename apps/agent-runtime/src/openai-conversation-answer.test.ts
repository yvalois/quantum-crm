import { SecretValue } from "@quantum-crm/config";
import { describe, expect, it, vi } from "vitest";

import { createOpenAiConversationAnswer } from "./openai-conversation-answer.js";

const pendingHandoff = {
  requested: false,
  route: "normal",
  dataComplete: false,
  requirements: "pendientes",
  evidence: "",
  exceptionReason: "",
  questionPending: true,
  nonCompliancePending: false,
};

describe("OpenAI conversational answer", () => {
  it("includes only the bounded thread history and does not store the request", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.store).toBe(false);
      expect(body.instructions).toContain("# Rol");
      expect(body.instructions).toContain("# Requisitos exactos para renta particular sin conductor");
      expect(body.instructions).toContain("# Continuidad cuando cambia el idioma");
      expect(body.instructions).not.toContain("{{ $json.");
      expect(body.input).toEqual([
        { role: "user", content: "Necesito un traslado" },
        { role: "user", content: "¿Y mañana?" },
      ]);
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    mensaje: "¿Desde dónde saldrías?",
                    handoff: pendingHandoff,
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    });
    const answer = createOpenAiConversationAnswer({ apiKey: new SecretValue("test"), fetcher });
    expect(
      await answer({
        question: "¿Y mañana?",
        history: [{ role: "customer", text: "Necesito un traslado" }],
      }),
    ).toEqual({ answer: "¿Desde dónde saldrías?", handoffRequested: false });
  });

  it("continues a persistent chat without repeating an OpenAI greeting", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.input).toEqual([
        { role: "user", content: "Hola" },
        { role: "assistant", content: "Soy Alex. ¿Qué servicio necesitas?" },
        { role: "user", content: "Renta de vehículos" },
        { role: "assistant", content: "¿Qué tipo de vehículo te interesa?" },
        { role: "user", content: "¿Qué vehículos tienes?" },
      ]);
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    mensaje:
                      "¡Hola! Tenemos Sedán, SUV, Pick up, Microbús y Panel de carga. ¿Cuál te interesa?",
                    handoff: pendingHandoff,
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    });
    const answer = createOpenAiConversationAnswer({ apiKey: new SecretValue("test"), fetcher });
    expect(
      await answer({
        question: "¿Qué vehículos tienes?",
        history: [
          { role: "customer", text: "Hola" },
          { role: "agent", text: "Soy Alex. ¿Qué servicio necesitas?" },
          { role: "customer", text: "Renta de vehículos" },
          { role: "agent", text: "¿Qué tipo de vehículo te interesa?" },
        ],
      }),
    ).toEqual({
      answer: "Tenemos Sedán, SUV, Pick up, Microbús y Panel de carga. ¿Cuál te interesa?",
      handoffRequested: false,
    });
  });

  it("allows a brief reply greeting when the customer greets again", async () => {
    const answer = createOpenAiConversationAnswer({
      apiKey: new SecretValue("test"),
      fetcher: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify({
                        mensaje: "¡Hola! ¿Qué tipo de vehículo necesitas?",
                        handoff: pendingHandoff,
                      }),
                    },
                  ],
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    });
    expect(await answer({ question: "Hola, sigo interesado", history: [] })).toEqual({
      answer: "¡Hola! ¿Qué tipo de vehículo necesitas?",
      handoffRequested: false,
    });
  });

  it("keeps the original prompt's direct-request introduction", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.instructions).toContain("Primer mensaje con solicitud directa en español");
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    mensaje: "¡Hola! Soy Alex, asesor de InterAmerican Car Rental Guatemala. ¿Qué tipo de vehículo te interesa?",
                    handoff: pendingHandoff,
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    });
    const answer = createOpenAiConversationAnswer({ apiKey: new SecretValue("test"), fetcher });
    expect(
      await answer({ question: "Hola, quiero rentar un carro", history: [], firstTurn: true }),
    ).toEqual({ answer: "¡Hola! Soy Alex, asesor de InterAmerican Car Rental Guatemala. ¿Qué tipo de vehículo te interesa?", handoffRequested: false });
  });
});
