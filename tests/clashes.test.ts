import { describe, expect, it } from "vitest";
import { GET as conflictsGET } from "@/app/api/conflicts/route";
import { getDb } from "@/lib/db";
import {
  detectClashes,
  detectClashesInSessions,
  type ClashKind,
  type ClashSession,
} from "@/lib/services/clashes";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function session(over: Partial<ClashSession> & Pick<ClashSession, "id">): ClashSession {
  return {
    dayIndex: 0,
    periodId: 1,
    periodLabel: "L1",
    startMinutes: 510,
    endMinutes: 600,
    batchId: 1,
    batchLabel: "BS(CS)-I",
    subjectId: 1,
    subjectTitle: "Subject",
    roomId: 1,
    roomName: "CR 1",
    teacherId: 1,
    teacherName: "Dr. A",
    isRepeater: false,
    ...over,
  };
}

function kinds(clashes: { kind: ClashKind }[]): ClashKind[] {
  return clashes.map((c) => c.kind).sort();
}

describe("detectClashesInSessions — half-open entity clashes", () => {
  it("C: detects a teacher clash across two batches and rooms", () => {
    const clashes = detectClashesInSessions(
      [
        session({ id: 1, batchId: 1, batchLabel: "BS(CS)-I", roomId: 1 }),
        session({ id: 2, batchId: 2, batchLabel: "BS(CS)-II", roomId: 2, roomName: "CR 2" }),
      ],
      DAYS,
    );
    const teacher = clashes.filter((c) => c.kind === "teacher");
    expect(teacher).toHaveLength(1);
    expect(teacher[0].entityId).toBe(1);
    expect(teacher[0].entityLabel).toBe("Dr. A");
    expect(teacher[0].sessionIds).toEqual([1, 2]);
    expect(teacher[0].dayName).toBe("Monday");
    // No batch or room clash: batches and rooms differ.
    expect(kinds(clashes)).toEqual(["teacher"]);
  });

  it("D: detects a room clash across two batches and teachers", () => {
    const clashes = detectClashesInSessions(
      [
        session({ id: 1, batchId: 1, roomId: 7, roomName: "LH 1", teacherId: 1 }),
        session({
          id: 2,
          batchId: 2,
          roomId: 7,
          roomName: "LH 1",
          teacherId: 2,
          teacherName: "Dr. B",
        }),
      ],
      DAYS,
    );
    const room = clashes.filter((c) => c.kind === "room");
    expect(room).toHaveLength(1);
    expect(room[0].entityId).toBe(7);
    expect(room[0].entityLabel).toBe("LH 1");
    expect(kinds(clashes)).toEqual(["room"]);
  });

  it("A: flags a repeat-session clash", () => {
    const clashes = detectClashesInSessions(
      [
        session({ id: 1, batchId: 3, batchLabel: "BS(SE)-I" }),
        session({
          id: 2,
          batchId: 3,
          batchLabel: "BS(SE)-I",
          roomId: 2,
          roomName: "CR 2",
          isRepeater: true,
        }),
      ],
      DAYS,
    );
    const batch = clashes.filter((c) => c.kind === "batch");
    expect(batch).toHaveLength(1);
    expect(batch[0].repeats).toBe(true);
    expect(batch[0].sessionIds).toEqual([1, 2]);
  });

  it("H: reports every simultaneous clash across many overlapping sessions", () => {
    const clashes = detectClashesInSessions(
      [
        session({ id: 1, batchId: 4, subjectId: 5, roomId: 3, roomName: "CR 3", teacherId: 1 }),
        session({
          id: 2,
          batchId: 4,
          subjectId: 5,
          roomId: 3,
          roomName: "CR 3",
          teacherId: 2,
          teacherName: "Dr. B",
        }),
        session({
          id: 3,
          batchId: 4,
          subjectId: 5,
          roomId: 3,
          roomName: "CR 3",
          teacherId: 3,
          teacherName: "Dr. C",
        }),
      ],
      DAYS,
    );
    expect(clashes.filter((c) => c.kind === "batch")).toHaveLength(3);
    expect(clashes.filter((c) => c.kind === "course")).toHaveLength(3);
    expect(clashes.filter((c) => c.kind === "room")).toHaveLength(3);
    expect(clashes.filter((c) => c.kind === "teacher")).toHaveLength(0);
  });

  it("does not flag a combined class (same teacher and room) as a clash", () => {
    const clashes = detectClashesInSessions(
      [
        session({ id: 1, batchId: 1, batchLabel: "BS(CS)-I", roomId: 5, roomName: "LH 5", teacherId: 1 }),
        session({ id: 2, batchId: 2, batchLabel: "BS(CS)-II", roomId: 5, roomName: "LH 5", teacherId: 1 }),
      ],
      DAYS,
    );
    expect(clashes).toEqual([]);
  });

  it("treats the same subject on the same batch as a course clash", () => {
    const clashes = detectClashesInSessions(
      [
        session({ id: 1, batchId: 9, subjectId: 5, roomId: 1, teacherId: 1 }),
        session({
          id: 2,
          batchId: 9,
          subjectId: 5,
          roomId: 2,
          roomName: "CR 2",
          teacherId: 2,
          teacherName: "Dr. B",
        }),
      ],
      DAYS,
    );
    expect(kinds(clashes)).toEqual(["batch", "course"]);
    expect(clashes.find((c) => c.kind === "course")?.entityId).toBe(5);
  });

  it("does not clash adjacent (touching) periods", () => {
    const clashes = detectClashesInSessions(
      [
        session({ id: 1, periodId: 1, periodLabel: "L1", startMinutes: 510, endMinutes: 600 }),
        session({ id: 2, periodId: 2, periodLabel: "L2", startMinutes: 600, endMinutes: 690 }),
      ],
      DAYS,
    );
    expect(clashes).toEqual([]);
  });

  it("does not clash sessions on different days", () => {
    const clashes = detectClashesInSessions(
      [session({ id: 1, dayIndex: 0 }), session({ id: 2, dayIndex: 1 })],
      DAYS,
    );
    expect(clashes).toEqual([]);
  });

  it("ignores missing rooms and teachers", () => {
    const clashes = detectClashesInSessions(
      [
        session({
          id: 1,
          subjectId: 1,
          roomId: null,
          roomName: null,
          teacherId: null,
          teacherName: null,
        }),
        session({
          id: 2,
          subjectId: 2,
          roomId: null,
          roomName: null,
          teacherId: null,
          teacherName: null,
        }),
      ],
      DAYS,
    );
    expect(kinds(clashes)).toEqual(["batch"]);
  });
});

describe("detectClashes — integration over the seeded term", () => {
  it("reports a consistent clash report for every session", async () => {
    const db = await getDb();
    const report = await detectClashes(db);

    expect(report.termId).not.toBeNull();
    expect(report.sessionsChecked).toBe(813);
    expect(report.clashes).toHaveLength(
      report.counts.batch + report.counts.course + report.counts.teacher + report.counts.room,
    );
    for (const c of report.clashes) {
      expect(c.sessionIds).toHaveLength(2);
      expect(c.dayName.length).toBeGreaterThan(0);
    }
    // Regression lock on the seeded term: 38 genuine cohort clashes (parallel
    // classes for one batch). Every same-slot teacher/room duplicate in the
    // source is a combined lecture, so no teacher or room clash is reported.
    expect(report.counts.batch).toBe(38);
    expect(report.counts.teacher).toBe(0);
    expect(report.counts.room).toBe(0);
    expect(report.counts.course).toBe(0);
  });

  it("GET /api/conflicts returns the report", async () => {
    const res = await conflictsGET(new Request("http://localhost/api/conflicts"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionsChecked).toBe(813);
    expect(Array.isArray(body.clashes)).toBe(true);
    expect(body.counts).toBeTypeOf("object");
  });
});
