import type { AgentConversationContext } from "@quantum-crm/contracts";
import { z } from "zod";

export const handoffSchema = z.object({
  requested: z.boolean(),
  route: z.enum(["normal", "corporativo", "cliente_sin_clasificar", "traslado", "fuera_horario"]),
  dataComplete: z.boolean(),
  requirements: z.enum(["no_explicados", "pendientes", "confirmados", "incumplidos", "no_aplica"]),
  evidence: z.string().max(500),
  exceptionReason: z.string().max(500),
  questionPending: z.boolean(),
  nonCompliancePending: z.boolean(),
});

export const handoffJsonSchema = {
  type: "object",
  properties: {
    requested: { type: "boolean" },
    route: {
      type: "string",
      enum: ["normal", "corporativo", "cliente_sin_clasificar", "traslado", "fuera_horario"],
    },
    dataComplete: { type: "boolean" },
    requirements: {
      type: "string",
      enum: ["no_explicados", "pendientes", "confirmados", "incumplidos", "no_aplica"],
    },
    evidence: { type: "string" },
    exceptionReason: { type: "string" },
    questionPending: { type: "boolean" },
    nonCompliancePending: { type: "boolean" },
  },
  required: [
    "requested",
    "route",
    "dataComplete",
    "requirements",
    "evidence",
    "exceptionReason",
    "questionPending",
    "nonCompliancePending",
  ],
  additionalProperties: false,
} as const;

export const handoffDecisionInstructions = `Además de answer, devuelve handoff. El pase a humano es interno: no anuncies una transferencia ni prometas que otro asesor escribirá. requested=true solo si los datos exigidos para el servicio están completos y ya no hay una pregunta de requisitos, duda o incumplimiento pendiente. En renta sin conductor, tipo de vehículo y período suficiente completan los datos; si el cliente no se identificó como particular ni empresa, usa route=cliente_sin_clasificar, requirements=no_aplica, exceptionReason indicando esos dos datos y requested=true en ese mismo turno. Si dijo que representa una empresa, usa route=corporativo con las mismas condiciones. No esperes una confirmación de requisitos particulares en esas dos rutas ni sigas calificando. Si el cliente se identificó como particular, comunica primero los requisitos aplicables y espera su confirmación; explicar requisitos no equivale a que el cliente los confirme. Para route=normal, requirements=confirmados y evidence debe copiar literalmente una confirmación del cliente que responda a esos requisitos. Un sí sobre otro asunto no cuenta. Para traslado o fuera_horario solo usa requirements=no_aplica con exceptionReason concreto y la ruta exacta; fuera_horario requiere una hora explícita. Si falta un dato o hay duda pendiente, requested=false. No inventes evidencia y nunca cambies de asesor por tu cuenta.`;

/** A model request is only a proposal; no human handoff happens on unconfirmed facts. */
export function confirmedAdvisorHandoff(
  handoff: z.infer<typeof handoffSchema>,
  history: AgentConversationContext["messages"],
  question: string,
): boolean {
  if (
    !handoff.requested ||
    !handoff.dataComplete ||
    handoff.questionPending ||
    handoff.nonCompliancePending
  )
    return false;
  if (handoff.route !== "normal")
    return handoff.requirements === "no_aplica" && handoff.exceptionReason.trim().length > 0;
  if (handoff.requirements !== "confirmados" || !handoff.evidence.trim()) return false;
  const messages = [...history, { role: "customer" as const, text: question }];
  const normalized = handoff.evidence.normalize("NFKC").toLocaleLowerCase("es").trim();
  const index = messages.findLastIndex(
    (message) =>
      message.role === "customer" &&
      message.text.normalize("NFKC").toLocaleLowerCase("es").includes(normalized),
  );
  if (index < 0) return false;
  const before = messages.slice(0, index).findLast((message) => message.role !== "customer");
  if (
    !/requisit|cumpl|cobertura/iu.test(handoff.evidence) &&
    !/requisit|cumpl|cobertura/iu.test(before?.text ?? "")
  )
    return false;
  return !messages
    .slice(index + 1)
    .some(
      (message) =>
        message.role === "customer" &&
        /\b(no cumplo|no tengo|no acepto|tengo dudas)\b/iu.test(message.text),
    );
}
