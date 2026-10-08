import type { DocumentBlock, DocumentColumnCell, DocumentColumnItem } from "@quantum-crm/contracts";

export type ColumnsBlock = Extract<DocumentBlock, { readonly type: "COLUMNS" }>;
export type TableBlock = Extract<DocumentBlock, { readonly type: "TABLE" }>;
export type DocumentColumnLayout = ColumnsBlock["layout"];
export type DocumentColumnItemType = DocumentColumnItem["type"];
export type ImageResizeCorner = "NW" | "NE" | "SW" | "SE";
export type ImageResizeHandle = ImageResizeCorner | "N" | "E" | "S" | "W";

const minimumTableColumnWidth = 5;

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
      fontFamily: "INHERIT",
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
      widthPercent: 100,
      align: "CENTER",
      fit: "CONTAIN",
      aspectRatio: "AUTO",
      focalX: 50,
      focalY: 50,
      rotation: 0,
      opacity: 100,
      cornerRadius: 0,
      flow: "INLINE",
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

export function imageFrameWidth(
  image: Pick<Extract<DocumentBlock, { readonly type: "IMAGE" }>, "width" | "widthPercent">,
): number {
  if (image.widthPercent !== undefined) return image.widthPercent;
  return { FULL: 100, WIDE: 80, MEDIUM: 62, SMALL: 42 }[image.width];
}

export function resizeImageFrame(
  originWidth: number,
  horizontalDelta: number,
  availableWidth: number,
  handle: ImageResizeHandle,
): number {
  const safeAvailableWidth = Math.max(availableWidth, 1);
  const direction = handle.endsWith("E") ? 1 : -1;
  return Math.min(
    100,
    Math.max(
      10,
      Math.round(originWidth + (horizontalDelta / safeAvailableWidth) * 100 * direction),
    ),
  );
}

export function resizeImageFrameHeight(
  originHeight: number,
  verticalDelta: number,
  handle: ImageResizeHandle,
): number {
  const direction = handle.startsWith("N") ? -1 : 1;
  return Math.min(1200, Math.max(80, Math.round(originHeight + verticalDelta * direction)));
}

/**
 * Scales a complete image as one object. Unlike a crop frame, every handle keeps
 * the natural aspect ratio, so the selection always matches the visible pixels.
 */
export function resizeContainedImageFrame(
  originWidthPx: number,
  originHeightPx: number,
  horizontalDelta: number,
  verticalDelta: number,
  availableWidth: number,
  handle: ImageResizeHandle,
): number {
  const safeAvailableWidth = Math.max(availableWidth, 1);
  const safeOriginWidth = Math.max(originWidthPx, 1);
  const safeOriginHeight = Math.max(originHeightPx, 1);
  const aspectRatio = safeOriginWidth / safeOriginHeight;

  const horizontalWidth = handle.includes("E")
    ? safeOriginWidth + horizontalDelta
    : safeOriginWidth - horizontalDelta;
  const verticalHeight = handle.includes("S")
    ? safeOriginHeight + verticalDelta
    : safeOriginHeight - verticalDelta;
  const verticalWidth = verticalHeight * aspectRatio;

  const hasHorizontalAxis = handle.includes("E") || handle.includes("W");
  const hasVerticalAxis = handle.includes("N") || handle.includes("S");
  let nextWidth = safeOriginWidth;
  if (hasHorizontalAxis && hasVerticalAxis) {
    const horizontalScaleDelta = Math.abs(horizontalWidth - safeOriginWidth) / safeOriginWidth;
    const verticalScaleDelta = Math.abs(verticalWidth - safeOriginWidth) / safeOriginWidth;
    nextWidth = horizontalScaleDelta >= verticalScaleDelta ? horizontalWidth : verticalWidth;
  } else if (hasHorizontalAxis) {
    nextWidth = horizontalWidth;
  } else if (hasVerticalAxis) {
    nextWidth = verticalWidth;
  }

  const minimumWidth = Math.min(
    safeAvailableWidth,
    Math.max(safeAvailableWidth * 0.1, 80 * aspectRatio),
  );
  const boundedWidth = Math.min(safeAvailableWidth, Math.max(minimumWidth, nextWidth));
  return Math.round((boundedWidth / safeAvailableWidth) * 100);
}

export function moveImageFocalPoint(
  originX: number,
  originY: number,
  horizontalDelta: number,
  verticalDelta: number,
  frameWidth: number,
  frameHeight: number,
): { readonly x: number; readonly y: number } {
  return {
    x: Math.min(
      100,
      Math.max(0, Math.round(originX - (horizontalDelta / Math.max(frameWidth, 1)) * 100)),
    ),
    y: Math.min(
      100,
      Math.max(0, Math.round(originY - (verticalDelta / Math.max(frameHeight, 1)) * 100)),
    ),
  };
}

