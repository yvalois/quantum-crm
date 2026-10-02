import { describe, expect, it } from "vitest";

import {
  CreateDocumentSchema,
  DocumentDesignSchema,
  ImageDocumentBlockSchema,
} from "./document.js";

const design = {
  accentColor: "#15b8a6",
  textColor: "#102125",
  fontFamily: "INSTRUMENT_SANS",
  pageSize: "A4",
  headerText: "Quantum Demo",
  footerText: "Documento confidencial",
  showPageNumbers: true,
  logoFileId: null,
  logoChecksum: null,
  backgroundFileId: null,
  backgroundChecksum: null,
} as const;

describe("document contracts", () => {
  it("accepts a bounded document draft", () => {
    expect(
      CreateDocumentSchema.parse({
        kind: "QUOTE",
        title: "Propuesta comercial",
        design: DocumentDesignSchema.parse(design),
        blocks: [
          {
            id: "019db9c7-1268-7d24-bf99-96ea38ebf100",
            type: "TEXT",
            locked: false,
            content: "Hola {{contact.name}}",
            align: "LEFT",
          },
        ],
      }),
    ).toMatchObject({ kind: "QUOTE", title: "Propuesta comercial" });
  });

  it("requires an immutable file identity for a selected image", () => {
    expect(
      ImageDocumentBlockSchema.safeParse({
        id: "019db9c7-1268-7d24-bf99-96ea38ebf101",
        type: "IMAGE",
        locked: false,
        label: "Portada",
        alt: "",
        caption: "",
        fileId: "019db9c7-1268-7d24-bf99-96ea38ebf102",
        checksum: null,
      }).success,
    ).toBe(false);
  });

  it("rejects mixing a template with explicit blocks", () => {
    expect(
      CreateDocumentSchema.safeParse({
        kind: "QUOTE",
        title: "Duplicada",
        templateId: "019db9c7-1268-7d24-bf99-96ea38ebf103",
        blocks: [],
      }).success,
    ).toBe(false);
  });
});
