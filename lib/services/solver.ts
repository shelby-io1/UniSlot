import { asc } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { periods as periodsTable, rooms as roomsTable, workingDays } from "@/lib/db/schema";
import { detectClashesInSessions, loadTermSessions, type ClashSession } from "@/lib/services/clashes";
import { getActiveTermId } from "@/lib/services/timetable";
import { overlaps } from "@/lib/time";

/**
 * Phase 5 resolution solver.
 *
 * `TimetableSolverService` finds alternative placements (day, period, room) for
 * a chosen group of sessions so that the whole-term schedule is free of
 * entity-level clashes, using the same detection rules as Phase 4.
 *
 * Statuses are faithful:
 * - `FEASIBLE`        a conflict-free assignment was found (first solution).
 * - `OPTIMAL`         the minimum-move assignment was found and proven minimal.
 * - `INFEASIBLE`      search space exhausted with no conflict-free assignment.
 * - `UNKNOWN`         the solve hit the timeout — never reported as infeasible.
 * - `MODEL_INVALID`   the input was inconsistent (bad references/intervals).
 *
 * The search is deterministic: moveable sessions are ordered by id and options
 * are tried in a fixed order (keep the current placement first, then day,
 * period, room). Combined classes are respected (see `wouldClash`), matching
 * the detector.
 */

export type SolverStatus = "FEASIBLE" | "OPTIMAL" | "INFEASIBLE" | "UNKNOWN" | "MODEL_INVALID";

export type CandidatePlacement = {
  dayIndex: number;
  periodId: number;
  roomId: number | null;
};

export type SolverPeriod = {
  id: number;
  sortOrder: number;
  startMinutes: number;
  endMinutes: number;
};

export type SolverInput = {
  /** Every session in the term (the full schedule being repaired). */
  sessions: ClashSession[];
  periods: SolverPeriod[];
  roomIds: number[];
  /** Number of working days; sessions use dayIndex in [0, dayCount). */
  dayCount: number;
};

export type SolveOptions = {
  /** Sessions permitted to move. Defaults to every session involved in a clash. */
  fixSessionIds?: number[];
  timeoutMs?: number;
  /** true → `OPTIMAL` (minimum moves, proven); false → `FEASIBLE` (first found). */
  optimize?: boolean;
  maxCandidates?: number;
};

export type ExportedAssignment = {
  sessionId: number;
} & CandidatePlacement;

export type SolverResult = {
  status: SolverStatus;
  reason?: string;
  /** Only the sessions whose placement actually changed. */
  assignments?: ExportedAssignment[];
  movedCount?: number;
  candidatesConsidered?: number;
  elapsedMs?: number;
};

export const DEFAULT_TIMEOUT_MS = 2000;
export const DEFAULT_MAX_CANDIDATES = 40;

/** A candidate placement together with its resolved interval. */
export type TimedPlacement = CandidatePlacement & { startMinutes: number; endMinutes: number };

type Occupied = { session: ClashSession; placement: TimedPlacement };

function samePlacement(a: CandidatePlacement, b: CandidatePlacement): boolean {
  return a.dayIndex === b.dayIndex && a.periodId === b.periodId && a.roomId === b.roomId;
}

function currentPlacement(s: ClashSession): CandidatePlacement {
  return { dayIndex: s.dayIndex, periodId: s.periodId, roomId: s.roomId };
}

export function validateSolverInput(input: SolverInput): string | null {
  const { sessions, periods, roomIds, dayCount } = input;
  if (!Number.isInteger(dayCount) || dayCount < 1) return "dayCount must be a positive integer";

  const periodIds = new Set<number>();
  for (const p of periods) {
    if (
      !Number.isFinite(p.startMinutes) ||
      !Number.isFinite(p.endMinutes) ||
      p.startMinutes < 0 ||
      p.startMinutes >= p.endMinutes
    ) {
      return `period ${p.id} has an invalid interval`;
    }
    if (periodIds.has(p.id)) return `duplicate period id ${p.id}`;
    periodIds.add(p.id);
  }

  const roomSet = new Set(roomIds);
  const seen = new Set<number>();
  for (const s of sessions) {
    if (!Number.isInteger(s.id) || seen.has(s.id)) return `duplicate session id ${s.id}`;
    seen.add(s.id);
    if (!Number.isInteger(s.dayIndex) || s.dayIndex < 0 || s.dayIndex >= dayCount) {
      return `session ${s.id} has an invalid dayIndex`;
    }
    if (!periodIds.has(s.periodId)) return `session ${s.id} references unknown period ${s.periodId}`;
    if (
      !Number.isFinite(s.startMinutes) ||
      !Number.isFinite(s.endMinutes) ||
      s.startMinutes < 0 ||
      s.startMinutes >= s.endMinutes
    ) {
      return `session ${s.id} has an invalid interval`;
    }
    if (s.roomId !== null && !roomSet.has(s.roomId)) {
      return `session ${s.id} references unknown room ${s.roomId}`;
    }
  }
  return null;
}

