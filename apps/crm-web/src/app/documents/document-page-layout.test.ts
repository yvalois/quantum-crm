import { describe, expect, it } from "vitest";

import {
  clampBlockToPrintableArea,
  createDocumentPageGeometry,
  paginateDocumentBlocks,
} from "./document-page-layout.js";

const standardMargins = { top: 20, right: 18, bottom: 20, left: 18 } as const;

describe("document page layout", () => {
  it("derives the printable A4 and Letter areas from physical millimetres", () => {
    expect(createDocumentPageGeometry("A4", standardMargins)).toMatchObject({
      widthMm: 210,
      heightMm: 297,
      contentWidthMm: 174,
      contentHeightMm: 257,
    });
    expect(createDocumentPageGeometry("LETTER", standardMargins)).toMatchObject({
      widthMm: 215.9,
      heightMm: 279.4,
      contentWidthMm: 179.9,
      contentHeightMm: 239.4,
    });
  });

  it("clamps only to the active printable area rather than editorial pixel limits", () => {
    const geometry = createDocumentPageGeometry("A4", standardMargins);

    expect(clampBlockToPrintableArea({ widthMm: 174, heightMm: 257 }, geometry)).toEqual({
      box: { widthMm: 174, heightMm: 257 },
      widthClamped: false,
      heightClamped: false,
    });
    expect(clampBlockToPrintableArea({ widthMm: 215, heightMm: 310 }, geometry)).toEqual({
      box: { widthMm: 174, heightMm: 257 },
      widthClamped: true,
      heightClamped: true,
    });
  });

  it("creates a new physical page for an explicit break without creating a leading blank page", () => {
    const geometry = createDocumentPageGeometry("A4", standardMargins);
    const layout = paginateDocumentBlocks(
      [
        { id: "cover", box: { widthMm: 100, heightMm: 30 }, value: "cover" },
        { id: "summary", box: { widthMm: 100, heightMm: 40 }, value: "summary" },
        {
          id: "terms",
          breakBefore: true,
          box: { widthMm: 100, heightMm: 50 },
          value: "terms",
        },
      ],
      geometry,
    );

    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]).toMatchObject({
      index: 1,
      usedContentHeightMm: 70,
      remainingContentHeightMm: 187,
    });
    expect(layout.pages[0]?.blocks.map((block) => block.id)).toEqual(["cover", "summary"]);
    expect(layout.pages[1]?.blocks).toMatchObject([
      { id: "terms", xMm: 18, yMm: 20, box: { widthMm: 100, heightMm: 50 } },
    ]);

    const leadingBreak = paginateDocumentBlocks(
      [{ id: "first", breakBefore: true, box: { widthMm: 50, heightMm: 10 }, value: "first" }],
      geometry,
    );
    expect(leadingBreak.pages).toHaveLength(1);
  });

  it("moves an indivisible block to the next page instead of overflowing it", () => {
    const geometry = createDocumentPageGeometry("A4", standardMargins);
    const layout = paginateDocumentBlocks(
      [
        { id: "first", box: { widthMm: 150, heightMm: 150 }, value: "first" },
        { id: "second", box: { widthMm: 150, heightMm: 150 }, value: "second" },
      ],
      geometry,
    );

    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]?.blocks.map((block) => block.id)).toEqual(["first"]);
    expect(layout.pages[1]?.blocks).toMatchObject([{ id: "second", yMm: 20 }]);
  });

  it("rejects an oversized block until the caller explicitly adjusts it", () => {
    const geometry = createDocumentPageGeometry("A4", standardMargins);

    expect(() =>
      paginateDocumentBlocks(
        [{ id: "wide", box: { widthMm: 174.1, heightMm: 20 }, value: "wide" }],
        geometry,
      ),
    ).toThrow("supera el area imprimible");
  });
});
