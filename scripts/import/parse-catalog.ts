import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCatalogPages } from "../../lib/import/course-catalog";
import { loadPdfPages } from "../../lib/import/pdf-text";

async function main() {
  const src = process.argv[2] ?? join(process.cwd(), "course catalogs", "computer science.pdf");
  const pages = await loadPdfPages(src);
  const result = parseCatalogPages(pages);

  const codes = new Set(result.courses.map((c) => c.code));
  const categories = [...new Set(result.courses.map((c) => c.category).filter(Boolean))];
  const noCredits = result.courses.filter((c) => c.creditHours === null).length;

  console.log("pages:", pages.length);
  console.log("rows:", result.courses.length);
  console.log("unique codes:", codes.size);
  console.log("categories:", categories.length);
  for (const category of categories) console.log("  -", category);
  console.log("rows without parsed credit hours:", noCredits);
  console.log("issues:", result.issues.length);
  for (const issue of result.issues) console.log("  ", `p${issue.page}`, issue.code, issue.message);

  const outDir = join(process.cwd(), "data", "parsed");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "course-catalog.json"), JSON.stringify(result, null, 2), "utf8");
  console.log("wrote", join(outDir, "course-catalog.json"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
