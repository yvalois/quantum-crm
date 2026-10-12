/** First-contact wording from the supplied InterAmerican workflow, without its other actions. */
export const initialGreeting =
  "Hola 👋 gracias por escribirnos.\n\n" +
  "Soy Alex, asesor de InterAmerican Car Rental Guatemala 🚗✨\n\n" +
  "¿Qué tipo de servicio necesitas hoy?\n\n" +
  "🚗 Renta de vehículo\n" +
  "👨🏻‍✈️ Renta de vehículo con conductor\n" +
  "📍 Traslado";

export const briefIntroduction =
  "Hola 👋 Soy Alex, asesor de InterAmerican Car Rental Guatemala.\n\n";

export function noCatalogAnswer(firstTurn: boolean): string {
  return firstTurn
    ? initialGreeting
    : "¿Buscas información del catálogo individual o del corporativo?";
}
