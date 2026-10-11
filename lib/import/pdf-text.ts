import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfTextItem } from "./batchwise";

export type RawPage = { pageNumber: number; items: PdfTextItem[] };

/**
 * Reads every page of a PDF (given its file path) and returns the text items
 * with their raw coordinates. pdf.js is used without a worker, which is the
 * supported mode for Node/Vitest.
 */
export async function loadPdfPages(path: string): Promise<RawPage[]> {
  const data = new Uint8Array(readFileSync(path));
  const doc = await getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise;

  const pages: RawPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const raw of content.items) {
      const item = raw as { str?: unknown; transform?: unknown; fontName?: unknown };
      if (typeof item.str !== "string" || item.str.trim() === "") continue;
      const transform = Array.isArray(item.transform) ? (item.transform as number[]) : [];
      items.push({
        text: item.str,
        x: transform[4] ?? 0,
        y: transform[5] ?? 0,
        font: typeof item.fontName === "string" ? item.fontName : undefined,
      });
    }
    pages.push({ pageNumber: n, items });
  }
  return pages;
}
