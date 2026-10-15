import type { SecretValue } from "@quantum-crm/config";
import type { AgentConversationContext } from "@quantum-crm/contracts";
import { z } from "zod";

import {
  confirmedAdvisorHandoff,
  handoffDecisionInstructions,
  handoffJsonSchema,
  handoffSchema,
} from "./interamerican-handoff.js";
import { renderInterAmericanPrompt } from "./interamerican-prompt-renderer.js";

const responseSchema = z.object({
  status: z.literal("completed"),
  output: z.array(
    z.object({
      type: z.string(),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
    }),
  ),
});

export interface ConversationAnswer {
  readonly answer: string;
  readonly handoffRequested: boolean;
}

/** Conversational turn without a selected catalog; never invents commercial facts. */
export function createOpenAiConversationAnswer(options: {
  readonly apiKey: SecretValue;
  readonly fetcher?: typeof fetch;
  readonly model?: string;
}): (input: {
  readonly question: string;
  readonly history: AgentConversationContext["messages"];
  readonly firstTurn?: boolean;
  readonly language?: "es" | "en";
}) => Promise<ConversationAnswer> {
  return async (input) => {
    const policy = renderInterAmericanPrompt(input);
    const response = await (options.fetcher ?? fetch)("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey.expose()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: options.model ?? "gpt-5-mini",
        store: false,
        max_output_tokens: 1600,
        instructions: `${policy}\n\n${handoffDecisionInstructions.replace("answer", "mensaje")}`,
        input: [
          ...input.history.map((message) => ({
            role: message.role === "customer" ? "user" : "assistant",
            content: message.text,
          })),
          { role: "user", content: input.question },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "conversation_answer",
            strict: true,
            schema: {
              type: "object",
              properties: { mensaje: { type: "string" }, handoff: handoffJsonSchema },
              required: ["mensaje", "handoff"],
              additionalProperties: false,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("OpenAI conversation answer request failed");
    const payload = responseSchema.parse(await response.json());
    const text = payload.output
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .filter((content) => content.type === "output_text")
      .map((content) => content.text ?? "")
      .join("");
    const parsed = z
      .object({ mensaje: z.string().trim().min(1).max(4_000), handoff: handoffSchema })
      .parse(JSON.parse(text));
    const answer = parsed.mensaje;
    const customerGreeted =
      /^(?:[¡!¿?\s]*)(?:hola|buen(?:os|as)(?:\s+d[ií]as|\s+tardes|\s+noches)?|hi|hello)\b/iu.test(
        input.question,
      );
    const continuation =
      customerGreeted && !input.firstTurn
        ? answer
        : answer
            .replace(/^\s*[¡!]?hola(?:\s+de nuevo)?[!¡.,:\s-]*/iu, "")
            .replace(/^gracias por (?:escribir(?:nos)?|preguntar)[.!?,:\s-]*/iu, "")
            .trim();
    if (!continuation) throw new Error("Conversation answer contained only a greeting");
    return {
      answer: continuation,
      handoffRequested: confirmedAdvisorHandoff(parsed.handoff, input.history, input.question),
    };
  };
}