/**
 * Whether `p` (a placement for `cand`) would contend with any occupied session
 * on the same day. Mirrors the Phase 4 detector: same batch is always a clash;
 * a teacher clash needs a different room; a room clash needs a different
 * teacher (combined classes share teacher *and* room and are legal).
 */
export function wouldClash(cand: ClashSession, p: TimedPlacement, occupied: Occupied[]): boolean {
  for (const o of occupied) {
    if (o.placement.dayIndex !== p.dayIndex) continue;
    if (!overlaps(p.startMinutes, p.endMinutes, o.placement.startMinutes, o.placement.endMinutes)) {
      continue;
    }
    if (o.session.batchId === cand.batchId) return true;
    if (cand.teacherId !== null && cand.teacherId === o.session.teacherId) {
      if (!(p.roomId !== null && p.roomId === o.placement.roomId)) return true;
    }
    if (p.roomId !== null && p.roomId === o.placement.roomId) {
      if (!(cand.teacherId !== null && cand.teacherId === o.session.teacherId)) return true;
    }
  }
  return false;
}

function occupiedList(sessions: ClashSession[], excludingId: number): Occupied[] {
  return sessions
    .filter((s) => s.id !== excludingId)
    .map<Occupied>((s) => ({
      session: s,
      placement: {
        dayIndex: s.dayIndex,
        periodId: s.periodId,
        roomId: s.roomId,
        startMinutes: s.startMinutes,
        endMinutes: s.endMinutes,
      },
    }));
}

/**
 * Loads the full solver input (sessions, periods, room ids, day count) for a
 * term from the database. Shared by the preview and solve routes.
 */
export async function loadSolverInput(
  db: Database,
  termId?: number,
): Promise<{ termId: number | null; input: SolverInput }> {
  const resolvedTermId = termId ?? (await getActiveTermId(db));
  const [periodRows, roomRows, dayRows] = await Promise.all([
    db.select().from(periodsTable).orderBy(asc(periodsTable.sortOrder)),
    db.select({ id: roomsTable.id }).from(roomsTable).orderBy(asc(roomsTable.id)),
    db.select({ name: workingDays.name }).from(workingDays).orderBy(asc(workingDays.sortOrder)),
  ]);
  const sessions = resolvedTermId === null ? [] : (await loadTermSessions(db, resolvedTermId)).sessions;
  return {
    termId: resolvedTermId,
    input: {
      sessions,
      periods: periodRows.map((p) => ({
        id: p.id,
        sortOrder: p.sortOrder,
        startMinutes: p.startMinutes,
        endMinutes: p.endMinutes,
      })),
      roomIds: roomRows.map((r) => r.id),
      dayCount: dayRows.length,
    },
  };
}

/**
 * All legal alternative placements for one session against the *rest* of the
 * schedule (nothing else moves). Deterministic: day, then period (by
 * sortOrder), then room (no room first, then by id). The session's current
 * placement is excluded. Used by the preview API.
 */
export function findCandidates(
  input: SolverInput,
  sessionId: number,
  opts: { maxCandidates?: number } = {},
): CandidatePlacement[] {
  const session = input.sessions.find((s) => s.id === sessionId);
  if (!session) return [];
  return candidateSlots(input, session, occupiedList(input.sessions, sessionId), opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES);
}

function candidateSlots(
  input: SolverInput,
  session: ClashSession,
  occupied: Occupied[],
  maxCandidates: number,
): CandidatePlacement[] {
  const periods = [...input.periods].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const roomList = [...input.roomIds].sort((a, b) => a - b);

  const out: CandidatePlacement[] = [];
  for (let dayIndex = 0; dayIndex < input.dayCount; dayIndex++) {
    for (const p of periods) {
      const timedBase: TimedPlacement = {
        dayIndex,
        periodId: p.id,
        roomId: null,
        startMinutes: p.startMinutes,
        endMinutes: p.endMinutes,
      };
      const roomChoices: (number | null)[] = [null, ...roomList];
      for (const roomId of roomChoices) {
        const cand: TimedPlacement = { ...timedBase, roomId };
        if (samePlacement(cand, currentPlacement(session))) continue;
        if (wouldClash(session, cand, occupied)) continue;
        out.push({ dayIndex: cand.dayIndex, periodId: cand.periodId, roomId: cand.roomId });
        if (out.length >= maxCandidates) return out;
      }
    }
  }
  return out;
}

export class TimetableSolverService {
  constructor(private readonly input: SolverInput) {}

