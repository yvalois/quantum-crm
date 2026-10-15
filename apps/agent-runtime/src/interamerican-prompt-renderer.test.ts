import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { interAmericanOriginalPrompt } from "./interamerican-original-prompt.js";
import { renderInterAmericanPrompt } from "./interamerican-prompt-renderer.js";

describe("InterAmerican V54.84 prompt", () => {
  it("preserves the owner's original main-agent prompt byte for byte", () => {
    expect(createHash("sha256").update(interAmericanOriginalPrompt, "utf8").digest("hex")).toBe(
      "18de33bc4f2a86d9fb610cc3bbfede33a398173670e871a359d25eedb326e29b",
    );
  });

  it("resolves the n8n transport fields without leaving executable template text", () => {
    const prompt = renderInterAmericanPrompt({
      question: "Quiero un SUV por tres días",
      language: "es",
    });
    expect(prompt).toContain("Quiero un SUV por tres días");
    expect(prompt).toContain("# Saludo inicial y saludo de reentrada");
    expect(prompt).not.toContain("{{ $json.");
  });
});
