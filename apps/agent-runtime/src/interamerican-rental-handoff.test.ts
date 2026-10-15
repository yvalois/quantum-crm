import { describe, expect, it } from "vitest";

import { unclassifiedRentalHandoff } from "./interamerican-rental-handoff.js";

describe("V54.84 rental handoff without classified customer type", () => {
  it("uses the source greeting and closing when SUV and duration arrive together", () => {
    const answer = unclassifiedRentalHandoff({
      question: "Hola, quiero rentar un SUV por tres días",
      history: [],
      language: "es",
      firstTurn: true,
    });
    expect(answer).toContain("Soy Alex, asesor de InterAmerican Car Rental Guatemala 🚗✨");
    expect(answer).toContain("Voy a validar la disponibilidad");
    expect(answer).not.toContain("¿Cumples con estos requisitos?");
  });

  it("combines customer answers across turns without repeating the greeting", () => {
    const answer = unclassifiedRentalHandoff({
      question: "Tres días",
      history: [
        { role: "customer", text: "Quiero un SUV" },
        { role: "agent", text: "¿Por cuánto tiempo lo necesitas?" },
      ],
      language: "es",
      firstTurn: false,
    });
    expect(answer).toBe(
      "Muchas gracias por la información 😊\n\nVoy a validar la disponibilidad y en un momento te comparto las opciones con sus tarifas.",
    );
  });

  it("does not bypass particular requirements, a driver service, or a pending requirements question", () => {
    const base = { language: "es" as const, firstTurn: false };
    expect(unclassifiedRentalHandoff({ ...base, question: "Soy particular, SUV tres días", history: [] })).toBeNull();
    expect(unclassifiedRentalHandoff({ ...base, question: "SUV con conductor tres días", history: [] })).toBeNull();
    expect(unclassifiedRentalHandoff({
      ...base,
      question: "SUV tres días",
      history: [{ role: "agent", text: "¿Cumples con los requisitos?" }],
    })).toBeNull();
  });

  it("answers policy questions through the full prompt instead of auto-handoff", () => {
    expect(unclassifiedRentalHandoff({
      question: "¿Qué cobertura incluye un SUV por tres días?",
      history: [],
      language: "es",
      firstTurn: true,
    })).toBeNull();
  });
});
