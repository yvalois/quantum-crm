import { describe, expect, it } from "vitest";

import { briefIntroduction, initialGreeting, noCatalogAnswer } from "./interamerican-greeting.js";

describe("InterAmerican first contact", () => {
  it("uses the supplied Alex greeting and menu on the first uncategorized message", () => {
    expect(noCatalogAnswer(true)).toBe(initialGreeting);
    expect(initialGreeting).toContain("Soy Alex, asesor de InterAmerican Car Rental Guatemala");
    expect(initialGreeting).toContain("📍 Traslado");
  });

  it("does not introduce Alex again on later messages", () => {
    expect(noCatalogAnswer(false)).not.toContain("Soy Alex");
    expect(briefIntroduction).toContain("Soy Alex");
  });
});
