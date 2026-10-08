import { describe, expect, it } from "vitest";

import {
  addColumnItem,
  addTableColumn,
  addTableRow,
  canMoveBlock,
  changeColumnsLayout,
  createColumnItem,
  createColumnsBlock,
  imageFrameWidth,
  moveImageFocalPoint,
  moveColumnItem,
  moveColumnItemToCell,
  moveDocumentBlock,
  moveDocumentBlockTo,
  normalizeColumnsBlock,
  normalizeDocumentBlocks,
  normalizeTableBlock,
  removeColumnItem,
  removeTableColumn,
  removeTableRow,
  resizeContainedImageFrame,
  resizeImageFrame,
  resizeImageFrameHeight,
  rotateImageFromPointer,
  setTableColumnWidth,
  splitTextBlock,
  tableColumnWidths,
  updateColumnItem,
} from "./document-editor-model.js";

const firstId = "019db9c7-1268-7d24-bf99-96ea38ebf201";
const secondId = "019db9c7-1268-7d24-bf99-96ea38ebf202";

describe("document editor model", () => {
  it("keeps legacy image widths compatible with continuous resizing", () => {
    expect(imageFrameWidth({ width: "FULL" })).toBe(100);
    expect(imageFrameWidth({ width: "WIDE" })).toBe(80);
    expect(imageFrameWidth({ width: "MEDIUM" })).toBe(62);
    expect(imageFrameWidth({ width: "SMALL", widthPercent: 37 })).toBe(37);
  });

  it("creates column images showing the complete file by default", () => {
    expect(createColumnItem("IMAGE", secondId)).toMatchObject({
      fit: "CONTAIN",
      aspectRatio: "AUTO",
      rotation: 0,
    });
  });

  it("resizes from each visual corner and clamps the frame to usable limits", () => {
    expect(resizeImageFrame(60, 80, 400, "SE")).toBe(80);
    expect(resizeImageFrame(60, -80, 400, "SW")).toBe(80);
    expect(resizeImageFrame(95, 200, 400, "NE")).toBe(100);
    expect(resizeImageFrame(15, 200, 400, "NW")).toBe(10);
  });

  it("resizes image height from the direct vertical handles and keeps it bounded", () => {
    expect(resizeImageFrameHeight(220, 60, "S")).toBe(280);
    expect(resizeImageFrameHeight(220, -60, "N")).toBe(280);
    expect(resizeImageFrameHeight(90, 40, "N")).toBe(80);
    expect(resizeImageFrameHeight(1180, 100, "SE")).toBe(1200);
  });

  it("scales a complete image from every handle without breaking its natural ratio", () => {
    expect(resizeContainedImageFrame(300, 150, -60, 0, 600, "E")).toBe(40);
    expect(resizeContainedImageFrame(300, 150, 60, 0, 600, "W")).toBe(40);
    expect(resizeContainedImageFrame(300, 150, 0, -30, 600, "S")).toBe(40);
    expect(resizeContainedImageFrame(300, 150, 0, 30, 600, "N")).toBe(40);
    expect(resizeContainedImageFrame(300, 150, 20, 40, 600, "SE")).toBe(63);
  });

  it("keeps proportional image scaling inside the canvas and above a usable size", () => {
    expect(resizeContainedImageFrame(570, 285, 200, 0, 600, "E")).toBe(100);
    expect(resizeContainedImageFrame(300, 150, -500, 0, 600, "E")).toBe(27);
  });

  it("moves the crop with the dragged image while keeping its focal point bounded", () => {
    expect(moveImageFocalPoint(50, 50, 50, -25, 200, 100)).toEqual({ x: 25, y: 75 });
    expect(moveImageFocalPoint(10, 90, 500, -500, 200, 100)).toEqual({ x: 0, y: 100 });
  });

  it("calculates direct rotation around the image centre", () => {
    expect(rotateImageFromPointer(0, 100, 100, 100, 0, 200, 100)).toBe(90);
    expect(rotateImageFromPointer(170, 100, 100, 200, 100, 100, 200)).toBe(-100);
  });

  it.each([
    ["EQUAL_2", 2],
    ["LEFT_WIDE", 2],
    ["RIGHT_WIDE", 2],
    ["EQUAL_3", 3],
  ] as const)("creates %s with the expected cells", (layout, count) => {
    expect(createColumnsBlock(layout, "Principal", firstId)).toMatchObject({
      id: firstId,
      layout,
      columns: expect.arrayContaining(["Principal"]),
    });
    expect(createColumnsBlock(layout, "Principal", firstId).columns).toHaveLength(count);
    expect(createColumnsBlock(layout, "Principal", firstId).cells).toHaveLength(count);
  });

  it("preserves every cell when changing between two and three columns", () => {
    const source = createColumnsBlock("EQUAL_3", "A", firstId);
    const thirdCellId = source.cells?.[2]?.id;
    expect(thirdCellId).toBeTruthy();
    if (!thirdCellId) return;
    const withImage = addColumnItem(source, thirdCellId, createColumnItem("IMAGE", secondId));
    const three = changeColumnsLayout(withImage, "LEFT_WIDE");
    expect(three).toMatchObject({ layout: "LEFT_WIDE" });
    expect(three.cells?.[1]?.items).toHaveLength(4);
    expect(three.cells?.[1]?.items.some((item) => item.id === secondId)).toBe(true);
    expect(changeColumnsLayout(three, "EQUAL_3").cells).toHaveLength(3);
  });

  it("splits text without losing its identity or content", () => {
    const split = splitTextBlock({
      id: firstId,
      type: "TEXT",
      locked: false,
      align: "LEFT",
      content: "Texto existente",
      style: "TITLE",
      bold: true,
      italic: true,
      underline: true,
      fontFamily: "SERIF",
      fontSize: 28,
    });

    expect(split).toMatchObject({
      id: firstId,
      type: "COLUMNS",
      columns: ["Texto existente", ""],
    });
    expect(split.cells?.[0]?.items[0]).toMatchObject({
      type: "TEXT",
      content: "Texto existente",
      style: "TITLE",
      bold: true,
      italic: true,
      underline: true,
      fontFamily: "SERIF",
      fontSize: 28,
    });
  });

  it("does not rewrite a protected legacy column block with random cell identities", () => {
    const legacy = {
      id: firstId,
      type: "COLUMNS" as const,
      locked: true,
      layout: "EQUAL_2" as const,
      columns: ["A", "B"],
    };
    expect(normalizeColumnsBlock(legacy)).toBe(legacy);
  });

  it("adds, updates, reorders and removes composed items inside a column", () => {
    const initial = createColumnsBlock("EQUAL_2", "Inicio", firstId);
    const cellId = initial.cells?.[0]?.id;
    expect(cellId).toBeTruthy();
    if (!cellId) return;

    const image = createColumnItem("IMAGE", secondId);
    const withImage = addColumnItem(initial, cellId, image);
    expect(withImage.cells?.[0]?.items.map((item) => item.type)).toEqual(["TEXT", "IMAGE"]);

    const updated = updateColumnItem(withImage, secondId, (item) =>
      item.type === "IMAGE" ? { ...item, label: "Vehiculo" } : item,
    );
    expect(updated.columns[0]).toContain("[Imagen: Vehiculo]");

    const moved = moveColumnItem(updated, cellId, 1, -1);
    expect(moved.cells?.[0]?.items[0]?.id).toBe(secondId);
    const secondCellId = moved.cells?.[1]?.id;
    expect(secondCellId).toBeTruthy();
    if (!secondCellId) return;
    const movedAcross = moveColumnItemToCell(moved, secondId, secondCellId);
    expect(movedAcross.cells?.[0]?.items).toHaveLength(1);
    expect(movedAcross.cells?.[1]?.items.at(-1)?.id).toBe(secondId);
    expect(removeColumnItem(movedAcross, secondId).cells?.[1]?.items).toHaveLength(1);
  });

  it("preserves the complete image configuration while composing and moving columns", () => {
    const initial = createColumnsBlock("EQUAL_3", "Presentacion", firstId);
    const firstCellId = initial.cells?.[0]?.id;
    const thirdCellId = initial.cells?.[2]?.id;
    expect(firstCellId).toBeTruthy();
    expect(thirdCellId).toBeTruthy();
    if (!firstCellId || !thirdCellId) return;

    const image = {
      ...createColumnItem("IMAGE", secondId),
      label: "Flota disponible",
      alt: "Vehiculo listo para reserva",
      caption: "Categoria ejecutiva",
      fileId: "019db9c7-1268-7d24-bf99-96ea38ebf203",
      checksum: `sha256:${"a".repeat(64)}`,
      replaceable: true,
      visible: true,
      width: "MEDIUM" as const,
      widthPercent: 57,
      align: "RIGHT" as const,
      fit: "CONTAIN" as const,
      aspectRatio: "LANDSCAPE_4_3" as const,
      focalX: 72,
      focalY: 35,
      rotation: -4,
      opacity: 88,
      cornerRadius: 16,
      flow: "FLOAT_RIGHT" as const,
    };
    const withImage = addColumnItem(initial, firstCellId, image);
    const moved = moveColumnItemToCell(withImage, secondId, thirdCellId);
    const collapsed = changeColumnsLayout(moved, "RIGHT_WIDE");

    expect(
      collapsed.cells?.flatMap((cell) => cell.items).find((item) => item.id === secondId),
    ).toEqual(image);
    expect(collapsed.columns[1]).toContain("[Imagen: Flota disponible]");
  });

  it("normalizes editable legacy columns without rewriting surrounding page content", () => {
    const heading = {
      id: firstId,
      type: "TEXT" as const,
      locked: false,
      align: "CENTER" as const,
      content: "Propuesta comercial",
    };
    const legacyColumns = {
      id: secondId,
      type: "COLUMNS" as const,
      locked: false,
      layout: "EQUAL_2" as const,
      columns: ["Cliente", "Asesor"],
    };

    const normalized = normalizeDocumentBlocks([heading, legacyColumns]);

    expect(normalized[0]).toBe(heading);
    expect(normalized[1]).toMatchObject({
      id: secondId,
      columns: ["Cliente", "Asesor"],
      cells: [
        {
          items: [
            {
              type: "TEXT",
              content: "Cliente",
              align: "LEFT",
              style: "BODY",
              bold: false,
              italic: false,
              underline: false,
              fontFamily: "INHERIT",
            },
          ],
        },
        {
          items: [
            {
              type: "TEXT",
              content: "Asesor",
              align: "LEFT",
              style: "BODY",
              bold: false,
              italic: false,
              underline: false,
              fontFamily: "INHERIT",
            },
          ],
        },
      ],
    });
  });

  it("edits table structure without mutating the source and persists balanced widths", () => {
    const source = {
      id: firstId,
      type: "TABLE" as const,
      locked: false,
      columns: ["Servicio", "Valor"],
      rows: [["Consultoria", "$ 100"]],
    };

    const normalized = normalizeTableBlock(source);
    const withRow = addTableRow(normalized, ["Soporte", "$ 50"]);
    const withColumn = addTableColumn(withRow, "Cantidad");
    const resized = setTableColumnWidth(withColumn, 0, 70);
    const withoutMiddleColumn = removeTableColumn(resized, 1);
    const withoutFirstRow = removeTableRow(withoutMiddleColumn, 0);

    expect(source).not.toHaveProperty("columnWidths");
    expect(normalized.columnWidths).toEqual([50, 50]);
    expect(withRow.rows).toEqual([
      ["Consultoria", "$ 100"],
      ["Soporte", "$ 50"],
    ]);
    expect(withColumn.columns).toEqual(["Servicio", "Valor", "Cantidad"]);
    expect(withColumn.rows).toEqual([
      ["Consultoria", "$ 100", ""],
      ["Soporte", "$ 50", ""],
    ]);
    expect(resized.columnWidths?.[0]).toBe(70);
    expect(resized.columnWidths?.reduce((total, width) => total + width, 0)).toBe(100);
    expect(resized.columnWidths?.slice(1).every((width) => width >= 5)).toBe(true);
    expect(withoutMiddleColumn.columns).toEqual(["Servicio", "Cantidad"]);
    expect(withoutMiddleColumn.rows).toEqual([
      ["Consultoria", ""],
      ["Soporte", ""],
    ]);
    expect(withoutMiddleColumn.columnWidths?.reduce((total, width) => total + width, 0)).toBe(100);
    expect(withoutFirstRow.rows).toEqual([["Soporte", ""]]);
  });

  it("keeps table operations within contract limits and protects locked tables", () => {
    const locked = {
      id: firstId,
      type: "TABLE" as const,
      locked: true,
      columns: ["Unica"],
      rows: [["Dato"]],
    };
    const full = {
      ...locked,
      locked: false,
      columns: Array.from({ length: 8 }, (_, index) => `C${index + 1}`),
      rows: [Array.from({ length: 8 }, () => "")],
      columnWidths: [13, 13, 13, 13, 12, 12, 12, 12],
    };

    expect(addTableRow(locked)).toBe(locked);
    expect(addTableColumn(locked)).toBe(locked);
    expect(removeTableColumn(locked, 0)).toBe(locked);
    expect(setTableColumnWidth(locked, 0, 25)).toBe(locked);
    expect(removeTableColumn({ ...locked, locked: false }, 0)).toEqual({
      ...locked,
      locked: false,
    });
    expect(addTableColumn(full)).toBe(full);
    expect(tableColumnWidths(full)).toEqual(full.columnWidths);
  });

  it("does not move a block across a protected neighbour", () => {
    const blocks = [
      { id: firstId, type: "TEXT", locked: false, align: "LEFT", content: "A" },
      { id: secondId, type: "TEXT", locked: true, align: "LEFT", content: "B" },
    ] as const;
    expect(canMoveBlock(blocks, 0, 1)).toBe(false);
    expect(moveDocumentBlock(blocks, 0, 1)).toBeNull();
  });

  it("reorders complete blocks without changing their content", () => {
    const blocks = [
      { id: firstId, type: "TEXT", locked: false, align: "LEFT", content: "A" },
      { id: secondId, type: "TEXT", locked: false, align: "LEFT", content: "B" },
    ] as const;
    expect(moveDocumentBlockTo(blocks, 0, 1)?.map((block) => block.id)).toEqual([
      secondId,
      firstId,
    ]);
  });
});
