import { describe, expect, it } from "vitest";

import {
  addColumnItem,
  canMoveBlock,
  changeColumnsLayout,
  createColumnItem,
  createColumnsBlock,
  moveColumnItem,
  moveColumnItemToCell,
  moveDocumentBlock,
  moveDocumentBlockTo,
  normalizeColumnsBlock,
  normalizeDocumentBlocks,
  removeColumnItem,
  splitTextBlock,
  updateColumnItem,
} from "./document-editor-model.js";

const firstId = "019db9c7-1268-7d24-bf99-96ea38ebf201";
const secondId = "019db9c7-1268-7d24-bf99-96ea38ebf202";

describe("document editor model", () => {
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
      align: "RIGHT" as const,
      fit: "CONTAIN" as const,
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
            },
          ],
        },
      ],
    });
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
