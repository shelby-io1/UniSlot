import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const src = process.argv[2] ?? join(root, "data", "source", "Batchwise.pdf");
const outDir = join(root, "data", "inspect");
mkdirSync(outDir, { recursive: true });
const stem = basename(src).replace(/\.pdf$/i, "").replace(/\s+/g, "-");

const data = new Uint8Array(readFileSync(src));
const doc = await pdfjs.getDocument({
  data,
  useSystemFonts: true,
  isEvalSupported: false,
  useWorkerFetch: false,
}).promise;

console.log("pages:", doc.numPages);

if (process.argv[3] === "all") {
  const lines = [];
  const markers = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const c = await p.getTextContent();
    const items = c.items
      .filter((it) => "str" in it && it.str.trim() !== "")
      .map((it) => ({
        text: it.str,
        x: Math.round(it.transform[4] * 100) / 100,
        y: Math.round(it.transform[5] * 100) / 100,
        font: it.fontName,
      }));
    items.sort((a, b) => (Math.abs(a.y - b.y) > 3 ? b.y - a.y : a.x - b.x));
    const title = items.find((i) => i.y > 520 && i.y < 590);
    lines.push(`\n===== PAGE ${n} :: ${title ? title.text : "?"} =====`);
    for (const i of items) lines.push(`y=${String(i.y).padStart(7)} x=${String(i.x).padStart(7)} ${i.font}  ${JSON.stringify(i.text)}`);
    for (const i of items) {
      if (/repeat|lab\s*group|\bGP\b|group/i.test(i.text)) markers.push(`p${n} ${i.font} ${i.text}`);
    }
  }
  writeFileSync(join(outDir, `${stem}-all.txt`), lines.join("\n"), "utf8");
  console.log("markers:\n" + markers.join("\n"));
  console.log("\nwrote", join(outDir, `${stem}-all.txt`));
  process.exit(0);
}

const pageArg = process.argv[3] ? Number(process.argv[3]) : 1;
const page = await doc.getPage(pageArg);
const viewport = page.getViewport({ scale: 1 });
console.log("page", pageArg, "viewport:", viewport.width, "x", viewport.height);

const content = await page.getTextContent();
const items = content.items
  .filter((it) => "str" in it && it.str.trim() !== "")
  .map((it) => {
    const t = it.transform;
    return {
      text: it.str,
      x: Math.round(t[4] * 100) / 100,
      y: Math.round(t[5] * 100) / 100,
      w: Math.round(it.width * 100) / 100,
      h: Math.round(it.height * 100) / 100,
      font: it.fontName,
    };
  });

console.log("items:", items.length);
const dump = items
  .sort((p, q) => (Math.abs(p.y - q.y) > 3 ? q.y - p.y : p.x - q.x))
  .map((i) => `y=${String(i.y).padStart(7)} x=${String(i.x).padStart(7)} w=${String(i.w).padStart(7)} ${i.font}  ${JSON.stringify(i.text)}`)
  .join("\n");
writeFileSync(join(outDir, `${stem}-page-${pageArg}.txt`), dump, "utf8");
console.log(dump.split("\n").slice(0, 60).join("\n"));
console.log("...\nwrote", join(outDir, `${stem}-page-${pageArg}.txt`));
