import { asc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import {
  batches,
  classSessions,
  periods,
  rooms,
  subjects,
  teachers,
  workingDays,
} from "@/lib/db/schema";
import { getActiveTermId } from "@/lib/services/timetable";
import { overlaps } from "@/lib/time";

/**
 * Entity-level schedule clash detection (Phase 4).
 *
 * A clash is two sessions on the same day whose period intervals overlap under
 * half-open semantics (`[start, end)`) and that contend for one of four
 * entities:
 *
 * - `batch`   — a cohort (batch) double-booked: affects every student in it.
 * - `course`  — the same subject placed twice for the same batch (a duplicated
 *               offering), which is a data-integrity clash on the course itself.
 * - `teacher` — a teacher assigned to two overlapping sessions.
 * - `room`    — a room hosting two overlapping sessions.
 *
 * A single pair of sessions can raise more than one clash (for example, a batch
 * and a course clash); every clash is reported, never suppressed. Repeater
 * sessions take part like any other session, and a clash that involves at least
 * one repeater is flagged (`repeats`) so repeat-driven clashes are
 * distinguishable. There are no student entities: a batch clash simply stands
 * for everyone in that batch.
 *
 * Combined classes are respected. When one teacher teaches several batches
 * together, the source records one session per batch — all sharing the teacher,
 * room, day and period. Those are a single class, not a clash, so a teacher
 * clash requires the same teacher in *different rooms* and a room clash requires
 * the same room used by *different teachers*. (A single pair can therefore
 * never be both a teacher and a room clash.)
 */

export type ClashKind = "batch" | "course" | "teacher" | "room";

export const CLASH_KINDS: ClashKind[] = ["batch", "course", "teacher", "room"];

export type ClashSession = {
  id: number;
  dayIndex: number;
  periodId: number;
  periodLabel: string;
  startMinutes: number;
  endMinutes: number;
  batchId: number;
  batchLabel: string;
  subjectId: number;
  subjectTitle: string;
  roomId: number | null;
  roomName: string | null;
  teacherId: number | null;
  teacherName: string | null;
  isRepeater: boolean;
};

export type Clash = {
  kind: ClashKind;
  dayIndex: number;
  dayName: string;
  entityId: number;
  entityLabel: string;
  /** The ids of the two sessions that clash, lowest first. */
  sessionIds: number[];
  /** True when at least one of the clashing sessions is a repeater. */
  repeats: boolean;
  message: string;
};

export type ClashReport = {
  termId: number | null;
  sessionsChecked: number;
  clashes: Clash[];
  counts: Record<ClashKind, number>;
};

const KIND_NOUN: Record<ClashKind, string> = {
  batch: "Batch",
  course: "Course",
  teacher: "Teacher",
  room: "Room",
};

/** The grouping key for a session under `kind`, or null when inapplicable. */
function entityKey(kind: ClashKind, s: ClashSession): string | null {
  switch (kind) {
    case "batch":
      return `${s.dayIndex}:${s.batchId}`;
    case "course":
      return `${s.dayIndex}:${s.batchId}:${s.subjectId}`;
    case "teacher":
      return s.teacherId === null ? null : `${s.dayIndex}:${s.teacherId}`;
    case "room":
      return s.roomId === null ? null : `${s.dayIndex}:${s.roomId}`;
  }
}

/** The id of the contended entity (subject id for a course clash). */
function entityId(kind: ClashKind, s: ClashSession): number {
  switch (kind) {
    case "batch":
      return s.batchId;
    case "course":
      return s.subjectId;
    case "teacher":
      return s.teacherId as number;
    case "room":
      return s.roomId as number;
  }
}

/** A human label for the contended entity. */
function entityLabel(kind: ClashKind, s: ClashSession): string {
  switch (kind) {
    case "batch":
      return s.batchLabel;
    case "course":
      return `${s.subjectTitle} · ${s.batchLabel}`;
    case "teacher":
      return s.teacherName ?? `Teacher ${s.teacherId}`;
    case "room":
      return s.roomName ?? `Room ${s.roomId}`;
  }
}

/**
 * Whether two sessions genuinely contend for `kind`'s entity. Two sessions
 * sharing the same teacher *and* room (same day and period) are one combined
 * class, so they do not contend for either the teacher or the room.
 */
function contends(kind: ClashKind, a: ClashSession, b: ClashSession): boolean {
  switch (kind) {
    case "teacher":
      return !(a.roomId !== null && a.roomId === b.roomId);
    case "room":
      return !(a.teacherId !== null && a.teacherId === b.teacherId);
    default:
      return true;
  }
}

function describeSession(s: ClashSession): string {
  const place = s.roomName ?? "no room";
  return `${s.subjectTitle} (${s.periodLabel}, ${place})`;
}

/**
 * Pure half-open clash detection over already-resolved sessions. Kept free of
 * database access so it is exhaustively unit-testable.
 */
export function detectClashesInSessions(
  sessions: ClashSession[],
  dayNames: string[] = [],
): Clash[] {
  const byDay = [...sessions].sort(
    (a, b) => a.dayIndex - b.dayIndex || a.startMinutes - b.startMinutes || a.id - b.id,
  );

  const clashes: Clash[] = [];

  for (const kind of CLASH_KINDS) {
    const groups = new Map<string, ClashSession[]>();
    for (const s of byDay) {
      const key = entityKey(kind, s);
      if (key === null) continue;
      const list = groups.get(key);
      if (list) list.push(s);
      else groups.set(key, [s]);
    }

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];
          if (b.startMinutes >= a.endMinutes) break;
          if (!overlaps(a.startMinutes, a.endMinutes, b.startMinutes, b.endMinutes)) continue;
          if (!contends(kind, a, b)) continue;
          const [first, second] = a.id <= b.id ? [a, b] : [b, a];
          clashes.push({
            kind,
            dayIndex: a.dayIndex,
            dayName: dayNames[a.dayIndex] ?? `Day ${a.dayIndex + 1}`,
            entityId: entityId(kind, a),
            entityLabel: entityLabel(kind, a),
            sessionIds: [first.id, second.id],
            repeats: a.isRepeater || b.isRepeater,
            message:
              `${KIND_NOUN[kind]} clash on ${dayNames[a.dayIndex] ?? `Day ${a.dayIndex + 1}`}: ` +
              `${entityLabel(kind, a)} — ${describeSession(first)} overlaps ${describeSession(second)}`,
          });
        }
      }
    }
  }

  const kindRank = (k: ClashKind) => CLASH_KINDS.indexOf(k);
  clashes.sort(
    (a, b) =>
      a.dayIndex - b.dayIndex ||
      kindRank(a.kind) - kindRank(b.kind) ||
      a.entityId - b.entityId ||
      a.sessionIds[0] - b.sessionIds[0],
  );

  return clashes;
}

