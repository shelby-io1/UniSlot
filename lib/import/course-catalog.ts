/**
 * Pure parser for the "Scheme of Studies" course-catalog PDF.
 *
 * The catalog is tabular: one row per course with columns Serial, Course Code,
 * Course Title, Credit Hours, Co-requisite(s) and Prerequisite(s), grouped under
 * category headings such as "Computing Core Courses". Like the timetable parser,
 * this module performs no I/O and only reads coordinates, so it is unit-testable.
 */

import type { PdfPage, PdfTextItem } from "./batchwise";

export type CatalogCourse = {
  page: number;
  category: string | null;
  serial: number | null;
  code: string;
  title: string;
  creditHours: number | null;
  theoryHours: number | null;
  labHours: number | null;
  rawCredits: string | null;
  coRequisites: string | null;
  prerequisites: string | null;
};

export type CatalogParseResult = {
  courses: CatalogCourse[];
  issues: import("./batchwise").ParsedIssue[];
};

const CODE_RE = /^[A-Z]{2,4}\d{3}$/;
const PLACEHOLDER_RE = /^X{3,}$/i;
const CREDITS_RE = /(\d+)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/;
const HEADER_RE = /^(Course Code|Course Title|Credit Hours|Co-?requisite\(?s\)?|Prerequisite\(?s\)?)$/i;

const CODE_X: [number, number] = [95, 130];
const SERIAL_X: [number, number] = [68, 95];
const TITLE_X: [number, number] = [180, 470];
const CREDITS_X: [number, number] = [490, 550];
const COREQ_X: [number, number] = [555, 668];
const PREREQ_X: [number, number] = [668, 803];

function inRange(x: number, [lo, hi]: [number, number]): boolean {
  return x >= lo && x <= hi;
}

/** Parses "3(2, 1)" into its total, theory and lab hours. */
export function parseCredits(raw: string): { total: number; theory: number; lab: number } | null {
  const match = raw.match(CREDITS_RE);
  if (!match) return null;
  return { total: Number(match[1]), theory: Number(match[2]), lab: Number(match[3]) };
}

function isHeading(item: PdfTextItem): boolean {
  const text = item.text.trim();
  if (text === "" || HEADER_RE.test(text)) return false;
  if (!(item.font ?? "").includes("f2")) return false;
  if (item.x < 55 || item.x > 92) return false;
  return /[A-Za-z]/.test(text);
}

export function parseCatalogPages(pages: PdfPage[]): CatalogParseResult {
  const courses: CatalogCourse[] = [];
  const issues: import("./batchwise").ParsedIssue[] = [];

  for (const page of pages) {
    const items = page.items;
    const headings = items.filter(isHeading);
    const categoryFor = (y: number): string | null => {
      let best: PdfTextItem | null = null;
      for (const heading of headings) {
        if (heading.y > y && (!best || heading.y < best.y)) best = heading;
      }
      return best ? best.text.replace(/\s+/g, " ").trim() : null;
    };

    for (const codeItem of items) {
      const code = codeItem.text.trim();
      if (!inRange(codeItem.x, CODE_X)) continue;
      if (!CODE_RE.test(code) && !PLACEHOLDER_RE.test(code)) continue;
      if (HEADER_RE.test(code)) continue;

      const y = codeItem.y;
      const sameRow = (rangeX: [number, number]) =>
        items.filter((i) => Math.abs(i.y - y) < 3 && inRange(i.x, rangeX));
      const joined = (rangeX: [number, number]) =>
        sameRow(rangeX)
          .sort((a, b) => a.x - b.x)
          .map((i) => i.text.trim())
          .filter(Boolean)
          .join(" ")
          .trim() || null;

      const title = joined(TITLE_X) ?? "";
      const rawCredits = joined(CREDITS_X);
      const credits = rawCredits ? parseCredits(rawCredits) : null;
      const serialText = sameRow(SERIAL_X)[0]?.text.trim() ?? "";
      const serial = /^\d{1,3}$/.test(serialText) ? Number(serialText) : null;
      const category = categoryFor(y);

      if (!title) {
        issues.push({ page: page.pageNumber, level: "warning", code: "missing-title", message: `${code}: no course title found` });
      }
      if (rawCredits && !credits) {
        issues.push({ page: page.pageNumber, level: "warning", code: "unparsed-credits", message: `${code}: could not parse credit hours "${rawCredits}"` });
      }
      if (PLACEHOLDER_RE.test(code)) {
        issues.push({ page: page.pageNumber, level: "warning", code: "placeholder-code", message: `${title || "(untitled)"}: placeholder course code "${code}"` });
      }

      courses.push({
        page: page.pageNumber,
        category,
        serial,
        code,
        title,
        creditHours: credits?.total ?? null,
        theoryHours: credits?.theory ?? null,
        labHours: credits?.lab ?? null,
        rawCredits,
        coRequisites: joined(COREQ_X),
        prerequisites: joined(PREREQ_X),
      });
    }
  }

  const byCode = new Map<string, CatalogCourse[]>();
  for (const course of courses) {
    const list = byCode.get(course.code) ?? [];
    list.push(course);
    byCode.set(course.code, list);
  }
  for (const [code, list] of byCode) {
    if (PLACEHOLDER_RE.test(code) || list.length < 2) continue;
    const titles = new Set(list.map((c) => c.title));
    const credits = new Set(list.map((c) => c.rawCredits));
    if (titles.size > 1 || credits.size > 1) {
      issues.push({
        page: list[0].page,
        level: "warning",
        code: "conflicting-course",
        message: `${code}: listed ${list.length} times with differing ${[
          titles.size > 1 ? "titles" : null,
          credits.size > 1 ? "credit hours" : null,
        ]
          .filter(Boolean)
          .join(" and ")}`,
      });
    }
  }

  return { courses, issues };
}
