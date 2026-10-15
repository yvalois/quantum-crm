import { interAmericanOriginalPrompt } from "./interamerican-original-prompt.js";

/** Resolves only n8n transport expressions; the owner's prompt text is unchanged. */
export function renderInterAmericanPrompt(input: {
  readonly question: string;
  readonly language?: "es" | "en";
}): string {
  const language = input.language ?? "es";
  const replacements = new Map([
    ["{{ $json.mensaje_cliente_real || $json.mensaje_actual || $json.prompt_usuario_agent || '' }}", input.question],
    ["{{ $json.es_pauta ? 'sí' : 'no' }}", "no"],
    ["{{ $json.pauta_contexto || '' }}", ""],
    ["{{ $json.language_instruction || '' }}", language === "en" ? "Reply in English." : "Responde en español."],
    ["{{ $json.source_type || 'texto' }}", "texto"],
    ["{{ $json.image_summary || '' }}", ""],
    ["{{ $json.idioma_conversacion_activo || 'auto' }}", language],
    ["{{ $json.language_lock || 'VISIBLE_REPLY_SAME_AS_REAL_CUSTOMER' }}", "VISIBLE_REPLY_SAME_AS_REAL_CUSTOMER"],
  ]);
  return interAmericanOriginalPrompt.replace(/\{\{[^}]+\}\}/gu, (expression) => {
    const value = replacements.get(expression);
    if (value === undefined) throw new Error("Unknown n8n prompt expression");
    return value;
  });
}
