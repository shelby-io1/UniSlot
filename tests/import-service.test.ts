import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { auditLogs, importErrors, importJobs, programs } from "@/lib/db/schema";
import type { BatchwiseParseResult, ParsedSession } from "@/lib/import/batchwise";
import { applyBatchwiseImport, previewBatchwiseImport } from "@/lib/services/import";

const TERM = "Import Test Term";

function session(over: Partial<ParsedSession>): ParsedSession {
  return {
    page: 1,
    batchLabel: "ZZ(IMPORT)-I",
    day: "Mon",
    dayIndex: 0,
    column: 0,
    subject: "Import Test Subject",
    teacher: "Dr. Import",
    room: "Import CR",
    isRepeater: false,
    labGroup: null,
    unresolved: null,
    ...over,
  };
}

function makeResult(sessions: ParsedSession[]): BatchwiseParseResult {
  return {
    term: TERM,
    pageCount: 1,
    sessions,
    issues: [
      { page: 1, level: "warning", code: "unresolved-marker", message: "ambiguous marker" },
    ],
  };
}

const importable = [
  session({ dayIndex: 0, column: 0 }),
  session({ dayIndex: 1, column: 2, isRepeater: true }),
];
const skipped = [
  session({ dayIndex: 2, unresolved: "AS" }),
  session({ dayIndex: 3, subject: "" }),
  session({ dayIndex: 4, column: 99 }),
];

describe("previewBatchwiseImport", () => {
  it("counts importable, skipped and new sessions on a fresh database", async () => {
    const db = await getDb();
    const preview = await previewBatchwiseImport(db, makeResult([...importable, ...skipped]));

    expect(preview.term).toBe(TERM);
    expect(preview.sessions).toEqual({ total: 5, existing: 0, new: 2, skipped: 3 });
    expect(preview.subjects.total).toBe(1);
    expect(preview.rooms.total).toBe(1);
    expect(preview.teachers.total).toBe(1);
    expect(preview.issues).toHaveLength(1);
  });

  it("does not write anything", async () => {
    const db = await getDb();
    const before = await db.select({ id: importJobs.id }).from(importJobs);
    await previewBatchwiseImport(db, makeResult(importable));
    const after = await db.select({ id: importJobs.id }).from(importJobs);
    expect(after.length).toBe(before.length);
  });
});

describe("applyBatchwiseImport", () => {
  it("creates the term, entities and sessions, then is idempotent", async () => {
    const db = await getDb();
    const result = makeResult([...importable, ...skipped]);

    const first = await applyBatchwiseImport(db, result);
    expect(first.termCreated).toBe(true);
    expect(first.sessions).toBe(2);
    expect(first.skipped).toBe(3);
    expect(first.batches).toBeGreaterThan(0);

    const afterApply = await previewBatchwiseImport(db, result);
    expect(afterApply.sessions).toEqual({ total: 5, existing: 2, new: 0, skipped: 3 });

    const second = await applyBatchwiseImport(db, result);
    expect(second.termCreated).toBe(false);
    expect(second.sessions).toBe(0);

    const jobCount = (await db.select({ id: importJobs.id }).from(importJobs)).length;
    expect(jobCount).toBeGreaterThanOrEqual(2);
  });

  it("records import errors and an audit log entry", async () => {
    const db = await getDb();
    const beforeErrors = (await db.select({ id: importErrors.id }).from(importErrors)).length;
    const beforeAudits = (await db.select({ id: auditLogs.id }).from(auditLogs)).length;

    await applyBatchwiseImport(db, makeResult(importable));

    const afterErrors = (await db.select({ id: importErrors.id }).from(importErrors)).length;
    const afterAudits = (await db.select({ id: auditLogs.id }).from(auditLogs)).length;
    expect(afterErrors).toBe(beforeErrors + 1);
    expect(afterAudits).toBe(beforeAudits + 1);
  });

  it("creates missing programs for new batch labels", async () => {
    const db = await getDb();
    const before = (await db.select({ id: programs.id }).from(programs)).length;
    await applyBatchwiseImport(
      db,
      makeResult([session({ batchLabel: "ZZ(IMPORT2)-I", subject: "Fresh Subject" })]),
    );
    const after = (await db.select({ id: programs.id }).from(programs)).length;
    expect(after).toBeGreaterThan(before);
  });
});
