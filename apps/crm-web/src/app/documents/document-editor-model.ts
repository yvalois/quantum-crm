import type { DocumentBlock, DocumentColumnCell, DocumentColumnItem } from "@quantum-crm/contracts";

export type ColumnsBlock = Extract<DocumentBlock, { readonly type: "COLUMNS" }>;
export type DocumentColumnLayout = ColumnsBlock["layout"];
export type DocumentColumnItemType = DocumentColumnItem["type"];

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

function newId(): string {
  return crypto.randomUUID();
}

export function createColumnItem(
  type: DocumentColumnItemType,
  id = newId(),
  content = "",
): DocumentColumnItem {
  if (type === "TEXT") {
    return {
      id,
      type,
      locked: false,
      content,
      align: "LEFT",
      style: "BODY",
      bold: false,
      italic: false,
      underline: false,
    };
  }
  if (type === "IMAGE") {
    return {
      id,
      type,
      locked: false,
      label: "Imagen de la columna",
      alt: "",
      caption: "",
      fileId: null,
      checksum: null,
      replaceable: false,
      visible: true,
      width: "FULL",
      align: "CENTER",
      fit: "COVER",
    };
  }
  if (type === "VARIABLE") {
    return {
      id,
      type,
      locked: false,
      key: "contact.name",
      label: "Nombre del contacto",
      fallback: "Cliente",
      value: null,
      editable: false,
    };
  }
  return { id, type: "DIVIDER", locked: false, style: "SOLID" };
}

function createCell(content: string, id = newId(), itemId = newId()): DocumentColumnCell {
  return { id, items: [createColumnItem("TEXT", itemId, content)] };
}

function itemFallback(item: DocumentColumnItem): string {
  if (item.type === "TEXT") return item.content;
  if (item.type === "VARIABLE") return item.value ?? `{{${item.key}}}`;
  if (item.type === "IMAGE") return item.label ? `[Imagen: ${item.label}]` : "[Imagen]";
  return "---";
}

function syncColumnFallbacks(
  block: ColumnsBlock,
  cells: readonly DocumentColumnCell[],
): ColumnsBlock {
  return {
    ...block,
    cells: [...cells],
    columns: cells.map((cell) => cell.items.map(itemFallback).filter(Boolean).join("\n\n")),
  };
}

export function normalizeColumnsBlock(block: ColumnsBlock): ColumnsBlock {
  if (block.cells) return syncColumnFallbacks(block, block.cells);
  if (block.locked) return block;
  return syncColumnFallbacks(
    block,
    block.columns.map((content) => createCell(content)),
  );
}

export function normalizeDocumentBlocks(blocks: readonly DocumentBlock[]): DocumentBlock[] {
  return blocks.map((block) => (block.type === "COLUMNS" ? normalizeColumnsBlock(block) : block));
}

export function createColumnsBlock(
  layout: DocumentColumnLayout,
  firstContent = "",
  id = newId(),
): ColumnsBlock {
  const contents = layout === "EQUAL_3" ? [firstContent, "", ""] : [firstContent, ""];
  return syncColumnFallbacks(
    { id, type: "COLUMNS", locked: false, layout, columns: contents },
    contents.map((content) => createCell(content)),
  );
}

export function changeColumnsLayout(
  source: ColumnsBlock,
  layout: DocumentColumnLayout,
): ColumnsBlock {
  const block = normalizeColumnsBlock(source);
  const targetCount = layout === "EQUAL_3" ? 3 : 2;
  if (targetCount === block.cells?.length) return { ...block, layout };
  if (targetCount === 3) {
    return syncColumnFallbacks({ ...block, layout }, [...(block.cells ?? []), createCell("")]);
  }

  const [first = createCell(""), second = createCell(""), ...remaining] = block.cells ?? [];
  const mergedItems = [
    ...second.items,
    ...remaining.flatMap((cell) =>
      cell.items.length > 0 ? [createColumnItem("DIVIDER"), ...cell.items] : [],
    ),
  ];
  return syncColumnFallbacks({ ...block, layout }, [first, { ...second, items: mergedItems }]);
}

export function splitTextBlock(
  block: Extract<DocumentBlock, { readonly type: "TEXT" }>,
  layout: DocumentColumnLayout = "EQUAL_2",
): ColumnsBlock {
  const columns = createColumnsBlock(layout, block.content, block.id);
  const firstTextId = columns.cells?.[0]?.items[0]?.id;
  if (!firstTextId) return columns;
  return updateColumnItem(columns, firstTextId, (item) =>
    item.type === "TEXT"
      ? {
          ...item,
          style: block.style ?? "BODY",
          bold: block.bold ?? false,
          italic: block.italic ?? false,
          underline: block.underline ?? false,
          align: block.align,
        }
      : item,
  );
}

export function addColumnItem(
  source: ColumnsBlock,
  cellId: string,
  item: DocumentColumnItem,
): ColumnsBlock {
  const block = normalizeColumnsBlock(source);
  return syncColumnFallbacks(
    block,
    (block.cells ?? []).map((cell) =>
      cell.id === cellId ? { ...cell, items: [...cell.items, item] } : cell,
    ),
  );
}

export function updateColumnItem(
  source: ColumnsBlock,
  itemId: string,
  updater: (item: DocumentColumnItem) => DocumentColumnItem,
): ColumnsBlock {
  const block = normalizeColumnsBlock(source);
  return syncColumnFallbacks(
    block,
    (block.cells ?? []).map((cell) => ({
      ...cell,
      items: cell.items.map((item) => (item.id === itemId ? updater(item) : item)),
    })),
  );
}

export function removeColumnItem(source: ColumnsBlock, itemId: string): ColumnsBlock {
  const block = normalizeColumnsBlock(source);
  return syncColumnFallbacks(
    block,
    (block.cells ?? []).map((cell) => ({
      ...cell,
      items: cell.items.filter((item) => item.id !== itemId),
    })),
  );
}

export function moveColumnItem(
  source: ColumnsBlock,
  cellId: string,
  itemIndex: number,
  offset: -1 | 1,
): ColumnsBlock {
  const block = normalizeColumnsBlock(source);
  const cells = (block.cells ?? []).map((cell) => {
    if (cell.id !== cellId) return cell;
    const target = itemIndex + offset;
    if (target < 0 || target >= cell.items.length) return cell;
    const items = [...cell.items];
    const [item] = items.splice(itemIndex, 1);
    if (!item) return cell;
    items.splice(target, 0, item);
    return { ...cell, items };
  });
  return syncColumnFallbacks(block, cells);
}

export function moveColumnItemToCell(
  source: ColumnsBlock,
  itemId: string,
  targetCellId: string,
): ColumnsBlock {
  const block = normalizeColumnsBlock(source);
  const item = block.cells
    ?.flatMap((cell) => cell.items)
    .find((candidate) => candidate.id === itemId);
  if (!item || block.cells?.some((cell) => cell.id === targetCellId && cell.items.includes(item))) {
    return block;
  }
  return syncColumnFallbacks(
    block,
    (block.cells ?? []).map((cell) => ({
      ...cell,
      items:
        cell.id === targetCellId
          ? [...cell.items, item]
          : cell.items.filter((candidate) => candidate.id !== itemId),
    })),
  );
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
