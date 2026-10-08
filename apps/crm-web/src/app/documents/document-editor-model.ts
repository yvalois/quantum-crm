import type { DocumentBlock } from "@quantum-crm/contracts";

export type ColumnsBlock = Extract<DocumentBlock, { readonly type: "COLUMNS" }>;
export type DocumentColumnLayout = ColumnsBlock["layout"];

export const documentColumnLayouts = [
  { id: "EQUAL_2", label: "Dos iguales", template: "1fr 1fr" },
  { id: "LEFT_WIDE", label: "Izquierda amplia", template: "2fr 1fr" },
  { id: "RIGHT_WIDE", label: "Derecha amplia", template: "1fr 2fr" },
  { id: "EQUAL_3", label: "Tres iguales", template: "1fr 1fr 1fr" },
] as const satisfies readonly {
  readonly id: DocumentColumnLayout;
  readonly label: string;
  readonly template: string;
}[];

export function createColumnsBlock(
  layout: DocumentColumnLayout,
  firstContent = "",
  id = crypto.randomUUID(),
): ColumnsBlock {
  return {
    id,
    type: "COLUMNS",
    locked: false,
    layout,
    columns: layout === "EQUAL_3" ? [firstContent, "", ""] : [firstContent, ""],
  };
}

export function changeColumnsLayout(
  block: ColumnsBlock,
  layout: DocumentColumnLayout,
): ColumnsBlock {
  const targetCount = layout === "EQUAL_3" ? 3 : 2;
  if (targetCount === block.columns.length) return { ...block, layout };
  if (targetCount === 3) return { ...block, layout, columns: [...block.columns, ""] };

  const [first = "", second = "", ...remaining] = block.columns;
  const mergedSecond = [second, ...remaining].filter((value) => value.trim()).join("\n\n");
  return { ...block, layout, columns: [first, mergedSecond] };
}

export function splitTextBlock(
  block: Extract<DocumentBlock, { readonly type: "TEXT" }>,
  layout: DocumentColumnLayout = "EQUAL_2",
): ColumnsBlock {
  return createColumnsBlock(layout, block.content, block.id);
}

export function canMoveBlock(
  blocks: readonly DocumentBlock[],
  index: number,
  offset: -1 | 1,
): boolean {
  const target = index + offset;
  return (
    target >= 0 &&
    target < blocks.length &&
    blocks[index]?.locked === false &&
    blocks[target]?.locked === false
  );
}

export function canMoveBlockTo(
  blocks: readonly DocumentBlock[],
  fromIndex: number,
  toIndex: number,
): boolean {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= blocks.length ||
    toIndex >= blocks.length ||
    fromIndex === toIndex ||
    blocks[fromIndex]?.locked !== false
  ) {
    return false;
  }
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  return blocks.slice(start, end + 1).every((block) => !block.locked);
}

export function moveDocumentBlockTo(
  blocks: readonly DocumentBlock[],
  fromIndex: number,
  toIndex: number,
): DocumentBlock[] | null {
  if (!canMoveBlockTo(blocks, fromIndex, toIndex)) return null;
  const next = [...blocks];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return null;
  next.splice(toIndex, 0, moved);
  return next;
}

export function moveDocumentBlock(
  blocks: readonly DocumentBlock[],
  index: number,
  offset: -1 | 1,
): DocumentBlock[] | null {
  return canMoveBlock(blocks, index, offset)
    ? moveDocumentBlockTo(blocks, index, index + offset)
    : null;
}
