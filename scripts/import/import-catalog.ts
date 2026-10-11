import { existsSync } from "node:fs";
import { join } from "node:path";
import { closeDb, describeDriver, getDb } from "../../lib/db";
import { parseCatalogPages } from "../../lib/import/course-catalog";
import { loadPdfPages } from "../../lib/import/pdf-text";
import { applyCatalogImport, previewCatalogImport } from "../../lib/services/catalog-import";

function loadLocalEnv(): void {
  if (process.env.DATABASE_URL) return;
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
}

async function main() {
  loadLocalEnv();
  const apply = process.argv.includes("--apply");
  const src = join(process.cwd(), "course catalogs", "computer science.pdf");

  const pages = await loadPdfPages(src);
  const result = parseCatalogPages(pages);

  const db = await getDb();
  console.log("driver:", describeDriver().driver);

  if (apply) {
    const applied = await applyCatalogImport(db, result);
    console.log("applied:", applied);
  } else {
    const preview = await previewCatalogImport(db, result);
    console.log("preview:", preview);
  }

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