function emptyCounts(): Record<ClashKind, number> {
  return { batch: 0, course: 0, teacher: 0, room: 0 };
}

/** Loads a term's sessions (resolved with labels) plus ordered day names. */
export async function loadTermSessions(
  db: Database,
  termId: number,
): Promise<{ sessions: ClashSession[]; dayNames: string[] }> {
  const rows = await db
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

  const dayRows = await db
    .select({ name: workingDays.name })
    .from(workingDays)
    .orderBy(asc(workingDays.sortOrder));

  return {
    sessions: rows.map((r) => ({ ...r })),
    dayNames: dayRows.map((d) => d.name),
  };
}

/** Loads the active term's sessions and reports every clash found. */
export async function detectClashes(db: Database, termId?: number): Promise<ClashReport> {
  const resolvedTermId = termId ?? (await getActiveTermId(db));
  if (resolvedTermId === null) {
    return { termId: null, sessionsChecked: 0, clashes: [], counts: emptyCounts() };
  }

  const { sessions, dayNames } = await loadTermSessions(db, resolvedTermId);
  const clashes = detectClashesInSessions(sessions, dayNames);

  const counts = emptyCounts();
  for (const c of clashes) counts[c.kind]++;

  return { termId: resolvedTermId, sessionsChecked: sessions.length, clashes, counts };
}
