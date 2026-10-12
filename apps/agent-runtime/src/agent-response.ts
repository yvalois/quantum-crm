import type { AgentConversationContext } from "@quantum-crm/contracts";

import { briefIntroduction, initialGreeting } from "./interamerican-greeting.js";
import { askCatalog, type CatalogKind, type RagGateway } from "./rag-graph.js";

export const temporarilyUnavailableAnswer =
  "Ahora mismo no pude consultar la información con seguridad. Por favor, intenta de nuevo en unos minutos.";

export interface AgentResponse {
  readonly answer: string;
  readonly sourceIds: readonly string[];
  readonly grounded: boolean;
}

function catalogFor(text: string): CatalogKind | null {
  const corporate = /\b(corporativ[oa]|empresa|empresarial|flota|convenio)\b/iu.test(text);
  const individual = /\b(individual|personal|particular|familia|turismo)\b/iu.test(text);
  if (corporate === individual) return null;
  return corporate ? "corporativo" : "individual";
}

function selectedCatalog(
  question: string,
  history: AgentConversationContext["messages"],
): CatalogKind | null {
  const current = catalogFor(question);
  if (current) return current;
  for (let index = history.length - 1; index >= 0; index--) {
    const previous = history[index]!;
    if (previous.role !== "customer") continue;
    const catalog = catalogFor(previous.text);
    if (catalog) return catalog;
  }
  return null;
}

function asksOnlyForGeneralHelp(question: string): boolean {
  return /^(?:(?:hola|buen(?:os|as)(?:\s+d[ií]as|\s+tardes|\s+noches)?|hi|hello)[!¡.,?¿\s]*)?(?:(?:quiero|necesito|me gustar[ií]a)\s+(?:m[aá]s\s+)?informaci[oó]n[!¡.,?¿\s]*)?$/iu.test(
    question.trim(),
  );
}

function asksForCatalogFact(question: string): boolean {
  return /\b(precio|tarifa|cobertura|seguro|requisito|dep[oó]sito|deducible|kilometraje|combustible|pago|anticipo|incluye|incluido|horario|restricci[oó]n|condici[oó]n)\b/iu.test(
    question,
  );
}

/** The CRM transcript is the durable thread memory; the reset marker bounds it in MCP. */
export async function answerAgentTurn(
  input: { readonly question: string; readonly firstTurn: boolean },
  gateway: {
    readonly context: () => Promise<AgentConversationContext>;
    readonly search: RagGateway["search"];
    readonly answerCatalog: RagGateway["answer"];
    readonly answerConversation: (input: {
      readonly question: string;
      readonly history: AgentConversationContext["messages"];
      readonly firstTurn: boolean;
    }) => Promise<string>;
  },
): Promise<AgentResponse> {
  const context = await gateway.context();
  const catalog = selectedCatalog(input.question, context.messages);
  const firstTurn = input.firstTurn && context.messages.length === 0;
  if (!catalog && firstTurn && asksOnlyForGeneralHelp(input.question))
    return { answer: initialGreeting, sourceIds: [], grounded: false };
  if (!catalog || !asksForCatalogFact(input.question) || input.question.trim().length < 3)
    return {
      answer: `${firstTurn ? briefIntroduction : ""}${await gateway.answerConversation({
        question: input.question,
        history: context.messages,
        firstTurn,
      })}`,
      sourceIds: [],
      grounded: false,
    };
  const result = await askCatalog(
    { search: gateway.search, answer: gateway.answerCatalog },
    { catalog, question: input.question, history: context.messages },
  );
  return {
    answer: firstTurn ? `${briefIntroduction}${result.answer}` : result.answer,
    sourceIds: result.sources.map((source) => source.id),
    grounded: result.grounded,
  };
}

/** A dependency failure must never leave a customer message silently unanswered. */
export async function answerAgentTurnSafely(
  input: Parameters<typeof answerAgentTurn>[0],
  gateway: Parameters<typeof answerAgentTurn>[1],
  onFailure?: (error: unknown) => void,
): Promise<AgentResponse> {
  try {
    return await answerAgentTurn(input, gateway);
  } catch (error) {
    onFailure?.(error);
    return { answer: temporarilyUnavailableAnswer, sourceIds: [], grounded: false };
  }
}
