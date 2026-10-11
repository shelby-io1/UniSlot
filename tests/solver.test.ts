import { afterEach, describe, expect, it } from "vitest";
import { POST as resolutionsPOST } from "@/app/api/resolutions/route";
import { getDb } from "@/lib/db";
import {
  detectClashes,
  detectClashesInSessions,
  loadTermSessions,
  type ClashSession,
} from "@/lib/services/clashes";
import {
  applyResolution,
  ResolutionConflict,
} from "@/lib/services/resolution";
import {
  findCandidates,
  loadSolverInput,
  TimetableSolverService,
  type ExportedAssignment,
  type SolverInput,
} from "@/lib/services/solver";

const PERIODS = [
  { id: 1, sortOrder: 0, startMinutes: 510, endMinutes: 600 },
  { id: 2, sortOrder: 1, startMinutes: 600, endMinutes: 690 },
  { id: 3, sortOrder: 2, startMinutes: 690, endMinutes: 795 },
  { id: 4, sortOrder: 3, startMinutes: 815, endMinutes: 900 },
  { id: 5, sortOrder: 4, startMinutes: 900, endMinutes: 990 },
];

const PERIOD_TIMES: Record<number, { startMinutes: number; endMinutes: number }> = {
  1: { startMinutes: 510, endMinutes: 600 },
  2: { startMinutes: 600, endMinutes: 690 },
  3: { startMinutes: 690, endMinutes: 795 },
  4: { startMinutes: 815, endMinutes: 900 },
  5: { startMinutes: 900, endMinutes: 990 },
};

function sess(id: number, over: Partial<ClashSession> = {}): ClashSession {
  return {
    id,
    dayIndex: 0,
    periodId: 1,
    periodLabel: "L1",
    startMinutes: 510,
    endMinutes: 600,
    batchId: 1,
    batchLabel: "B1",
    subjectId: 1,
    subjectTitle: "S1",
    roomId: null,
    roomName: null,
    teacherId: null,
    teacherName: null,
    isRepeater: false,
    ...over,
  };
}

function input(sessions: ClashSession[], extra: Partial<SolverInput> = {}): SolverInput {
  return { sessions, periods: PERIODS, roomIds: [1, 2, 3], dayCount: 5, ...extra };
}

function applyAssignment(sessions: ClashSession[], assignments: readonly ExportedAssignment[]): ClashSession[] {
  const byId = new Map(assignments.map((a) => [a.sessionId, a]));
  return sessions.map((s) => {
    const p = byId.get(s.id);
    if (!p) return s;
    const t = PERIOD_TIMES[p.periodId];
    return { ...s, dayIndex: p.dayIndex, periodId: p.periodId, roomId: p.roomId, startMinutes: t.startMinutes, endMinutes: t.endMinutes };
  });
}

