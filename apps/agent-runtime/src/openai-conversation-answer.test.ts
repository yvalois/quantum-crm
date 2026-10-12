import { SecretValue } from "@quantum-crm/config";
import { describe, expect, it, vi } from "vitest";

import { createOpenAiConversationAnswer } from "./openai-conversation-answer.js";

describe("OpenAI conversational answer", () => {
  it("includes only the bounded thread history and does not store the request", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.store).toBe(false);
      expect(JSON.parse(body.input)).toEqual({
        question: "¿Y mañana?",
        history: [{ role: "customer", text: "Necesito un traslado" }],
      });
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
});
