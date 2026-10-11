import { and, asc, eq, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import {
  academicTerms,
  batches,
  classSessions,
  periods,
  programs,
  rooms,
  subjects,
  teachers,
  workingDays,
} from "@/lib/db/schema";
import { formatMinutes } from "@/lib/time";

export type RoomGroup = "Lecture halls" | "Classrooms" | "Lecture theatres" | "Labs";

export const ROOM_GROUPS: RoomGroup[] = [
  "Lecture halls",
  "Classrooms",
  "Lecture theatres",
  "Labs",
];

/** Groups a room by its naming prefix, matching the source application. */
export function assignRoomGroup(name: string): RoomGroup {
  if (/^LH/.test(name)) return "Lecture halls";
  if (/^CR/.test(name)) return "Classrooms";
  if (/^LT/.test(name)) return "Lecture theatres";
  return "Labs";
}

export type ResolvedSession = {
  id: number;
  dayIndex: number;
  slot: number;
  periodLabel: string;
  startMinutes: number;
  endMinutes: number;
  batchId: number;
  batchLabel: string;
  roomId: number | null;
  roomName: string | null;
  teacherId: number | null;
  teacherName: string | null;
  subjectId: number;
  subjectTitle: string;
  isRepeater: boolean;
};

export type MetaRoom = { id: number; name: string; group: RoomGroup };
export type MetaTeacher = { id: number; name: string };
export type MetaBatch = { id: number; label: string; program: string; semesterNumber: number };
export type MetaPeriod = {
  id: number;
  label: string;
  sortOrder: number;
  startMinutes: number;
  endMinutes: number;
  displayStart: string;
  displayEnd: string;
};

export type Meta = {
  term: { id: number; name: string; startsOn: string | null; isActive: boolean } | null;
  days: string[];
  periods: MetaPeriod[];
  rooms: MetaRoom[];
  teachers: MetaTeacher[];
  batches: MetaBatch[];
  subjects: { id: number; title: string }[];
};

export async function getActiveTermId(db: Database): Promise<number | null> {
  const [term] = await db
    .select({ id: academicTerms.id })
    .from(academicTerms)
    .where(eq(academicTerms.isActive, true))
    .orderBy(asc(academicTerms.id))
    .limit(1);
  if (term) return term.id;
  const [any] = await db
    .select({ id: academicTerms.id })
    .from(academicTerms)
    .orderBy(asc(academicTerms.id))
    .limit(1);
  return any?.id ?? null;
}

export async function getMeta(db: Database): Promise<Meta> {
  const termId = await getActiveTermId(db);
  const [termRow] = termId
    ? await db.select().from(academicTerms).where(eq(academicTerms.id, termId))
    : [];

  const [dayRows, periodRows, roomRows, teacherRows, batchRows, subjectRows] = await Promise.all([
    db.select().from(workingDays).orderBy(asc(workingDays.sortOrder)),
    db.select().from(periods).orderBy(asc(periods.sortOrder)),
    db.select().from(rooms).orderBy(asc(rooms.id)),
    db.select().from(teachers).orderBy(asc(teachers.id)),
    db
      .select({
        id: batches.id,
        label: batches.label,
        semesterNumber: batches.semesterNumber,
        program: programs.code,
      })
      .from(batches)
      .innerJoin(programs, eq(batches.programId, programs.id))
      .orderBy(asc(batches.id)),
    db.select({ id: subjects.id, title: subjects.title }).from(subjects).orderBy(asc(subjects.id)),
  ]);

  return {
    term: termRow
      ? {
          id: termRow.id,
          name: termRow.name,
          startsOn: termRow.startsOn,
          isActive: termRow.isActive,
        }
      : null,
    days: dayRows.map((d) => d.name),
    periods: periodRows.map((p) => ({
      id: p.id,
      label: p.label,
      sortOrder: p.sortOrder,
      startMinutes: p.startMinutes,
      endMinutes: p.endMinutes,
      displayStart: formatMinutes(p.startMinutes),
      displayEnd: formatMinutes(p.endMinutes),
    })),
    rooms: roomRows.map((r) => ({ id: r.id, name: r.name, group: assignRoomGroup(r.name) })),
    teachers: teacherRows.map((t) => ({ id: t.id, name: t.name })),
    batches: batchRows,
    subjects: subjectRows,
  };
}

export type SessionFilter = { batchId?: number; teacherId?: number; dayIndex?: number };

async function loadSessionRows(db: Database, conditions: SQL[]): Promise<ResolvedSession[]> {
  const rows = await db
    .select({
      id: classSessions.id,
      dayIndex: classSessions.dayIndex,
      periodSort: periods.sortOrder,
      periodLabel: periods.label,
      startMinutes: periods.startMinutes,
      endMinutes: periods.endMinutes,
      batchId: classSessions.batchId,
      batchLabel: batches.label,
      roomId: classSessions.roomId,
      roomName: rooms.name,
      teacherId: classSessions.teacherId,
      teacherName: teachers.name,
      subjectId: classSessions.subjectId,
      subjectTitle: subjects.title,
      isRepeater: classSessions.isRepeater,
    })
    .from(classSessions)
    .innerJoin(batches, eq(classSessions.batchId, batches.id))
    .innerJoin(subjects, eq(classSessions.subjectId, subjects.id))
    .innerJoin(periods, eq(classSessions.periodId, periods.id))
    .leftJoin(rooms, eq(classSessions.roomId, rooms.id))
    .leftJoin(teachers, eq(classSessions.teacherId, teachers.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(classSessions.dayIndex), asc(periods.sortOrder));

  return rows.map((r) => ({
    id: r.id,
    dayIndex: r.dayIndex,
    slot: r.periodSort,
    periodLabel: r.periodLabel,
    startMinutes: r.startMinutes,
    endMinutes: r.endMinutes,
    batchId: r.batchId,
    batchLabel: r.batchLabel,
    roomId: r.roomId,
    roomName: r.roomName,
    teacherId: r.teacherId,
    teacherName: r.teacherName,
    subjectId: r.subjectId,
    subjectTitle: r.subjectTitle,
    isRepeater: r.isRepeater,
  }));
}

export async function getSessions(
  db: Database,
  filter: SessionFilter = {},
  termId?: number | null,
): Promise<ResolvedSession[]> {
  const activeTermId = termId === undefined ? await getActiveTermId(db) : termId;
  const conditions: SQL[] = [];
  if (activeTermId) conditions.push(eq(classSessions.termId, activeTermId));
  if (filter.batchId !== undefined) conditions.push(eq(classSessions.batchId, filter.batchId));
  if (filter.teacherId !== undefined)
    conditions.push(eq(classSessions.teacherId, filter.teacherId));
  if (filter.dayIndex !== undefined) conditions.push(eq(classSessions.dayIndex, filter.dayIndex));
  return loadSessionRows(db, conditions);
}

export type FreeLookup =
  | { ok: true; result: FreeResult }
  | { ok: false; reason: "day" | "period" };

/**
 * Resolves the free/busy lists for a single slot in two database round-trips:
 * the active term id, then the reference lists and that term's sessions in
 * parallel. Far cheaper than `getMeta` + `getSessions` for the "Now" views.
 */
export async function getFreeAvailability(
  db: Database,
  kind: "rooms" | "teachers",
  dayIndex: number,
  slot: number,
): Promise<FreeLookup> {
  const termId = await getActiveTermId(db);
  const [dayRows, periodRows, roomRows, teacherRows, sessions] = await Promise.all([
    db.select({ id: workingDays.id }).from(workingDays),
    db.select({ id: periods.id }).from(periods),
    db.select({ id: rooms.id, name: rooms.name }).from(rooms).orderBy(asc(rooms.id)),
    db.select({ id: teachers.id, name: teachers.name }).from(teachers).orderBy(asc(teachers.id)),
    loadSessionRows(db, termId ? [eq(classSessions.termId, termId)] : []),
  ]);

  if (dayIndex < 0 || dayIndex >= dayRows.length) return { ok: false, reason: "day" };
  if (slot < 0 || slot >= periodRows.length) return { ok: false, reason: "period" };

  const roomsList: MetaRoom[] = roomRows.map((r) => ({
    id: r.id,
    name: r.name,
    group: assignRoomGroup(r.name),
  }));
  return {
    ok: true,
    result: computeFree(sessions, roomsList, teacherRows, dayIndex, slot, kind),
  };
}

export type BusyRoom = { room: MetaRoom; entries: { batchLabel: string; teacherName: string | null }[] };
export type BusyTeacher = {
  teacher: MetaTeacher;
  entries: { batchLabel: string; roomName: string | null }[];
};

export type FreeResult = {
  dayIndex: number;
  slot: number;
  kind: "rooms" | "teachers";
  freeRooms?: MetaRoom[];
  busyRooms?: BusyRoom[];
  freeTeachers?: MetaTeacher[];
  busyTeachers?: BusyTeacher[];
};

/**
 * Computes who is busy / free at a specific (day, period) from the resolved
 * session list. This mirrors the source application's "Now" tabs exactly.
 */
export function computeFree(
  sessions: ResolvedSession[],
  roomsList: MetaRoom[],
  teachersList: MetaTeacher[],
  dayIndex: number,
  slot: number,
  kind: "rooms" | "teachers",
): FreeResult {
  const at = sessions.filter((s) => s.dayIndex === dayIndex && s.slot === slot);

  if (kind === "rooms") {
    const busy = new Map<number, { batchLabel: string; teacherName: string | null }[]>();
    for (const s of at) {
      if (s.roomId == null) continue;
      const list = busy.get(s.roomId) ?? [];
      list.push({ batchLabel: s.batchLabel, teacherName: s.teacherName });
      busy.set(s.roomId, list);
    }
    const freeRooms = roomsList.filter((r) => !busy.has(r.id));
    const busyRooms: BusyRoom[] = roomsList
      .filter((r) => busy.has(r.id))
      .map((r) => ({ room: r, entries: busy.get(r.id)! }));
    return { dayIndex, slot, kind, freeRooms, busyRooms };
  }

  const busy = new Map<number, { batchLabel: string; roomName: string | null }[]>();
  for (const s of at) {
    if (s.teacherId == null) continue;
    const list = busy.get(s.teacherId) ?? [];
    list.push({ batchLabel: s.batchLabel, roomName: s.roomName });
    busy.set(s.teacherId, list);
  }
  const freeTeachers = teachersList.filter((t) => !busy.has(t.id));
  const busyTeachers: BusyTeacher[] = teachersList
    .filter((t) => busy.has(t.id))
    .map((t) => ({ teacher: t, entries: busy.get(t.id)! }));
  return { dayIndex, slot, kind, freeTeachers, busyTeachers };
}

export type DayBlock = { startSlot: number; endSlot: number; session: ResolvedSession };

/**
 * Merges consecutive sessions that share the same batch, room, teacher and
 * subject into a single display block, identical to the source application.
 */
export function mergeDayBlocks(sessions: ResolvedSession[], dayIndex: number): DayBlock[] {
  const daySessions = sessions
    .filter((s) => s.dayIndex === dayIndex)
    .sort((a, b) => a.slot - b.slot);
  const blocks: DayBlock[] = [];
  for (const s of daySessions) {
    const prev = blocks[blocks.length - 1];
    const sameIdentity =
      prev &&
      prev.session.batchId === s.batchId &&
      prev.session.roomId === s.roomId &&
      prev.session.teacherId === s.teacherId &&
      prev.session.subjectId === s.subjectId;
    if (sameIdentity && prev.endSlot === s.slot - 1) {
      prev.endSlot = s.slot;
    } else {
      blocks.push({ startSlot: s.slot, endSlot: s.slot, session: s });
    }
  }
  return blocks;
}
