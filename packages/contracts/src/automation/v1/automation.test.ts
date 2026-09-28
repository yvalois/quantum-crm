import { describe, expect, it } from "vitest";

import { ActivateAutomationSchema, CreateAutomationSchema } from "./automation.js";

const contactId = "01995f7e-7b52-7000-8000-000000000201";

describe("automation contracts", () => {
  it("accepts an active task automation and bounded activation", () => {
    expect(
      CreateAutomationSchema.parse({
        name: "Seguimiento",
        status: "ACTIVE",
        action: {
          type: "CREATE_TASK",
          title: "Llamar al contacto",
          description: "Realizar la llamada inicial.",
          priority: "HIGH",
          dueHours: 24,
        },
      }),
    ).toMatchObject({ status: "ACTIVE", action: { type: "CREATE_TASK" } });
    expect(ActivateAutomationSchema.parse({ contactIds: [contactId, contactId] })).toEqual({
      contactIds: [contactId, contactId],
    });
  });

  it("rejects an invalid due window", () => {
    expect(() =>
      CreateAutomationSchema.parse({
        name: "Seguimiento",
        action: {
          type: "CREATE_TASK",
          title: "Llamar",
          description: "Realizar llamada.",
          priority: "LOW",
          dueHours: 0,
        },
      }),
    ).toThrow();
  });
});
