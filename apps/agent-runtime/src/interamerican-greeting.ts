/** First-contact wording from the supplied InterAmerican workflow, without its other actions. */
export const initialGreeting =
  "Hola 👋 gracias por escribirnos.\n\n" +
  "Soy Alex, asesor de InterAmerican Car Rental Guatemala 🚗✨\n\n" +
  "¿Qué tipo de servicio necesitas hoy?\n\n" +
  "🚗 Renta de vehículo\n" +
  "👨🏻‍✈️ Renta de vehículo con conductor\n" +
  "📍 Traslado";

export const briefIntroduction =
  "Hola 👋 gracias por escribir a InterAmerican Car Rental Guatemala.\n\n" +
  "Soy Alex, asesor de InterAmerican Car Rental Guatemala 🚗✨\n\n";

export const initialGreetingEnglish =
  "Hi 👋 thanks for reaching out.\n\n" +
  "I'm Alex from InterAmerican Car Rental Guatemala 🚗✨\n\n" +
  "What kind of service do you need today?\n\n" +
  "🚗 Car rental\n" +
  "👨🏻‍✈️ Car rental with driver\n" +
  "📍 Transfer";

export const briefIntroductionEnglish =
  "Hi 👋 thanks for reaching out to InterAmerican Car Rental Guatemala.\n\n" +
  "I'm Alex, an advisor at InterAmerican Car Rental Guatemala 🚗✨\n\n";

export function noCatalogAnswer(firstTurn: boolean): string {
  return firstTurn
    ? initialGreeting
    : "¿Buscas información del catálogo individual o del corporativo?";
}
