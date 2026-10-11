import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import {
  academicTerms,
  auditLogs,
  batches,
  classSessions,
  periods,
  rooms,
  subjects,
  teachers,
  workingDays,
} from "@/lib/db/schema";
import { detectClashesInSessions, type ClashSession } from "@/lib/services/clashes";

/**
 * Phase 5 resolution commit. Applies approved solver moves atomically.
 *
 * The whole flow is one transaction:
 * 1. Row lock the moved sessions and compare their current placement with the
 *    `expected` placement the solver built from — an optimistic version check.
 * 2. Apply the moves.
 * 3. Re-run full-term clash detection on the *resulting* schedule (case M of
 *    the test matrix): if any clash still involves a moved session, abort.
 * 4. Write an `audit_logs` entry.
 *
 * Any failure rolls the transaction back, so a resolution is never applied
 * half-way and never introduces a new clash.
 */

export class ResolutionConflict extends Error {
  constructor(
    message: string,
    readonly code: "version" | "clash" | "invalid",
  ) {
    super(message);
    this.name = "ResolutionConflict";
  }
}

export type Move = {
  sessionId: number;
  dayIndex: number;
  periodId: number;
  roomId: number | null;
};

export type ExpectedPlacement = Omit<Move, "sessionId">;

export type ResolutionOptions = {
  moves: Move[];
  /** Current placement of each moved session, as observed when previewing. */
  expected: Record<number, ExpectedPlacement>;
  termId?: number;
  actor?: string;
};

/** The transaction handle drizzle passes to `db.transaction` callbacks. */
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function findActiveTermId(tx: Tx): Promise<number | null> {
  const [term] = await tx
    .select({ id: academicTerms.id })
    .from(academicTerms)
    .where(eq(academicTerms.isActive, true))
    .orderBy(asc(academicTerms.id))
    .limit(1);
  return term?.id ?? null;
}

async function loadTermSessions(tx: Tx, termId: number): Promise<{ sessions: ClashSession[]; dayNames: string[] }> {
  const rows = await tx
    .select({
      id: classSessions.id,
      dayIndex: classSessions.dayIndex,
      periodId: classSessions.periodId,
      periodLabel: periods.label,
      startMinutes: periods.startMinutes,
      endMinutes: periods.endMinutes,
      batchId: classSessions.batchId,
      batchLabel: batches.label,
      subjectId: classSessions.subjectId,
      subjectTitle: subjects.title,
      roomId: classSessions.roomId,
      roomName: rooms.name,
      teacherId: classSessions.teacherId,
      teacherName: teachers.name,
      isRepeater: classSessions.isRepeater,
    })
    .from(classSessions)
    .innerJoin(batches, eq(classSessions.batchId, batches.id))
    .innerJoin(subjects, eq(classSessions.subjectId, subjects.id))
    .innerJoin(periods, eq(classSessions.periodId, periods.id))
    .leftJoin(rooms, eq(classSessions.roomId, rooms.id))
    .leftJoin(teachers, eq(classSessions.teacherId, teachers.id))
    .where(eq(classSessions.termId, termId))
    .orderBy(asc(classSessions.dayIndex), asc(periods.sortOrder), asc(classSessions.id));

  const dayRows = await tx
    .select({ name: workingDays.name })
    .from(workingDays)
    .orderBy(asc(workingDays.sortOrder));

  return {
    sessions: rows.map((r) => ({ ...r })),
    dayNames: dayRows.map((d) => d.name),
  };
}

export async function applyResolution(
  db: Database,
  opts: ResolutionOptions,
): Promise<{ applied: number; remainingClashes: number }> {
  if (!opts.moves.length) return { applied: 0, remainingClashes: 0 };

  return db.transaction(async (tx) => {
    const termId = opts.termId ?? (await findActiveTermId(tx));
    if (termId === null) throw new ResolutionConflict("no active term to resolve", "invalid");

    const ids = opts.moves.map((m) => m.sessionId);
    if (new Set(ids).size !== ids.length) {
      throw new ResolutionConflict("duplicate session id in moves", "invalid");
    }

    const rows = await tx
      .select({ id: classSessions.id, dayIndex: classSessions.dayIndex, periodId: classSessions.periodId, roomId: classSessions.roomId })
      .from(classSessions)
      .where(and(eq(classSessions.termId, termId), inArray(classSessions.id, ids)))
      .for("update");

    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) throw new ResolutionConflict(`session ${id} is not in term ${termId}`, "invalid");
      const expected = opts.expected[id];
      if (!expected) throw new ResolutionConflict(`session ${id} has no expected placement`, "invalid");
      if (
        expected.dayIndex !== row.dayIndex ||
        expected.periodId !== row.periodId ||
        (expected.roomId ?? null) !== row.roomId
      ) {
        throw new ResolutionConflict(`session ${id} changed since it was previewed`, "version");
      }
    }

    for (const m of opts.moves) {
      await tx
        .update(classSessions)
        .set({ dayIndex: m.dayIndex, periodId: m.periodId, roomId: m.roomId })
        .where(eq(classSessions.id, m.sessionId));
    }

    const { sessions, dayNames } = await loadTermSessions(tx, termId);
    const after = detectClashesInSessions(sessions, dayNames);
    const remainingInvolvingMoved = after.filter((c) => c.sessionIds.some((sid) => ids.includes(sid)));
    if (remainingInvolvingMoved.length > 0) {
      throw new ResolutionConflict(
        `revalidation failed: ${remainingInvolvingMoved.length} clash(es) still involve a moved session`,
        "clash",
      );
    }

    await tx.insert(auditLogs).values({
      action: "resolution.apply",
      entity: "class_sessions",
      entityId: ids.join(","),
      actor: opts.actor ?? "admin",
      detail: { termId, moves: opts.moves, applied: ids.length, remainingTotal: after.length },
    });

    return { applied: ids.length, remainingClashes: after.length };
  });
}