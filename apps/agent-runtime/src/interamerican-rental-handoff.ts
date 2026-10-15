import type { AgentConversationContext } from "@quantum-crm/contracts";

/** A narrow, deterministic enforcement of the owner's V54.84 unclassified rental rule. */
export function unclassifiedRentalHandoff(input: {
  readonly question: string;
  readonly history: AgentConversationContext["messages"];
  readonly language: "es" | "en";
  readonly firstTurn: boolean;
}): string | null {
  const customerText = [
    ...input.history
      .filter((message) => message.role === "customer")
      .map((message) => message.text),
    input.question,
  ].join(" ");
  if (
    /\b(?:cobertura|seguro|requisitos?|incluye|puedo|can i|insurance|coverage|requirements?)\b/iu.test(
      input.question,
    ) ||
    /\b(?:particular|persona natural|empresa|empresarial|corporativ[oa]|negocio|business|company|individual)\b/iu.test(
      customerText,
    ) ||
    /\b(?:traslado|transfer|renting|con conductor|con piloto|with driver)\b/iu.test(customerText) ||
    input.history.some(
      (message) =>
        message.role !== "customer" &&
        /\b(?:requisitos?|cumples?|requirements?|cobertura de menores)\b/iu.test(message.text),
    )
  ) {
    return null;
  }
  const hasVehicle =
    /\b(?:sed[aá]n|suv|camioneta|pick\s?up|microb[uú]s|minivan|panel de carga)\b/iu.test(
      customerText,
    );
  const hasPeriod =
    /\b(?:\d+|un[oa]?|dos|tres|cuatro|cinco|seis|seven|one|two|three|four|five|six)\s*(?:d[ií]as?|days?|semanas?|weeks?|mes(?:es)?|months?)\b/iu.test(
      customerText,
    );
  if (!hasVehicle || !hasPeriod) return null;
  const closing =
    input.language === "en"
      ? "Thank you for the information 😊\n\nI'll check availability and share the options with their rates shortly."
      : "Muchas gracias por la información 😊\n\nVoy a validar la disponibilidad y en un momento te comparto las opciones con sus tarifas.";
  if (!input.firstTurn) return closing;
  return input.language === "en"
    ? `Hi 👋 thanks for reaching out to InterAmerican Car Rental Guatemala.\n\nI'm Alex, an advisor at InterAmerican Car Rental Guatemala 🚗✨\n\n${closing}`
    : `Hola 👋 gracias por escribir a InterAmerican Car Rental Guatemala.\n\nSoy Alex, asesor de InterAmerican Car Rental Guatemala 🚗✨\n\n${closing}`;
}
