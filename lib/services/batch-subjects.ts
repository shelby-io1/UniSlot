import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db";
import { auditLogs, batches, batchSubjects, subjects } from "../db/schema";
import { AdminError } from "./admin";

export type BatchSubjectRow = {
  id: number;
  batchId: number;
  subjectId: number;
};

/** All batch→subject assignments, ordered for stable rendering. */
export async function listBatchSubjects(db: Database): Promise<BatchSubjectRow[]> {
  return db
    .select({
      id: batchSubjects.id,
      batchId: batchSubjects.batchId,
      subjectId: batchSubjects.subjectId,
    })
    .from(batchSubjects)
    .orderBy(batchSubjects.batchId, batchSubjects.subjectId);
}

function positiveInt(value: unknown, label: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AdminError(`${label} must be a positive integer`);
  return n;
}

/**
 * Assigns one or more subjects to a batch. Validates that the batch and every
 * subject exist, is idempotent (existing pairs are left untouched) and writes
 * an audit entry. Returns the rows that were newly inserted.
 */
export async function assignSubjectsToBatch(
  db: Database,
  batchIdRaw: unknown,
  subjectIdsRaw: unknown,
  actor: string,
): Promise<BatchSubjectRow[]> {
  const batchId = positiveInt(batchIdRaw, "batchId");
  const rawList = Array.isArray(subjectIdsRaw) ? subjectIdsRaw : [subjectIdsRaw];
  const subjectIds = Array.from(new Set(rawList.map((value) => positiveInt(value, "subjectId"))));
  if (subjectIds.length === 0) throw new AdminError("At least one subjectId is required");

  return db.transaction(async (tx) => {
    const [batch] = await tx.select({ id: batches.id }).from(batches).where(eq(batches.id, batchId));
    if (!batch) throw new AdminError("batchId does not reference an existing batch");

    const found = await tx
      .select({ id: subjects.id })
      .from(subjects)
      .where(inArray(subjects.id, subjectIds));
    if (found.length !== subjectIds.length) {
      const known = new Set(found.map((row) => row.id));
      const missing = subjectIds.filter((id) => !known.has(id));
      throw new AdminError(`Unknown subjectId(s): ${missing.join(", ")}`);
    }

    const inserted = (await tx
      .insert(batchSubjects)
      .values(subjectIds.map((subjectId) => ({ batchId, subjectId, source: "admin" })))
      .onConflictDoNothing()
      .returning({
        id: batchSubjects.id,
        batchId: batchSubjects.batchId,
        subjectId: batchSubjects.subjectId,
      })) as BatchSubjectRow[];

    await tx.insert(auditLogs).values({
      action: "admin.assign",
      entity: "batch_subjects",
      entityId: String(batchId),
      actor,
      detail: { batchId, subjectIds, inserted: inserted.length },
    });

    return inserted;
  });
}

/** Removes a single subject from a batch. Returns false when it was not assigned. */
export async function unassignSubjectFromBatch(
  db: Database,
  batchIdRaw: unknown,
  subjectIdRaw: unknown,
  actor: string,
): Promise<boolean> {
  const batchId = positiveInt(batchIdRaw, "batchId");
  const subjectId = positiveInt(subjectIdRaw, "subjectId");

  return db.transaction(async (tx) => {
    const deleted = (await tx
      .delete(batchSubjects)
      .where(and(eq(batchSubjects.batchId, batchId), eq(batchSubjects.subjectId, subjectId)))
      .returning({ id: batchSubjects.id })) as { id: number }[];

    if (deleted.length === 0) return false;

    await tx.insert(auditLogs).values({
      action: "admin.unassign",
      entity: "batch_subjects",
      entityId: String(batchId),
      actor,
      detail: { batchId, subjectId },
    });

    return true;
  });
}
