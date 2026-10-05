import { describe, expect, it } from "vitest";

import { CreateFormSchema, FormDefinitionSchema, SubmitFormResponseSchema } from "./form.js";

const sectionId = "019b0000-0000-7000-8000-000000000101";
const firstId = "019b0000-0000-7000-8000-000000000102";
const secondId = "019b0000-0000-7000-8000-000000000103";

function definition() {
  return {
    sections: [
      {
        id: sectionId,
        title: "Datos",
        description: "",
        fields: [
          {
            id: firstId,
            type: "SINGLE_CHOICE",
            label: "Tipo",
            required: true,
            options: ["Empresa", "Persona"],
            condition: null,
          },
          {
            id: secondId,
            type: "EMAIL",
            label: "Correo",
            required: true,
            options: [],
            condition: { sourceFieldId: firstId, operator: "EQUALS", value: "Empresa" },
          },
        ],
      },
    ],
  };
}

describe("form contracts", () => {
  it("accepts a bounded conditional definition", () => {
    expect(FormDefinitionSchema.safeParse(definition()).success).toBe(true);
    expect(
      CreateFormSchema.safeParse({ title: "Registro", definition: definition(), theme: {} })
        .success,
    ).toBe(true);
  });

  it("rejects duplicate identifiers and forward condition references", () => {
    const invalid = definition();
    invalid.sections[0]!.fields[0]!.id = secondId;
    expect(FormDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it("keeps public answers keyed by stable UUID", () => {
    expect(
      SubmitFormResponseSchema.safeParse({
        answers: { [firstId]: "Empresa", [secondId]: "cliente@example.com" },
      }).success,
    ).toBe(true);
    expect(SubmitFormResponseSchema.safeParse({ answers: { unknown: "value" } }).success).toBe(
      false,
    );
  });
});
