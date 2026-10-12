import { SecretValue } from "@quantum-crm/config";
import { describe, expect, it, vi } from "vitest";

import { createOpenAiRagAnswer } from "./openai-rag-answer.js";

const input = {
  catalog: "individual" as const,
  question: "¿Cuál es la cobertura?",
  history: [{ role: "customer" as const, text: "Busco alquiler individual" }],
  sources: [
    {
      id: "individual-p2-a",
      catalog: "individual" as const,
      page: 2,
      revision: "r1",
      text: "Cobertura básica incluida.",
    },
  ],
};

describe("OpenAI RAG answer adapter", () => {
  it("requests a bounded structured answer without storing the exchange", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gpt-5-mini");
      expect(body.store).toBe(false);
      expect(body.text.format.type).toBe("json_schema");
      expect(JSON.parse(body.input).sources[0].text).toBe("Cobertura básica incluida.");
      expect(JSON.parse(body.input).history[0].text).toBe("Busco alquiler individual");
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
                    answer: "Incluye cobertura básica.",
                    sourceIds: ["individual-p2-a"],
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    });
    const answer = createOpenAiRagAnswer({ apiKey: new SecretValue("test"), fetcher });
    expect(await answer(input)).toEqual({
      text: "Incluye cobertura básica.",
      sourceIds: ["individual-p2-a"],
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("fails closed on an incomplete response", async () => {
    const answer = createOpenAiRagAnswer({
      apiKey: new SecretValue("test"),
      fetcher: vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "incomplete", output: [] }), { status: 200 }),
      ),
    });
    await expect(answer(input)).rejects.toThrow();
  });
});
