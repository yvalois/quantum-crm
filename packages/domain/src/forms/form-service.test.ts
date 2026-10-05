import { describe, expect, it } from "vitest";

import type { FormDefinition } from "@quantum-crm/contracts";

import { FormValidationError } from "./index.js";
import { isFormFieldVisible, validateFormAnswers } from "./form-service.js";

const firstId = "019b0000-0000-7000-8000-000000000102";
const secondId = "019b0000-0000-7000-8000-000000000103";
const definition: FormDefinition = {
  sections: [
    {
      id: "019b0000-0000-7000-8000-000000000101",
      title: "Datos",
      description: "",
      fields: [
        {
          id: firstId,
          type: "SINGLE_CHOICE",
          label: "Tipo",
          description: "",
          required: true,
          options: ["Empresa", "Persona"],
          condition: null,
        },
        {
          id: secondId,
          type: "EMAIL",
          label: "Correo",
          description: "",
          required: true,
          options: [],
          condition: { sourceFieldId: firstId, operator: "EQUALS", value: "Empresa" },
        },
      ],
    },
  ],
};

describe("form answer validation", () => {
  it("does not require a conditional field while hidden", () => {
    expect(validateFormAnswers(definition, { [firstId]: "Persona" })).toEqual({
      [firstId]: "Persona",
    });
    expect(isFormFieldVisible(definition.sections[0]!.fields[1]!, { [firstId]: "Persona" })).toBe(
      false,
    );
  });

  it("requires and validates a conditional field once visible", () => {
    expect(() => validateFormAnswers(definition, { [firstId]: "Empresa" })).toThrow(
      FormValidationError,
    );
    expect(
      validateFormAnswers(definition, { [firstId]: "Empresa", [secondId]: "cliente@example.com" }),
    ).toEqual({ [firstId]: "Empresa", [secondId]: "cliente@example.com" });
  });

  it("rejects unknown fields and invalid choice values", () => {
    expect(() => validateFormAnswers(definition, { [firstId]: "Otro" })).toThrow(
      FormValidationError,
    );
    expect(() =>
      validateFormAnswers(definition, {
        [firstId]: "Persona",
        "019b0000-0000-7000-8000-000000000999": "extra",
      }),
    ).toThrow(FormValidationError);
  });
});
