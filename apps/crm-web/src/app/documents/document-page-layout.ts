/**
 * Deterministic page geometry for the document editor.
 *
 * This module deliberately receives block measurements in millimetres. Measuring
 * text, images or tables belongs to the renderer; doing so here would make the
 * persisted layout depend on a browser, zoom level or font-loading timing.
 */

export type DocumentPageSize = "A4" | "LETTER";

export interface DocumentPageMarginsMm {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface DocumentPageGeometry {
  readonly pageSize: DocumentPageSize;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly margins: DocumentPageMarginsMm;
  readonly contentWidthMm: number;
  readonly contentHeightMm: number;
}

export interface DocumentBlockBoxMm {
  readonly widthMm: number;
  readonly heightMm: number;
}

export interface DocumentBlockLayoutInput<T> {
  readonly id: string;
  readonly box: DocumentBlockBoxMm;
  /** Starts this block on the next page when a previous block already exists. */
  readonly breakBefore?: boolean;
  readonly value: T;
}

export interface ClampedDocumentBlockBox {
  readonly box: DocumentBlockBoxMm;
  readonly widthClamped: boolean;
  readonly heightClamped: boolean;
}

export interface PositionedDocumentBlock<T> {
  readonly id: string;
  readonly value: T;
  readonly box: DocumentBlockBoxMm;
  /** Position inside the physical sheet, measured from its upper-left corner. */
  readonly xMm: number;
  readonly yMm: number;
}

export interface DocumentLayoutPage<T> {
  readonly index: number;
  readonly blocks: readonly PositionedDocumentBlock<T>[];
  readonly usedContentHeightMm: number;
  readonly remainingContentHeightMm: number;
}

export interface PaginatedDocumentLayout<T> {
  readonly geometry: DocumentPageGeometry;
  readonly pages: readonly DocumentLayoutPage<T>[];
}

const pageDimensionsMm: Readonly<Record<DocumentPageSize, DocumentBlockBoxMm>> = {
  A4: { widthMm: 210, heightMm: 297 },
  LETTER: { widthMm: 215.9, heightMm: 279.4 },
};

const floatingPointToleranceMm = 0.000_001;

function normalizeMillimetres(value: number): number {
  // Paper geometry is authored in decimal millimetres. Normalizing at this
  // boundary prevents binary floating-point residue from changing layout
  // comparisons or making a physical Letter page appear microscopically
  // smaller than it is.
  return Number(value.toFixed(6));
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function assertPageMargins(margins: DocumentPageMarginsMm): void {
  for (const [side, value] of Object.entries(margins)) {
    if (!isNonNegativeFinite(value)) {
      throw new RangeError(`El margen ${side} debe ser un numero finito mayor o igual a cero.`);
    }
  }
}

function assertBlockBox(box: DocumentBlockBoxMm): void {
  if (!isPositiveFinite(box.widthMm) || !isPositiveFinite(box.heightMm)) {
    throw new RangeError("El bloque debe tener ancho y alto finitos mayores que cero.");
  }
}

function pageFor<T>(
  index: number,
  blocks: readonly PositionedDocumentBlock<T>[],
  usedContentHeightMm: number,
  contentHeightMm: number,
): DocumentLayoutPage<T> {
  return {
    index,
    blocks,
    usedContentHeightMm,
    remainingContentHeightMm: Math.max(0, contentHeightMm - usedContentHeightMm),
  };
}

/** Creates a physical sheet and its printable content box. */
export function createDocumentPageGeometry(
  pageSize: DocumentPageSize,
  margins: DocumentPageMarginsMm,
): DocumentPageGeometry {
  assertPageMargins(margins);
  const dimensions = pageDimensionsMm[pageSize];
  const contentWidthMm = normalizeMillimetres(dimensions.widthMm - margins.left - margins.right);
  const contentHeightMm = normalizeMillimetres(dimensions.heightMm - margins.top - margins.bottom);
  if (contentWidthMm <= 0 || contentHeightMm <= 0) {
    throw new RangeError("Los margenes deben dejar un area imprimible dentro de la hoja.");
  }

  return {
    pageSize,
    widthMm: dimensions.widthMm,
    heightMm: dimensions.heightMm,
    margins: { ...margins },
    contentWidthMm,
    contentHeightMm,
  };
}

/**
 * Restricts one already-measured block to the physical printable box. It uses
 * no editorial maximum: its only limits are the active paper size and margins.
 */
export function clampBlockToPrintableArea(
  box: DocumentBlockBoxMm,
  geometry: DocumentPageGeometry,
): ClampedDocumentBlockBox {
  assertBlockBox(box);
  const widthMm = Math.min(box.widthMm, geometry.contentWidthMm);
  const heightMm = Math.min(box.heightMm, geometry.contentHeightMm);
  return {
    box: { widthMm, heightMm },
    widthClamped: widthMm !== box.widthMm,
    heightClamped: heightMm !== box.heightMm,
  };
}

/**
 * Splits a stream of measured, indivisible blocks into physical pages.
 *
 * A caller must decide how a text/table block is measured or split before it
 * reaches this function. This keeps layout deterministic and prevents a
 * renderer from silently clipping oversized content.
 */
export function paginateDocumentBlocks<T>(
  inputs: readonly DocumentBlockLayoutInput<T>[],
  geometry: DocumentPageGeometry,
): PaginatedDocumentLayout<T> {
  const pages: DocumentLayoutPage<T>[] = [];
  let currentBlocks: PositionedDocumentBlock<T>[] = [];
  let usedContentHeightMm = 0;

  const commitCurrentPage = (): void => {
    pages.push(
      pageFor(pages.length + 1, currentBlocks, usedContentHeightMm, geometry.contentHeightMm),
    );
    currentBlocks = [];
    usedContentHeightMm = 0;
  };

  for (const input of inputs) {
    if (input.id.trim().length === 0) {
      throw new RangeError("Cada bloque paginado requiere un identificador.");
    }
    assertBlockBox(input.box);
    if (
      input.box.widthMm > geometry.contentWidthMm + floatingPointToleranceMm ||
      input.box.heightMm > geometry.contentHeightMm + floatingPointToleranceMm
    ) {
      throw new RangeError(
        `El bloque ${input.id} supera el area imprimible; debe ajustarse antes de paginarse.`,
      );
    }

    const needsExplicitPage = input.breakBefore === true && currentBlocks.length > 0;
    const needsPhysicalPage =
      currentBlocks.length > 0 &&
      usedContentHeightMm + input.box.heightMm >
        geometry.contentHeightMm + floatingPointToleranceMm;
    if (needsExplicitPage || needsPhysicalPage) commitCurrentPage();

    currentBlocks.push({
      id: input.id,
      value: input.value,
      box: { ...input.box },
      xMm: geometry.margins.left,
      yMm: geometry.margins.top + usedContentHeightMm,
    });
    usedContentHeightMm += input.box.heightMm;
  }

  if (currentBlocks.length > 0 || pages.length === 0) commitCurrentPage();
  return { geometry, pages };
}
