import { describe, expect, it } from "vitest";

import { confirmedAdvisorHandoff } from "./interamerican-handoff.js";

const confirmed = {
  requested: true,
  route: "normal" as const,
  dataComplete: true,
  requirements: "confirmados" as const,
  evidence: "Sí, cumplo los requisitos",
  exceptionReason: "",
  questionPending: false,
  nonCompliancePending: false,
};

describe("confirmed advisor handoff", () => {
  it("accepts only a real customer's answer to the requirements question", () => {
    const history = [{ role: "agent" as const, text: "¿Cumples con los requisitos indicados?" }];
    expect(confirmedAdvisorHandoff(confirmed, history, "Sí, cumplo los requisitos")).toBe(true);
    expect(confirmedAdvisorHandoff(confirmed, history, "Necesito una SUV")).toBe(false);
  });

  it("rejects pending questions, contradictions and fabricated evidence", () => {
    const history = [
      { role: "agent" as const, text: "¿Cumples los requisitos?" },
      { role: "customer" as const, text: "Sí, cumplo los requisitos" },
    ];
    expect(
      confirmedAdvisorHandoff({ ...confirmed, questionPending: true }, history, "Serían tres días"),
    ).toBe(false);
    expect(confirmedAdvisorHandoff(confirmed, history, "No tengo licencia")).toBe(false);
    expect(
      confirmedAdvisorHandoff({ ...confirmed, evidence: "Nunca dicho" }, history, "Tres días"),
    ).toBe(false);
  });

  it("requires an exact documented exception for an exempt service", () => {
    expect(
      confirmedAdvisorHandoff(
        {
          ...confirmed,
          route: "traslado",
          requirements: "no_aplica",
          evidence: "",
          exceptionReason: "Traslado de aeropuerto a hotel con día y hora confirmados",
        },
        [],
        "Gracias",
      ),
    ).toBe(true);
  });
});
