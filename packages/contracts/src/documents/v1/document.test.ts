import { describe, expect, it } from "vitest";

import {
  AttachmentDocumentBlockSchema,
  ColumnsDocumentBlockSchema,
  CreateDocumentSchema,
  DocumentBlockSchema,
  DocumentDesignSchema,
  ImageDocumentBlockSchema,
  TableDocumentBlockSchema,
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
  it("shows an image completely when no crop mode was explicitly selected", () => {
    const parsed = ImageDocumentBlockSchema.parse({
      id: "019db9c7-1268-7d24-bf99-96ea38ebf099",
      type: "IMAGE",
      locked: false,
      label: "Logotipo",
      alt: "",
      caption: "",
      fileId: null,
      checksum: null,
    });

    expect(parsed.fit).toBe("CONTAIN");
  });

  it("persists a freely resized image frame with a bounded height", () => {
    const image = {
      id: "019db9c7-1268-7d24-bf99-96ea38ebf098",
      type: "IMAGE",
      locked: false,
      label: "Logotipo",
      alt: "",
      caption: "",
      fileId: null,
      checksum: null,
      fit: "CONTAIN",
      aspectRatio: "FREE",
      heightPx: 360,
    } as const;

    expect(ImageDocumentBlockSchema.parse(image)).toMatchObject({
      aspectRatio: "FREE",
      heightPx: 360,
    });
    expect(ImageDocumentBlockSchema.safeParse({ ...image, heightPx: 40 }).success).toBe(false);
    expect(ImageDocumentBlockSchema.safeParse({ ...image, heightPx: 1400 }).success).toBe(false);
  });

  it("accepts a bounded document draft", () => {
    const parsed = CreateDocumentSchema.parse({
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
          style: "TITLE",
          bold: true,
          italic: false,
          underline: true,
          fontFamily: "SERIF",
          fontSize: 30,
        },
      ],
    });

    expect(parsed).toMatchObject({ kind: "QUOTE", title: "Propuesta comercial" });
    expect(parsed.blocks?.[0]).toMatchObject({
      type: "TEXT",
      style: "TITLE",
      bold: true,
      italic: false,
      underline: true,
      fontFamily: "SERIF",
      fontSize: 30,
    });
  });

  it("keeps legacy text compatible and persists rich formatting inside columns", () => {
    expect(
      DocumentBlockSchema.parse({
        id: "019db9c7-1268-7d24-bf99-96ea38ebf145",
        type: "TEXT",
        locked: false,
        content: "Texto anterior",
        align: "LEFT",
      }),
    ).toMatchObject({ type: "TEXT", content: "Texto anterior" });

    const parsed = ColumnsDocumentBlockSchema.parse({
      id: "019db9c7-1268-7d24-bf99-96ea38ebf146",
      type: "COLUMNS",
      locked: false,
      layout: "EQUAL_2",
      columns: ["Titulo", ""],
      cells: [
        {
          id: "019db9c7-1268-7d24-bf99-96ea38ebf147",
          items: [
            {
              id: "019db9c7-1268-7d24-bf99-96ea38ebf148",
              type: "TEXT",
              locked: false,
              content: "Titulo",
              align: "CENTER",
              style: "SUBTITLE",
              bold: true,
              italic: true,
              underline: false,
              fontFamily: "MONO",
              fontSize: 14,
            },
          ],
        },
        {
          id: "019db9c7-1268-7d24-bf99-96ea38ebf149",
          items: [],
        },
      ],
    });

    expect(parsed.cells?.[0]?.items[0]).toMatchObject({
      type: "TEXT",
      style: "SUBTITLE",
      bold: true,
      italic: true,
      underline: false,
      fontFamily: "MONO",
      fontSize: 14,
    });

    expect(
      DocumentBlockSchema.safeParse({
        id: "019db9c7-1268-7d24-bf99-96ea38ebf153",
        type: "TEXT",
        locked: false,
        content: "Tamano invalido",
        align: "LEFT",
        fontFamily: "SANS",
        fontSize: 120,
      }).success,
    ).toBe(false);
  });

  it("keeps legacy tables compatible and validates persistent column widths", () => {
    expect(
      TableDocumentBlockSchema.parse({
        id: "019db9c7-1268-7d24-bf99-96ea38ebf150",
        type: "TABLE",
        locked: false,
        columns: ["Servicio", "Valor"],
        rows: [["Consultoria", "$ 100"]],
      }),
    ).toMatchObject({ columns: ["Servicio", "Valor"] });

    expect(
      TableDocumentBlockSchema.parse({
        id: "019db9c7-1268-7d24-bf99-96ea38ebf151",
        type: "TABLE",
        locked: false,
        columns: ["Servicio", "Valor"],
        rows: [["Consultoria", "$ 100"]],
        columnWidths: [65, 35],
      }).columnWidths,
    ).toEqual([65, 35]);

    for (const columnWidths of [[65], [65, 30], [96, 4]]) {
      expect(
        DocumentBlockSchema.safeParse({
          id: "019db9c7-1268-7d24-bf99-96ea38ebf152",
          type: "TABLE",
          locked: false,
          columns: ["Servicio", "Valor"],
          rows: [["Consultoria", "$ 100"]],
          columnWidths,
        }).success,
      ).toBe(false);
    }
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

  it("persists composed column cells with secure images", () => {
    const parsed = ColumnsDocumentBlockSchema.parse({
      id: "019db9c7-1268-7d24-bf99-96ea38ebf109",
      type: "COLUMNS",
      locked: false,
      layout: "EQUAL_2",
      columns: ["[Imagen: Vehiculo]", ""],
      cells: [
        {
          id: "019db9c7-1268-7d24-bf99-96ea38ebf110",
          items: [
            {
              id: "019db9c7-1268-7d24-bf99-96ea38ebf111",
              type: "IMAGE",
              locked: false,
              label: "Vehiculo",
              alt: "Vehiculo disponible",
              caption: "",
              fileId: "019db9c7-1268-7d24-bf99-96ea38ebf112",
              checksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              replaceable: true,
              visible: true,
              width: "FULL",
              widthPercent: 64,
              align: "CENTER",
              fit: "COVER",
              aspectRatio: "WIDE_16_9",
              focalX: 68,
              focalY: 31,
              rotation: 3,
              opacity: 92,
              cornerRadius: 14,
              flow: "INLINE",
            },
          ],
        },
        {
          id: "019db9c7-1268-7d24-bf99-96ea38ebf113",
          items: [],
        },
      ],
    });
    expect(parsed.cells?.[0]?.items[0]).toMatchObject({
      type: "IMAGE",
      label: "Vehiculo",
      widthPercent: 64,
      aspectRatio: "WIDE_16_9",
      focalX: 68,
      focalY: 31,
      rotation: 3,
      opacity: 92,
      cornerRadius: 14,
    });

    const image = parsed.cells?.[0]?.items[0];
    expect(image?.type).toBe("IMAGE");
    if (!image || image.type !== "IMAGE") return;
    expect(ImageDocumentBlockSchema.safeParse({ ...image, widthPercent: 101 }).success).toBe(false);
    expect(ImageDocumentBlockSchema.safeParse({ ...image, focalX: -1 }).success).toBe(false);

    expect(
      ColumnsDocumentBlockSchema.safeParse({
        ...parsed,
        cells: parsed.cells?.slice(0, 1),
      }).success,
    ).toBe(false);

    expect(
      ColumnsDocumentBlockSchema.safeParse({
        ...parsed,
        columns: ["Contenido distinto", ""],
      }).success,
    ).toBe(false);

    const firstCell = parsed.cells?.[0];
    expect(firstCell).toBeTruthy();
    if (!firstCell) return;
    expect(
      ColumnsDocumentBlockSchema.safeParse({
        ...parsed,
        cells: [firstCell, { id: firstCell.id, items: [] }],
      }).success,
    ).toBe(false);
  });

  it("adds compatible header and footer defaults to legacy designs", () => {
    expect(DocumentDesignSchema.parse(design)).toMatchObject({
      margins: { top: 20, right: 18, bottom: 20, left: 18 },
      headerEnabled: true,
      headerLayout: "SPLIT",
      headerAlign: "LEFT",
      headerSpacing: "NORMAL",
      showDocumentKind: true,
      footerEnabled: true,
      footerAlign: "LEFT",
      footerSpacing: "NORMAL",
    });
    expect(
      DocumentDesignSchema.safeParse({
        ...design,
        margins: { top: 7, right: 18, bottom: 20, left: 18 },
      }).success,
    ).toBe(false);
    expect(DocumentDesignSchema.safeParse({ ...design, pages: [] }).success).toBe(false);
  });

  it("persists explicit page regions used by the visual editor", () => {
    expect(
      DocumentDesignSchema.parse({
        ...design,
        headerEnabled: true,
        headerLayout: "LOGO_TEXT",
        headerAlign: "RIGHT",
        headerSpacing: "SPACIOUS",
        showDocumentKind: false,
        footerEnabled: true,
        footerAlign: "CENTER",
        footerSpacing: "COMPACT",
        margins: { top: 12, right: 14, bottom: 16, left: 18 },
      }),
    ).toMatchObject({
      headerText: "Quantum Demo",
      headerEnabled: true,
      headerLayout: "LOGO_TEXT",
      headerAlign: "RIGHT",
      headerSpacing: "SPACIOUS",
      showDocumentKind: false,
      footerText: "Documento confidencial",
      footerEnabled: true,
      footerAlign: "CENTER",
      footerSpacing: "COMPACT",
      margins: { top: 12, right: 14, bottom: 16, left: 18 },
      showPageNumbers: true,
    });
  });

  it("rejects incomplete immutable identities for images nested in columns", () => {
    expect(
      ColumnsDocumentBlockSchema.safeParse({
        id: "019db9c7-1268-7d24-bf99-96ea38ebf140",
        type: "COLUMNS",
        locked: false,
        layout: "EQUAL_2",
        columns: ["[Imagen: Portada]", ""],
        cells: [
          {
            id: "019db9c7-1268-7d24-bf99-96ea38ebf141",
            items: [
              {
                id: "019db9c7-1268-7d24-bf99-96ea38ebf142",
                type: "IMAGE",
                locked: false,
                label: "Portada",
                alt: "",
                caption: "",
                fileId: "019db9c7-1268-7d24-bf99-96ea38ebf143",
                checksum: null,
                replaceable: true,
                visible: true,
                width: "FULL",
                align: "CENTER",
                fit: "COVER",
              },
            ],
          },
          {
            id: "019db9c7-1268-7d24-bf99-96ea38ebf144",
            items: [],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
