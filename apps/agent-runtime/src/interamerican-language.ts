import type { AgentConversationContext } from "@quantum-crm/contracts";

export type ConversationLanguage = "es" | "en";

function realCustomerText(value: string): string {
  const image = /^Image caption: (.*?); internal visual description:/su.exec(value);
  return image ? image[1]!.trim() : value;
}

function clearLanguage(value: string): ConversationLanguage | null {
  const text = realCustomerText(value).toLowerCase();
  if (/\b(?:speak|reply|respond) (?:in )?english\b|\bin english\b|\bhabla(?:me)? en ingl[eé]s\b/iu.test(text)) return "en";
  if (/\b(?:speak|reply|respond) (?:in )?spanish\b|\ben spanish\b|\bhabla(?:me)? en espa[nñ]ol\b/iu.test(text)) return "es";
  if (/\b(?:hi|hello|thanks|thank you)\b/iu.test(text)) return "en";
  if (/\b(?:hola|gracias|buenos d[ií]as|buenas tardes)\b/iu.test(text)) return "es";
  const english = text.match(/\b(?:i|my|need|want|could|please|tomorrow|days|car|rental|there|what|how|much|have|available|for|from|until)\b/gu)?.length ?? 0;
  const spanish = text.match(/\b(?:quiero|necesito|ma[nñ]ana|d[ií]as|carro|auto|renta|hay|cu[aá]l|c[oó]mo|tienen|puedo|para|una|por|desde|hasta|disponible)\b/gu)?.length ?? 0;
  if (english >= 2 && english > spanish) return "en";
  if (spanish >= 2 && spanish > english) return "es";
  return null;
}

/** Only real customer language can change the thread; image analysis and catalog text cannot. */
export function resolveConversationLanguage(question: string, history: AgentConversationContext["messages"]): ConversationLanguage {
  const current = clearLanguage(question);
  if (current) return current;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role !== "customer") continue;
    const previous = clearLanguage(history[i]!.text);
    if (previous) return previous;
  }
  return "es";
}
