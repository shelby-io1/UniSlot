import { existsSync } from "node:fs";
import { join } from "node:path";
import { connection } from "next/server";
import { json, serverError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { parseCatalogPages } from "@/lib/import/course-catalog";
import { loadPdfPages } from "@/lib/import/pdf-text";
import { applyCatalogImport, previewCatalogImport } from "@/lib/services/catalog-import";

export const maxDuration = 60;

function sourcePath(): string {
  const override = process.env.CATALOG_PDF_PATH;
  return override ?? join(process.cwd(), "course catalogs", "computer science.pdf");
}

async function parse(): Promise<ReturnType<typeof parseCatalogPages>> {
  const path = sourcePath();
  if (!existsSync(/* turbopackIgnore: true */ path)) {
    throw new Error(`Course catalog PDF not found at ${path}`);
  }
  const pages = await loadPdfPages(path);
  return parseCatalogPages(pages);
}

/**
 * GET /api/import/catalog
 * Dry-run: parses the catalog PDF and reports what would change, without writing.
 */
export async function GET() {
  await connection();
  try {
    const db = await getDb();
    const result = await parse();
    return json(await previewCatalogImport(db, result));
  } catch (error) {
    console.error("catalog preview failed", error);
    return serverError(error instanceof Error ? error.message : "Unable to preview import");
  }
}

/**
 * POST /api/import/catalog
 * Applies the catalog import inside a single transaction and records
 * job/errors/audit. Existing subjects are matched by code, then by title.
 */
export async function POST() {
  try {
    const db = await getDb();
    const result = await parse();
    return json(await applyCatalogImport(db, result));
  } catch (error) {
    console.error("catalog import failed", error);
    return serverError(error instanceof Error ? error.message : "Unable to apply import");
  }
}
