import { existsSync } from "node:fs";
import { join } from "node:path";
import { connection } from "next/server";
import { json, serverError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { parseBatchwisePages } from "@/lib/import/batchwise";
import { loadPdfPages } from "@/lib/import/pdf-text";
import { applyBatchwiseImport, previewBatchwiseImport } from "@/lib/services/import";

export const maxDuration = 60;

function sourcePath(): string {
  const override = process.env.BATCHWISE_PDF_PATH;
  return override ?? join(process.cwd(), "data", "source", "Batchwise.pdf");
}

async function parse(): Promise<ReturnType<typeof parseBatchwisePages>> {
  const path = sourcePath();
  if (!existsSync(/* turbopackIgnore: true */ path)) {
    throw new Error(`Batchwise source PDF not found at ${path}`);
  }
  const pages = await loadPdfPages(path);
  return parseBatchwisePages(pages);
}

/**
 * GET /api/import/batchwise
 * Dry-run: parses the source PDF and reports what would change, without writing.
 */
export async function GET() {
  await connection();
  try {
    const db = await getDb();
    const result = await parse();
    return json(await previewBatchwiseImport(db, result));
  } catch (error) {
    console.error("batchwise preview failed", error);
    return serverError(error instanceof Error ? error.message : "Unable to preview import");
  }
}

/**
 * POST /api/import/batchwise
 * Applies the import inside a single transaction and records job/errors/audit.
 */
export async function POST() {
  try {
    const db = await getDb();
    const result = await parse();
    return json(await applyBatchwiseImport(db, result));
  } catch (error) {
    console.error("batchwise import failed", error);
    return serverError(error instanceof Error ? error.message : "Unable to apply import");
  }
}