  solve(options: SolveOptions = {}): SolverResult {
    const t0 = Date.now();
    const elapsed = () => Date.now() - t0;
    const { sessions, periods } = this.input;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const optimize = options.optimize ?? true;
    const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

    const invalid = validateSolverInput(this.input);
    if (invalid) {
      return { status: "MODEL_INVALID", reason: invalid, elapsedMs: elapsed() };
    }

    const sessionById = new Map(sessions.map((s) => [s.id, s]));
    let fixSessionIds: number[];
    if (options.fixSessionIds !== undefined) {
      fixSessionIds = [...new Set(options.fixSessionIds)].sort((a, b) => a - b);
      for (const id of fixSessionIds) {
        if (!sessionById.has(id)) {
          return { status: "MODEL_INVALID", reason: `unknown session id ${id}`, elapsedMs: elapsed() };
        }
      }
    } else {
      const clashes = detectClashesInSessions(sessions);
      fixSessionIds = [...new Set(clashes.flatMap((c) => c.sessionIds))].sort((a, b) => a - b);
    }
    if (fixSessionIds.length === 0) {
      return { status: "FEASIBLE", assignments: [], movedCount: 0, candidatesConsidered: 0, elapsedMs: elapsed() };
    }

    const fixSet = new Set(fixSessionIds);
    const movable = sessions.filter((s) => fixSet.has(s.id)).sort((a, b) => a.id - b.id);
    const fixed = sessions
      .filter((s) => !fixSet.has(s.id))
      .map<Occupied>((s) => ({
        session: s,
        placement: {
          dayIndex: s.dayIndex,
          periodId: s.periodId,
          roomId: s.roomId,
          startMinutes: s.startMinutes,
          endMinutes: s.endMinutes,
        },
      }));

    const periodTimes = new Map(periods.map((p) => [p.id, { startMinutes: p.startMinutes, endMinutes: p.endMinutes }]));

    type Best = { assignments: Map<number, CandidatePlacement>; movedIds: number[] };
    let bestRef: { value: Best } | null = null;
    let timedOut = false;
    let considered = 0;

    const occupy = (assigned: Map<number, CandidatePlacement>): Occupied[] => {
      const all = fixed.slice();
      for (const [sid, p] of assigned) {
        const s = sessionById.get(sid)!;
        const times = periodTimes.get(p.periodId)!;
        all.push({ session: s, placement: { ...p, startMinutes: times.startMinutes, endMinutes: times.endMinutes } });
      }
      return all;
    };

    const search = (
      idx: number,
      occupiedSoFar: Occupied[],
      assigned: Map<number, CandidatePlacement>,
      movedCount: number,
    ): void => {
      if (timedOut) return;
      if (elapsed() > timeoutMs) {
        timedOut = true;
        return;
      }
      if (idx === movable.length) {
        const finalSessions = sessions.map((s) => {
          const p = assigned.get(s.id);
          if (!p) return s;
          const times = periodTimes.get(p.periodId)!;
          return { ...s, dayIndex: p.dayIndex, periodId: p.periodId, roomId: p.roomId, startMinutes: times.startMinutes, endMinutes: times.endMinutes };
        });
        if (detectClashesInSessions(finalSessions).length === 0) {
          const movedIds = [...assigned.keys()]
            .sort((a, b) => a - b)
            .filter((id) => !samePlacement(assigned.get(id)!, currentPlacement(sessionById.get(id)!)));
          if (!optimize) {
            bestRef = { value: { assignments: new Map(assigned), movedIds } };
            return;
          }
          if (!bestRef || movedCount < bestRef.value.movedIds.length) {
            bestRef = { value: { assignments: new Map(assigned), movedIds } };
          }
        }
        return;
      }

      const s = movable[idx];
      const current = currentPlacement(s);
      const currentTimes = periodTimes.get(s.periodId)!;
      const keep = { ...current, startMinutes: currentTimes.startMinutes, endMinutes: currentTimes.endMinutes };

      const options: { p: TimedPlacement; moved: boolean }[] = [];
      if (!wouldClash(s, keep, occupiedSoFar)) options.push({ p: keep, moved: false });
      for (const cand of candidateSlots(this.input, s, occupiedSoFar, maxCandidates)) {
        const times = periodTimes.get(cand.periodId)!;
        options.push({ p: { ...cand, startMinutes: times.startMinutes, endMinutes: times.endMinutes }, moved: true });
      }

      for (const opt of options) {
        const added = opt.moved ? 1 : 0;
        if (optimize && bestRef && movedCount + added >= bestRef.value.movedIds.length) continue;
        considered++;
        const next = new Map(assigned);
        next.set(s.id, { dayIndex: opt.p.dayIndex, periodId: opt.p.periodId, roomId: opt.p.roomId });
        search(idx + 1, occupy(next), next, movedCount + added);
        if (!optimize && bestRef) return;
        if (timedOut) return;
      }
    };

    search(0, fixed, new Map(), 0);

    if (timedOut) {
      return { status: "UNKNOWN", candidatesConsidered: considered, elapsedMs: elapsed() };
    }
    const settled = bestRef as { value: Best } | null;
    if (!settled) {
      return {
        status: "INFEASIBLE",
        reason: "no conflict-free placement exists for the chosen sessions",
        candidatesConsidered: considered,
        elapsedMs: elapsed(),
      };
    }

    const assignments = settled.value.movedIds.map((id) => {
      const p = settled.value.assignments.get(id)!;
      return { sessionId: id, dayIndex: p.dayIndex, periodId: p.periodId, roomId: p.roomId };
    });

    return {
      status: optimize ? "OPTIMAL" : "FEASIBLE",
      assignments,
      movedCount: settled.value.movedIds.length,
      candidatesConsidered: considered,
      elapsedMs: elapsed(),
    };
  }
}