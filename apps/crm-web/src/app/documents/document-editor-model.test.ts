import { describe, expect, it } from "vitest";

import {
  canMoveBlock,
  changeColumnsLayout,
  createColumnsBlock,
  moveDocumentBlock,
  moveDocumentBlockTo,
  splitTextBlock,
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
  });

  it("preserves every cell when changing between two and three columns", () => {
    const three = changeColumnsLayout(
      { ...createColumnsBlock("EQUAL_3", "A", firstId), columns: ["A", "B", "C"] },
      "LEFT_WIDE",
    );
    expect(three).toMatchObject({ layout: "LEFT_WIDE", columns: ["A", "B\n\nC"] });
    expect(changeColumnsLayout(three, "EQUAL_3").columns).toEqual(["A", "B\n\nC", ""]);
  });

  it("splits text without losing its identity or content", () => {
    expect(
      splitTextBlock({
        id: firstId,
        type: "TEXT",
        locked: false,
        align: "LEFT",
        content: "Texto existente",
      }),
    ).toMatchObject({ id: firstId, type: "COLUMNS", columns: ["Texto existente", ""] });
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
