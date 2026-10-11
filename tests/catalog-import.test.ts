import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { auditLogs, importErrors, importJobs, subjects } from "@/lib/db/schema";
import type { CatalogCourse, CatalogParseResult } from "@/lib/import/course-catalog";
import { applyCatalogImport, previewCatalogImport } from "@/lib/services/catalog-import";

function course(over: Partial<CatalogCourse>): CatalogCourse {
  return {
    page: 1,
    category: "Core",
    serial: 1,
    code: "ZZ101",
    title: "Catalog Test Course",
    creditHours: 3,
    theoryHours: 2,
    labHours: 1,
    rawCredits: "3(2, 1)",
    coRequisites: null,
    prerequisites: null,
    ...over,
  };
}

function makeResult(courses: CatalogCourse[]): CatalogParseResult {
  return {
    courses,
    issues: [
      { page: 1, level: "warning", code: "conflicting-course", message: "conflicting course" },
    ],
  };
}

const sample = makeResult([
  course({ code: "ZZ101", title: "Catalog Test Course A" }),
  course({ code: "ZZ102", title: "Catalog Test Course B" }),
  course({ code: "ZZ101", title: "Duplicate code variant" }),
  course({ code: "ZZ103", title: "" }),
]);

describe("previewCatalogImport", () => {
  it("counts unique codes, matched, new and skipped rows", async () => {
    const db = await getDb();
    const preview = await previewCatalogImport(db, sample);
    expect(preview).toMatchObject({
      total: 4,
      uniqueCodes: 3,
      matched: 0,
      create: 2,
      skipped: 1,
    });
    expect(preview.issues).toHaveLength(1);
  });

  it("does not write anything", async () => {
    const db = await getDb();
    const [before] = await db.select({ n: count() }).from(importJobs);
    await previewCatalogImport(db, sample);
    const [after] = await db.select({ n: count() }).from(importJobs);
    expect(after.n).toBe(before.n);
  });
});

describe("applyCatalogImport", () => {
  it("creates subjects, then is idempotent on re-run", async () => {
    const db = await getDb();

    const first = await applyCatalogImport(db, sample);
    expect(first).toMatchObject({ created: 2, updated: 0, skipped: 1, issues: 1 });

    const afterApply = await previewCatalogImport(db, sample);
    expect(afterApply).toMatchObject({ matched: 2, create: 0 });

    const second = await applyCatalogImport(db, sample);
    expect(second).toMatchObject({ created: 0, updated: 2 });
  });

  it("updates an existing subject matched by title", async () => {
    const db = await getDb();
    const [seedSubject] = await db.select().from(subjects).limit(1);

    const result = makeResult([
      course({
        code: "ZZ999",
        title: seedSubject.title,
        creditHours: 4,
        theoryHours: 3,
        labHours: 1,
      }),
    ]);
    const applied = await applyCatalogImport(db, result);
    expect(applied).toMatchObject({ created: 0, updated: 1 });

    const [updatedSubject] = await db
      .select()
      .from(subjects)
      .where(eq(subjects.code, "ZZ999"));
    expect(updatedSubject.id).toBe(seedSubject.id);
    expect(updatedSubject.creditHours).toBe(4);
  });

  it("records import errors and an audit log entry", async () => {
    const db = await getDb();
    const [beforeErrors] = await db.select({ n: count() }).from(importErrors);
    const [beforeAudits] = await db.select({ n: count() }).from(auditLogs);

    await applyCatalogImport(db, sample);

    const [afterErrors] = await db.select({ n: count() }).from(importErrors);
    const [afterAudits] = await db.select({ n: count() }).from(auditLogs);
    expect(afterErrors.n).toBe(beforeErrors.n + 1);
    expect(afterAudits.n).toBe(beforeAudits.n + 1);
  });
});
