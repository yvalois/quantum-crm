import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import type { AgentKnowledgeChunk } from "@quantum-crm/domain";

const maxPages = 100;
const maxTextBytes = 500_000;
const maxChunkLength = 2_000;

/** Extracts only page text; no image/OCR content enters the first RAG agent. */
export async function extractAgentCatalogChunks(
  bytes: Uint8Array,
): Promise<readonly AgentKnowledgeChunk[]> {
  if (bytes.byteLength < 100 || bytes.byteLength > 25 * 1024 * 1024) {
    throw new Error("Catalog PDF size is outside the supported range");
  }
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const document = await task.promise;
    if (document.numPages < 1 || document.numPages > maxPages) {
      throw new Error("Catalog PDF has an unsupported page count");
    }
    const chunks: AgentKnowledgeChunk[] = [];
    let totalTextBytes = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => ("str" in item && typeof item.str === "string" ? [item.str] : []))
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim();
      page.cleanup();
      totalTextBytes += Buffer.byteLength(text, "utf8");
      if (totalTextBytes > maxTextBytes) throw new Error("Catalog PDF text exceeds the limit");
      if (!text) continue;
      let ordinal = 1;
      for (let start = 0; start < text.length; start += maxChunkLength) {
        let end = Math.min(text.length, start + maxChunkLength);
        if (end < text.length) {
          const wordBoundary = text.lastIndexOf(" ", end);
          if (wordBoundary > start + maxChunkLength / 2) end = wordBoundary;
        }
        const part = text.slice(start, end).trim();
        if (part) chunks.push({ page: pageNumber, ordinal: ordinal++, text: part });
        start = end - maxChunkLength;
      }
    }
    if (chunks.length === 0 || chunks.length > 1_000) {
      throw new Error("Catalog PDF has no usable text or too many chunks");
    }
    return Object.freeze(chunks);
  } finally {
    await task.destroy();
  }
}
