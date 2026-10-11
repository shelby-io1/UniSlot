// Extracts the embedded CUISlot dataset and logo from the saved reference page.
// Source: reference/cui-space-live.html (downloaded from https://cui-space.vercel.app/)
// Output: data/seed/cui-space-dataset.json, public/comsats-logo.jpg
// Run: node scripts/recon/extract-cui-space.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(resolve(root, "reference/cui-space-live.html"), "utf8");

function extractObjectLiteral(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${marker}`);
  const braceStart = src.indexOf("{", start);
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  throw new Error("unbalanced object literal");
}

function extractArrayLiteral(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${marker}`);
  const brStart = src.indexOf("[", start);
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let i = brStart; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return src.slice(brStart, i + 1);
    }
  }
  throw new Error("unbalanced array literal");
}

const D = new Function(`return (${extractObjectLiteral(html, "const D =")})`)();
const DAYS = new Function(`return (${extractArrayLiteral(html, "const DAYS =")})`)();
const TM = new Function(`return (${extractArrayLiteral(html, "const TM =")})`)();
const ST = new Function(`return (${extractArrayLiteral(html, "const ST =")})`)();

const dataset = {
  source: "reference/cui-space-live.html",
  sourceUrl: "https://cui-space.vercel.app/",
  timetableNote: "Timetable CUI Attock Campus w.e.f Sep 14, 2026",
  generatedAt: new Date().toISOString(),
  days: DAYS,
  periods: TM.map((t, i) => ({
    label: `L${i + 1}`,
    displayStart: t[0],
    displayEnd: t[1],
    startMinutes: ST[i][0],
    endMinutes: ST[i][1],
  })),
  batches: D.b,
  rooms: D.r,
  teachers: D.t,
  subjects: D.s,
  entries: D.e,
};

mkdirSync(resolve(root, "data/seed"), { recursive: true });
writeFileSync(
  resolve(root, "data/seed/cui-space-dataset.json"),
  JSON.stringify(dataset, null, 2),
  "utf8",
);

const logoMatch = html.match(/<img\s+src="data:image\/jpeg;base64,([A-Za-z0-9+/=]+)"/);
if (logoMatch) {
  mkdirSync(resolve(root, "public"), { recursive: true });
  writeFileSync(resolve(root, "public/comsats-logo.jpg"), Buffer.from(logoMatch[1], "base64"));
}

console.log(
  `Extracted: ${dataset.batches.length} batches, ${dataset.rooms.length} rooms, ` +
    `${dataset.teachers.length} teachers, ${dataset.subjects.length} subjects, ` +
    `${dataset.entries.length} entries`,
);
