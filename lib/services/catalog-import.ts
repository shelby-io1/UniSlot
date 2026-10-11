import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { auditLogs, importErrors, importJobs, subjects } from "../db/schema";
import type { CatalogCourse, CatalogParseResult } from "../import/course-catalog";

export type CatalogPreview = {
  source: string;
  total: number;
  uniqueCodes: number;
  matched: number;
  create: number;
  skipped: number;
  issues: import("../import/batchwise").ParsedIssue[];
};

export type CatalogApplyResult = {
  jobId: number;
  created: number;
  updated: number;
  skipped: number;
  issues: number;
};

type SubjectRow = typeof subjects.$inferSelect;
type CatalogValues = {
  code: string;
  title: string;
  creditHours: number | null;
  theoryHours: number | null;
  labHours: number | null;
  prerequisites: string | null;
  coRequisites: string | null;
  category: string | null;
};

const PLACEHOLDER_RE = /^X{3,}$/i;

/** Lowercases and strips punctuation so titles can be matched reliably. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function courseKey(course: CatalogCourse): string {
  return PLACEHOLDER_RE.test(course.code)
    ? `${course.code}#${normalizeTitle(course.title)}`
    : course.code;
}

function uniqueCourses(courses: CatalogCourse[]): {
  unique: CatalogCourse[];
  skipped: CatalogCourse[];
} {
  const seen = new Set<string>();
  const unique: CatalogCourse[] = [];
  const skipped: CatalogCourse[] = [];
  for (const course of courses) {
    if (course.title.trim() === "") {
      skipped.push(course);
      continue;
    }
    const key = courseKey(course);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(course);
  }
  return { unique, skipped };
}

function toValues(c: CatalogCourse): CatalogValues {
  return {
    code: c.code,
    title: c.title,
    creditHours: c.creditHours,
    theoryHours: c.theoryHours,
    labHours: c.labHours,
    prerequisites: c.prerequisites,
    coRequisites: c.coRequisites,
    category: c.category,
  };
}

function indexSubjects(rows: SubjectRow[]): {
  byCode: Map<string, SubjectRow>;
  byTitle: Map<string, SubjectRow>;
} {
  const byCode = new Map<string, SubjectRow>();
  const byTitle = new Map<string, SubjectRow>();
  for (const row of rows) {
    if (row.code) byCode.set(row.code, row);
    byTitle.set(normalizeTitle(row.title), row);
  }
  return { byCode, byTitle };
}

export async function previewCatalogImport(
  db: Database,
  result: CatalogParseResult,
): Promise<CatalogPreview> {
  const { unique, skipped } = uniqueCourses(result.courses);
  const existing = await db.select().from(subjects);

  const codes = new Set<string>();
  const titles = new Set<string>();
  for (const row of existing) {
    if (row.code) codes.add(row.code);
    titles.add(normalizeTitle(row.title));
  }

  let matched = 0;
  for (const course of unique) {
    const title = normalizeTitle(course.title);
    if (codes.has(course.code) || titles.has(title)) {
      matched++;
    } else {
      codes.add(course.code);
      titles.add(title);
    }
  }

  return {
    source: "computer science.pdf",
    total: result.courses.length,
    uniqueCodes: new Set(result.courses.map((c) => c.code)).size,
    matched,
    create: unique.length - matched,
    skipped: skipped.length,
    issues: result.issues,
  };
}

export async function applyCatalogImport(
  db: Database,
  result: CatalogParseResult,
): Promise<CatalogApplyResult> {
  return db.transaction(async (tx) => {
    const { unique, skipped } = uniqueCourses(result.courses);

    const existing = await tx.select().from(subjects);
    const { byCode, byTitle } = indexSubjects(existing);

    let created = 0;
    let updated = 0;
    for (const course of unique) {
      const values: CatalogValues = toValues(course);
      const target = byCode.get(course.code) ?? byTitle.get(normalizeTitle(course.title));
      if (target) {
        await tx.update(subjects).set(values).where(eq(subjects.id, target.id));
        if (!byCode.has(course.code)) byCode.set(course.code, target);
        updated++;
      } else {
        const row = (await tx.insert(subjects).values(values).returning())[0];
        byCode.set(course.code, row);
        byTitle.set(normalizeTitle(course.title), row);
        created++;
      }
    }

    const job = (
      await tx
        .insert(importJobs)
        .values({
          kind: "catalog",
          sourceName: "course catalogs/computer science.pdf",
          status: "completed",
          rowsTotal: result.courses.length,
          rowsImported: created + updated,
          rowsFailed: result.issues.length,
          notes: "BS Computer Science scheme of studies",
          finishedAt: new Date(),
        })
        .returning({ id: importJobs.id })
    )[0];

    if (result.issues.length > 0) {
      await tx.insert(importErrors).values(
        result.issues.map((issue) => ({
          jobId: job.id,
          page: issue.page,
          level: issue.level,
          code: issue.code,
          message: issue.message,
        })),
      );
    }

    await tx.insert(auditLogs).values({
      action: "import.catalog",
      entity: "import_jobs",
      entityId: String(job.id),
      actor: "admin",
      detail: { created, updated, skipped: skipped.length, issues: result.issues.length },
    });

    return {
      jobId: job.id,
      created,
      updated,
      skipped: skipped.length,
      issues: result.issues.length,
    };
  });
}
