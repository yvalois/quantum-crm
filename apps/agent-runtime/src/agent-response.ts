import type { AgentConversationContext } from "@quantum-crm/contracts";

import {
  briefIntroduction,
  briefIntroductionEnglish,
  initialGreeting,
  initialGreetingEnglish,
} from "./interamerican-greeting.js";
import {
  resolveConversationLanguage,
  type ConversationLanguage,
} from "./interamerican-language.js";
import { askCatalog, type CatalogKind, type RagGateway } from "./rag-graph.js";
import type { ConversationAnswer } from "./openai-conversation-answer.js";

export const temporarilyUnavailableAnswer =
  "Ahora mismo no pude consultar la información con seguridad. Por favor, intenta de nuevo en unos minutos.";

export interface AgentResponse {
  readonly answer: string;
  readonly sourceIds: readonly string[];
  readonly grounded: boolean;
  readonly handoffRequested?: boolean;
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
  if (/^(?:s[ií]|confirmo|cumplo|acepto|de acuerdo)\b/iu.test(question.trim())) return false;
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
      readonly language?: ConversationLanguage;
    }) => Promise<ConversationAnswer>;
  },
): Promise<AgentResponse> {
  const context = await gateway.context();
  const language = resolveConversationLanguage(input.question, context.messages);
  const introduction = language === "en" ? briefIntroductionEnglish : briefIntroduction;
  const catalog = selectedCatalog(input.question, context.messages);
  const firstTurn = input.firstTurn && context.messages.length === 0;
  if (!catalog && firstTurn && asksOnlyForGeneralHelp(input.question))
    return {
      answer: language === "en" ? initialGreetingEnglish : initialGreeting,
      sourceIds: [],
      grounded: false,
    };
  if (!catalog || !asksForCatalogFact(input.question) || input.question.trim().length < 3) {
    const turn = await gateway.answerConversation({
      question: input.question,
      history: context.messages,
      firstTurn,
      language,
    });
    return {
      answer: `${firstTurn ? introduction : ""}${turn.answer}`,
      sourceIds: [],
      grounded: false,
      ...(turn.handoffRequested ? { handoffRequested: true } : {}),
    };
  }
  const result = await askCatalog(
    { search: gateway.search, answer: gateway.answerCatalog },
    { catalog, question: input.question, history: context.messages, language },
  );
  return {
    answer: firstTurn ? `${introduction}${result.answer}` : result.answer,
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
