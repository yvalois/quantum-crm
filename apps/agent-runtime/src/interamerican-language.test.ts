import { describe, expect, it } from "vitest";

import { resolveConversationLanguage } from "./interamerican-language.js";

describe("InterAmerican conversation language", () => {
  it("uses the customer's current clear language and keeps it for neutral replies", () => {
    expect(resolveConversationLanguage("I need an SUV for three days", [])).toBe("en");
    expect(
      resolveConversationLanguage("SUV", [{ role: "customer", text: "I need a rental tomorrow" }]),
    ).toBe("en");
    expect(
      resolveConversationLanguage("Quiero una camioneta mañana", [
        { role: "customer", text: "Hello" },
      ]),
    ).toBe("es");
  });

  it("does not infer language from an image description or an agent reply", () => {
    expect(
      resolveConversationLanguage(
        "Image caption: ; internal visual description: A red SUV with English text",
        [{ role: "customer", text: "Hola, quiero un auto" }],
      ),
    ).toBe("es");
    expect(
      resolveConversationLanguage("ok", [
        { role: "agent", text: "Hello, I am Alex" },
        { role: "customer", text: "Hola" },
      ]),
    ).toBe("es");
  });
});