describe("TimetableSolverService — pure resolution", () => {
  it("B: accepts a valid alternative placement that clears the clash", () => {
    const sessions = [
      sess(1, { batchId: 1, subjectId: 10, roomId: 1, roomName: "R1", teacherId: 1, teacherName: "T1" }),
      sess(2, { batchId: 1, subjectId: 11, roomId: 2, roomName: "R2", teacherId: 2, teacherName: "T2" }),
    ];
    const solver = new TimetableSolverService(input(sessions));
    const result = solver.solve({ optimize: false });
    expect(result.status).toBe("FEASIBLE");
    expect((result.assignments ?? []).length).toBeGreaterThan(0);
    expect(detectClashesInSessions(applyAssignment(sessions, result.assignments ?? []))).toEqual([]);
  });

  it("OPTIMAL resolves a two-session clash with a single move", () => {
    const sessions = [
      sess(1, { batchId: 1, subjectId: 10, roomId: 1, roomName: "R1", teacherId: 1, teacherName: "T1" }),
      sess(2, { batchId: 1, subjectId: 11, roomId: 2, roomName: "R2", teacherId: 2, teacherName: "T2" }),
    ];
    const result = new TimetableSolverService(input(sessions)).solve({ optimize: true });
    expect(result.status).toBe("OPTIMAL");
    expect(result.movedCount).toBe(1);
  });

  it("candidates never include a slot already occupied by the batch", () => {
    const sessions = [
      sess(1, { batchId: 1, subjectId: 10, roomId: 1, roomName: "R1", teacherId: 1, teacherName: "T1" }),
      sess(2, { batchId: 1, subjectId: 11, roomId: 2, roomName: "R2", teacherId: 2, teacherName: "T2" }),
    ];
    const candidates = findCandidates(input(sessions), 1);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.dayIndex === 0 && c.periodId === 1)).toBe(false);
    for (const c of candidates) {
      const moved = applyAssignment(sessions, [{ sessionId: 1, ...c }]);
      expect(detectClashesInSessions(moved).some((cl) => cl.sessionIds.includes(1))).toBe(false);
    }
  });

  it("L: existing valid placements are preserved", () => {
    const sessions = [
      sess(1, { batchId: 1, subjectId: 10, roomId: 1, roomName: "R1", teacherId: 1, teacherName: "T1" }),
      sess(2, { batchId: 1, subjectId: 11, roomId: 2, roomName: "R2", teacherId: 2, teacherName: "T2" }),
      sess(3, { batchId: 1, subjectId: 12, periodId: 2, periodLabel: "L2", startMinutes: 600, endMinutes: 690 }),
      sess(4, { batchId: 2, batchLabel: "B2", subjectId: 13, periodId: 4, periodLabel: "L4", startMinutes: 815, endMinutes: 900 }),
      sess(5, { batchId: 3, batchLabel: "B3", subjectId: 14, dayIndex: 1, periodId: 5, periodLabel: "L5", startMinutes: 900, endMinutes: 990 }),
    ];
    const result = new TimetableSolverService(input(sessions)).solve({ optimize: true });
    expect(result.status).toBe("OPTIMAL");
    const movedIds = (result.assignments ?? []).map((a) => a.sessionId);
    expect(movedIds.every((id) => id === 1 || id === 2)).toBe(true);
    expect(detectClashesInSessions(applyAssignment(sessions, result.assignments ?? []))).toEqual([]);
  });

  it("F: a batch with no free slot reports INFEASIBLE", () => {
    const sessions = [
      sess(1, { subjectId: 1 }),
      sess(2, { subjectId: 2 }),
      sess(3, { subjectId: 3, periodId: 2, periodLabel: "L2", startMinutes: 600, endMinutes: 690 }),
      sess(4, { subjectId: 4, periodId: 3, periodLabel: "L3", startMinutes: 690, endMinutes: 795 }),
      sess(5, { subjectId: 5, periodId: 4, periodLabel: "L4", startMinutes: 815, endMinutes: 900 }),
      sess(6, { subjectId: 6, periodId: 5, periodLabel: "L5", startMinutes: 900, endMinutes: 990 }),
    ];
    const result = new TimetableSolverService(input(sessions, { dayCount: 1 })).solve();
    expect(result.status).toBe("INFEASIBLE");
  });

  it("G: a timeout reports UNKNOWN, never INFEASIBLE", () => {
    const sessions: ClashSession[] = [];
    for (let b = 1; b <= 5; b++) {
      sessions.push(sess(b * 10, { batchId: b, batchLabel: `B${b}`, subjectId: 100 + b, periodId: 3, periodLabel: "L3", startMinutes: 690, endMinutes: 795 }));
      sessions.push(sess(b * 10 + 1, { batchId: b, batchLabel: `B${b}`, subjectId: 200 + b, periodId: 3, periodLabel: "L3", startMinutes: 690, endMinutes: 795 }));
    }
    const timedOut = new TimetableSolverService(input(sessions, { dayCount: 2 })).solve({
      fixSessionIds: sessions.filter((s) => s.id % 10 === 1).map((s) => s.id),
      timeoutMs: 1,
      optimize: true,
    });
    expect(timedOut.status).toBe("UNKNOWN");
    expect(timedOut.status).not.toBe("INFEASIBLE");

    const feasible = new TimetableSolverService(input(sessions, { dayCount: 2 })).solve({
      fixSessionIds: sessions.filter((s) => s.id % 10 === 1).map((s) => s.id),
      optimize: false,
    });
    expect(feasible.status).toBe("FEASIBLE");
  });

  it("MODEL_INVALID for unknown fix ids, bad periods and unknown rooms", () => {
    const sessions = [
      sess(1, { subjectId: 10, roomId: 1, roomName: "R1" }),
      sess(2, { subjectId: 11, roomId: 2, roomName: "R2" }),
    ];
    const unknownId = new TimetableSolverService(input(sessions)).solve({ fixSessionIds: [999] });
    expect(unknownId.status).toBe("MODEL_INVALID");
    expect(unknownId.reason).toContain("999");

    const badPeriod = new TimetableSolverService(
      input(sessions, { periods: [{ id: 9, sortOrder: 0, startMinutes: 600, endMinutes: 600 }] }),
    ).solve();
    expect(badPeriod.status).toBe("MODEL_INVALID");

    const badRoom = new TimetableSolverService(
      input([sess(1, { roomId: 44, roomName: "nope" }), sess(2, { subjectId: 11, roomId: 2, roomName: "R2" })], { roomIds: [1, 2] }),
    ).solve();
    expect(badRoom.status).toBe("MODEL_INVALID");
  });
});

