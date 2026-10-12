import { SecretValue } from "@quantum-crm/config";
import { describe, expect, it, vi } from "vitest";

import { createOpenAiConversationAnswer } from "./openai-conversation-answer.js";

describe("OpenAI conversational answer", () => {
  it("includes only the bounded thread history and does not store the request", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.store).toBe(false);
      expect(body.instructions).toContain("Continúa la conversación usando el historial");
      expect(body.instructions).toContain("particular/empresa");
      expect(body.instructions).toContain("🚗 Sedán");
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
                { type: "output_text", text: JSON.stringify({ answer: "¿Desde dónde saldrías?" }) },
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
    ).toBe("¿Desde dónde saldrías?");
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
                    answer:
                      "¡Hola! Tenemos Sedán, SUV, Pick up, Microbús y Panel de carga. ¿Cuál te interesa?",
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
    ).toBe("Tenemos Sedán, SUV, Pick up, Microbús y Panel de carga. ¿Cuál te interesa?");
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
                      text: JSON.stringify({ answer: "¡Hola! ¿Qué tipo de vehículo necesitas?" }),
                    },
                  ],
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    });
    expect(await answer({ question: "Hola, sigo interesado", history: [] })).toBe(
      "¡Hola! ¿Qué tipo de vehículo necesitas?",
    );
  });
});
