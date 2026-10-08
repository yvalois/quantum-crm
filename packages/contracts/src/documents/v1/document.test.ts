import { describe, expect, it } from "vitest";

import {
  AttachmentDocumentBlockSchema,
  ColumnsDocumentBlockSchema,
  CreateDocumentSchema,
  DocumentBlockSchema,
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
    expect(
      ImageDocumentBlockSchema.safeParse({
        id: "019db9c7-1268-7d24-bf99-96ea38ebf101",
        type: "IMAGE",
        locked: false,
        label: "Portada",
        alt: "",
        caption: "",
        fileId: "019db9c7-1268-7d24-bf99-96ea38ebf102",
        checksum: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      }).success,
    ).toBe(true);
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

  it("requires an immutable file identity for an attachment", () => {
    expect(
      AttachmentDocumentBlockSchema.safeParse({
        id: "019db9c7-1268-7d24-bf99-96ea38ebf104",
        type: "ATTACHMENT",
        locked: false,
        label: "Ficha tecnica",
        fileId: null,
        checksum: null,
        mimeType: "",
        originalName: "",
      }).success,
    ).toBe(true);
    expect(
      AttachmentDocumentBlockSchema.safeParse({
        id: "019db9c7-1268-7d24-bf99-96ea38ebf104",
        type: "ATTACHMENT",
        locked: false,
        label: "Ficha tecnica",
        fileId: "019db9c7-1268-7d24-bf99-96ea38ebf105",
        checksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        mimeType: "application/pdf",
        originalName: "ficha.pdf",
      }).success,
    ).toBe(true);
    expect(
      AttachmentDocumentBlockSchema.safeParse({
        id: "019db9c7-1268-7d24-bf99-96ea38ebf104",
        type: "ATTACHMENT",
        locked: false,
        label: "Ficha tecnica",
        fileId: "019db9c7-1268-7d24-bf99-96ea38ebf105",
        checksum: null,
        mimeType: "application/pdf",
        originalName: "ficha.pdf",
      }).success,
    ).toBe(false);
  });

  it("keeps legacy columns compatible and persists explicit layouts", () => {
    expect(
      ColumnsDocumentBlockSchema.parse({
        id: "019db9c7-1268-7d24-bf99-96ea38ebf106",
        type: "COLUMNS",
        locked: false,
        columns: ["Izquierda", "Derecha"],
      }).layout,
    ).toBe("EQUAL_2");
    expect(
      DocumentBlockSchema.parse({
        id: "019db9c7-1268-7d24-bf99-96ea38ebf106",
        type: "COLUMNS",
        locked: false,
        columns: ["Izquierda", "Derecha"],
      }),
    ).toMatchObject({ layout: "EQUAL_2" });

    expect(
      ColumnsDocumentBlockSchema.parse({
        id: "019db9c7-1268-7d24-bf99-96ea38ebf107",
        type: "COLUMNS",
        locked: false,
        layout: "LEFT_WIDE",
        columns: ["Contenido principal", "Apoyo"],
      }),
    ).toMatchObject({ layout: "LEFT_WIDE", columns: ["Contenido principal", "Apoyo"] });

    expect(
      ColumnsDocumentBlockSchema.safeParse({
        id: "019db9c7-1268-7d24-bf99-96ea38ebf108",
        type: "COLUMNS",
        locked: false,
        layout: "EQUAL_3",
        columns: ["Uno", "Dos"],
      }).success,
    ).toBe(false);
  });
});