export function rotateImageFromPointer(
  originRotation: number,
  centerX: number,
  centerY: number,
  originPointerX: number,
  originPointerY: number,
  pointerX: number,
  pointerY: number,
): number {
  const originAngle = Math.atan2(originPointerY - centerY, originPointerX - centerX);
  const pointerAngle = Math.atan2(pointerY - centerY, pointerX - centerX);
  const degrees = originRotation + ((pointerAngle - originAngle) * 180) / Math.PI;
  return Math.round(((((degrees + 180) % 360) + 360) % 360) - 180);
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

function distributeTableWidths(weights: readonly number[], total = 100): number[] {
  if (weights.length === 0) return [];
  if (weights.length === 1) return [total];
  const distributable = total - minimumTableColumnWidth * weights.length;
  const safeWeights = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 1));
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0);
  const exactExtras = safeWeights.map((weight) => (weight / weightTotal) * distributable);
  const extras = exactExtras.map(Math.floor);
  let remainder = distributable - extras.reduce((sum, width) => sum + width, 0);
  const byFraction = exactExtras
    .map((width, index) => ({ index, fraction: width - Math.floor(width) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const candidate of byFraction) {
    if (remainder <= 0) break;
    extras[candidate.index] = (extras[candidate.index] ?? 0) + 1;
    remainder -= 1;
  }
  return extras.map((width) => width + minimumTableColumnWidth);
}

export function tableColumnWidths(block: TableBlock): number[] {
  if (
    block.columnWidths?.length === block.columns.length &&
    block.columnWidths.every((width) => Number.isInteger(width) && width >= 5) &&
    block.columnWidths.reduce((sum, width) => sum + width, 0) === 100
  ) {
    return [...block.columnWidths];
  }
  return distributeTableWidths(block.columns.map(() => 1));
}

export function normalizeTableBlock(block: TableBlock): TableBlock {
  if (block.locked) return block;
  const widths = tableColumnWidths(block);
  if (
    block.columnWidths?.length === widths.length &&
    block.columnWidths.every((width, index) => width === widths[index])
  ) {
    return block;
  }
  return { ...block, columnWidths: widths };
}

export function addTableRow(source: TableBlock, values: readonly string[] = []): TableBlock {
  if (source.locked || source.rows.length >= 100) return source;
  const row = source.columns.map((_, index) => values[index] ?? "");
  return { ...normalizeTableBlock(source), rows: [...source.rows, row] };
}

export function removeTableRow(source: TableBlock, rowIndex: number): TableBlock {
  if (source.locked || rowIndex < 0 || rowIndex >= source.rows.length) return source;
  return {
    ...normalizeTableBlock(source),
    rows: source.rows.filter((_, index) => index !== rowIndex),
  };
}

export function addTableColumn(source: TableBlock, label = "Nueva columna"): TableBlock {
  if (source.locked || source.columns.length >= 8) return source;
  const block = normalizeTableBlock(source);
  const currentWidths = tableColumnWidths(block);
  const newColumnWeight = Math.max(
    minimumTableColumnWidth,
    Math.round(100 / (source.columns.length + 1)),
  );
  return {
    ...block,
    columns: [...block.columns, label.trim() || "Nueva columna"],
    rows: block.rows.map((row) => [...row, ""]),
    columnWidths: distributeTableWidths([...currentWidths, newColumnWeight]),
  };
}

export function removeTableColumn(source: TableBlock, columnIndex: number): TableBlock {
  if (
    source.locked ||
    source.columns.length <= 1 ||
    columnIndex < 0 ||
    columnIndex >= source.columns.length
  ) {
    return source;
  }
  const block = normalizeTableBlock(source);
  return {
    ...block,
    columns: block.columns.filter((_, index) => index !== columnIndex),
    rows: block.rows.map((row) => row.filter((_, index) => index !== columnIndex)),
    columnWidths: distributeTableWidths(
      tableColumnWidths(block).filter((_, index) => index !== columnIndex),
    ),
  };
}

export function setTableColumnWidth(
  source: TableBlock,
  columnIndex: number,
  requestedWidth: number,
): TableBlock {
  if (
    source.locked ||
    columnIndex < 0 ||
    columnIndex >= source.columns.length ||
    !Number.isFinite(requestedWidth)
  ) {
    return source;
  }
  const block = normalizeTableBlock(source);
  if (block.columns.length === 1) return { ...block, columnWidths: [100] };
  const maximum = 100 - minimumTableColumnWidth * (block.columns.length - 1);
  const selectedWidth = Math.min(
    maximum,
    Math.max(minimumTableColumnWidth, Math.round(requestedWidth)),
  );
  const current = tableColumnWidths(block);
  const remainingIndexes = current
    .map((_, index) => index)
    .filter((index) => index !== columnIndex);
  const redistributed = distributeTableWidths(
    remainingIndexes.map((index) => current[index] ?? 1),
    100 - selectedWidth,
  );
  const widths = current.map((_, index) => {
    if (index === columnIndex) return selectedWidth;
    return redistributed[remainingIndexes.indexOf(index)] ?? minimumTableColumnWidth;
  });
  return { ...block, columnWidths: widths };
}

export function normalizeDocumentBlocks(blocks: readonly DocumentBlock[]): DocumentBlock[] {
  return blocks.map((block) => {
    if (block.type === "COLUMNS") return normalizeColumnsBlock(block);
    if (block.type === "TABLE") return normalizeTableBlock(block);
    return block;
  });
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
          fontFamily: block.fontFamily ?? "INHERIT",
          ...(block.fontSize === undefined ? {} : { fontSize: block.fontSize }),
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