describe("applyResolution — seeded database", () => {
  afterEach(() => {
    delete process.env.ADMIN_TOKEN;
  });

  it("applies a solver move atomically and clears the targeted clash (M)", async () => {
    const db = await getDb();
    const before = await detectClashes(db);
    expect(before.clashes.length).toBeGreaterThan(0);

    const { termId, input } = await loadSolverInput(db, before.termId ?? undefined);
    const target = before.clashes.find((c) => {
      const candA = findCandidates(input, c.sessionIds[0]);
      const candB = findCandidates(input, c.sessionIds[1]);
      return candA.length > 0 || candB.length > 0;
    });
    expect(target).toBeDefined();

    let sid = target!.sessionIds[0];
    let candidates = findCandidates(input, sid);
    if (candidates.length === 0) {
      sid = target!.sessionIds[1];
      candidates = findCandidates(input, sid);
    }
    expect(candidates.length).toBeGreaterThan(0);
    const choice = candidates[0];
    const current = input.sessions.find((s) => s.id === sid)!;

    const result = await applyResolution(db, {
      moves: [{ sessionId: sid, ...choice }],
      expected: { [sid]: { dayIndex: current.dayIndex, periodId: current.periodId, roomId: current.roomId } },
      termId: termId ?? undefined,
      actor: "test",
    });
    expect(result.applied).toBe(1);

    const after = await detectClashes(db, before.termId ?? undefined);
    expect(after.clashes.length).toBeLessThan(before.clashes.length);
    expect(after.clashes.some((c) => c.sessionIds.includes(sid))).toBe(false);
  });

  it("rejects a move whose expected placement is stale (version check)", async () => {
    const db = await getDb();
    const { termId, input } = await loadSolverInput(db);
    const victim = input.sessions[0];
    const staleExpected = { dayIndex: (victim.dayIndex + 1) % input.dayCount, periodId: victim.periodId, roomId: victim.roomId };

    await expect(
      applyResolution(db, {
        moves: [{ sessionId: victim.id, dayIndex: staleExpected.dayIndex, periodId: staleExpected.periodId, roomId: staleExpected.roomId }],
        expected: { [victim.id]: staleExpected },
        termId: termId ?? undefined,
      }),
    ).rejects.toThrow(ResolutionConflict);

    const { sessions } = await loadTermSessions(db, termId!);
    const after = sessions.find((s) => s.id === victim.id)!;
    expect(after.dayIndex).toBe(victim.dayIndex);
    expect(after.periodId).toBe(victim.periodId);
    expect(after.roomId).toBe(victim.roomId);
  });

  it("E: rejects a change that introduces a new batch clash and rolls back", async () => {
    const db = await getDb();
    const { termId, input } = await loadSolverInput(db);

    const sameBatch = new Map<number, ClashSession[]>();
    for (const s of input.sessions) {
      const list = sameBatch.get(s.batchId) ?? [];
      list.push(s);
      sameBatch.set(s.batchId, list);
    }
    const pair = [...sameBatch.values()].find((list) => {
      const free = list.filter((s) => s.dayIndex === list[0].dayIndex);
      const slots = new Set(free.map((s) => s.periodId));
      return free.length >= 2 && slots.size >= 2;
    });
    expect(pair).toBeDefined();

    const source = pair![0];
    const target = pair!.find((s) => s.dayIndex === source.dayIndex && s.periodId !== source.periodId)!;
    const move = { sessionId: target.id, dayIndex: source.dayIndex, periodId: source.periodId, roomId: source.roomId };

    await expect(
      applyResolution(db, {
        moves: [move],
        expected: { [target.id]: { dayIndex: target.dayIndex, periodId: target.periodId, roomId: target.roomId } },
        termId: termId ?? undefined,
      }),
    ).rejects.toThrow(/revalidation failed/);

    const { sessions } = await loadTermSessions(db, termId!);
    const after = sessions.find((s) => s.id === target.id)!;
    expect(after.dayIndex).toBe(target.dayIndex);
    expect(after.periodId).toBe(target.periodId);
  });

  it("route guard: POST /api/resolutions demands the admin token", async () => {
    const url = "http://localhost/api/resolutions";
    const noToken = await resolutionsPOST(new Request(url, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
    expect(noToken.status).toBe(503);

    process.env.ADMIN_TOKEN = "secret";
    const noHeader = await resolutionsPOST(
      new Request(url, { method: "POST", body: JSON.stringify({ moves: [], expected: {} }), headers: { "content-type": "application/json" } }),
    );
    expect(noHeader.status).toBe(401);

    const empty = await resolutionsPOST(
      new Request(url, { method: "POST", body: JSON.stringify({ moves: [], expected: {} }), headers: { "content-type": "application/json", "x-admin-token": "secret" } }),
    );
    expect(empty.status).toBe(400);

    const badToken = await resolutionsPOST(
      new Request(url, { method: "POST", body: JSON.stringify({ moves: [], expected: {} }), headers: { "content-type": "application/json", "x-admin-token": "wrong" } }),
    );
    expect(badToken.status).toBe(401);
  });
});