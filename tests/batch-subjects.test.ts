import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { auditLogs, batches, subjects } from "@/lib/db/schema";
import { AdminError } from "@/lib/services/admin";
import {
  assignSubjectsToBatch,
  listBatchSubjects,
  unassignSubjectFromBatch,
} from "@/lib/services/batch-subjects";

function findUnassignedPair(
  batchIds: number[],
  subjectIds: number[],
  assigned: Set<string>,
): { batchId: number; subjectId: number } | undefined {
  for (const batchId of batchIds) {
    for (const subjectId of subjectIds) {
      if (!assigned.has(`${batchId}:${subjectId}`)) return { batchId, subjectId };
    }
  }
  return undefined;
}

describe("listBatchSubjects", () => {
  it("returns the mapping backfilled from the timetable", async () => {
    const db = await getDb();
    const rows = await listBatchSubjects(db);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.batchId > 0 && row.subjectId > 0)).toBe(true);
  });
});

describe("assignSubjectsToBatch", () => {
  it("assigns a subject to a batch, is idempotent and audits the change", async () => {
    const db = await getDb();
    const assigned = new Set(
      (await listBatchSubjects(db)).map((row) => `${row.batchId}:${row.subjectId}`),
    );
    const batchIds = (await db.select({ id: batches.id }).from(batches).orderBy(batches.id)).map(
      (row) => row.id,
    );
    const subjectIds = (
      await db.select({ id: subjects.id }).from(subjects).orderBy(subjects.id)
    ).map((row) => row.id);

    const pair = findUnassignedPair(batchIds, subjectIds, assigned);
    expect(pair).toBeDefined();

    const inserted = await assignSubjectsToBatch(db, pair!.batchId, [pair!.subjectId], "tester");
    expect(inserted).toHaveLength(1);

    const again = await assignSubjectsToBatch(db, pair!.batchId, [pair!.subjectId], "tester");
    expect(again).toHaveLength(0);

    const after = await listBatchSubjects(db);
    expect(
      after.filter((row) => row.batchId === pair!.batchId && row.subjectId === pair!.subjectId),
    ).toHaveLength(1);

    const audit = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(eq(auditLogs.entity, "batch_subjects"));
    expect(audit.length).toBeGreaterThan(0);
  });

  it("rejects unknown batches, unknown subjects and empty lists", async () => {
    const db = await getDb();
    const [batch] = await db.select({ id: batches.id }).from(batches).orderBy(batches.id).limit(1);

    await expect(assignSubjectsToBatch(db, batch.id, [987654321], "tester")).rejects.toBeInstanceOf(
      AdminError,
    );
    await expect(assignSubjectsToBatch(db, 987654321, [1], "tester")).rejects.toBeInstanceOf(
      AdminError,
    );
    await expect(assignSubjectsToBatch(db, batch.id, [], "tester")).rejects.toBeInstanceOf(
      AdminError,
    );
    await expect(assignSubjectsToBatch(db, "nope", [1], "tester")).rejects.toBeInstanceOf(
      AdminError,
    );
  });

  it("can assign several subjects at once", async () => {
    const db = await getDb();
    const assigned = new Set(
      (await listBatchSubjects(db)).map((row) => `${row.batchId}:${row.subjectId}`),
    );
    const [batch] = await db.select({ id: batches.id }).from(batches).orderBy(batches.id).limit(1);
    const subjectIds = (
      await db.select({ id: subjects.id }).from(subjects).orderBy(subjects.id)
    ).map((row) => row.id);
    const free = subjectIds.filter((id) => !assigned.has(`${batch.id}:${id}`)).slice(0, 3);
    expect(free.length).toBeGreaterThan(0);
    const inserted = await assignSubjectsToBatch(db, batch.id, free, "tester");
    expect(inserted).toHaveLength(free.length);
  });
});

describe("unassignSubjectFromBatch", () => {
  it("removes an assignment and reports already-missing ones", async () => {
    const db = await getDb();
    const [first] = await listBatchSubjects(db);
    expect(first).toBeDefined();

    expect(await unassignSubjectFromBatch(db, first.batchId, first.subjectId, "tester")).toBe(true);
    expect(await unassignSubjectFromBatch(db, first.batchId, first.subjectId, "tester")).toBe(false);

    const after = await listBatchSubjects(db);
    expect(after.some((row) => row.batchId === first.batchId && row.subjectId === first.subjectId)).toBe(
      false,
    );
  });
});
