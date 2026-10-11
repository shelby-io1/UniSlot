import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseBatchwisePages } from "../../lib/import/batchwise";
import { loadPdfPages } from "../../lib/import/pdf-text";

async function main() {
  const src = process.argv[2] ?? join(process.cwd(), "data", "source", "Batchwise.pdf");
  const pages = await loadPdfPages(src);
  const result = parseBatchwisePages(pages);

  const repeaters = result.sessions.filter((s) => s.isRepeater).length;
  const unresolved = result.sessions.filter((s) => s.unresolved).length;
  const withGroup = result.sessions.filter((s) => s.labGroup !== null).length;
  const batches = [...new Set(result.sessions.map((s) => s.batchLabel))];

  console.log("term:", result.term);
  console.log("pages:", result.pageCount);
  console.log("batches:", batches.length);
  console.log("sessions:", result.sessions.length);
  console.log("repeaters:", repeaters);
  console.log("lab-group sessions:", withGroup);
  console.log("unresolved:", unresolved);
  console.log("issues:", result.issues.length);
  for (const issue of result.issues.slice(0, 10)) console.log("  ", issue.page, issue.code, issue.message);
  for (const batch of batches.slice(0, 6)) {
    console.log("  sample batch:", batch, result.sessions.filter((s) => s.batchLabel === batch).length, "sessions");
  }

  const outDir = join(process.cwd(), "data", "parsed");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "batchwise.json"), JSON.stringify(result, null, 2), "utf8");
  console.log("wrote", join(outDir, "batchwise.json"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
