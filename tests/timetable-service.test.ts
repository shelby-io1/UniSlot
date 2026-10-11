import { describe, expect, it } from "vitest";
import {
  assignRoomGroup,
  computeFree,
  mergeDayBlocks,
  type MetaRoom,
  type MetaTeacher,
  type ResolvedSession,
} from "@/lib/services/timetable";

const rooms: MetaRoom[] = [
  { id: 1, name: "LH 1", group: "Lecture halls" },
  { id: 2, name: "CR 1", group: "Classrooms" },
  { id: 3, name: "LT 1", group: "Lecture theatres" },
  { id: 4, name: "CS C.Lab 1", group: "Labs" },
];
const teachers: MetaTeacher[] = [
  { id: 1, name: "Dr. A" },
  { id: 2, name: "Dr. B" },
];

function session(over: Partial<ResolvedSession> & Pick<ResolvedSession, "id">): ResolvedSession {
  return {
    dayIndex: 0,
    slot: 0,
    periodLabel: "L1",
    startMinutes: 510,
    endMinutes: 600,
    batchId: 1,
    batchLabel: "BS(CS)-I",
    roomId: null,
    roomName: null,
    teacherId: null,
    teacherName: null,
    subjectId: 1,
    subjectTitle: "Subject",
    isRepeater: false,
    ...over,
  };
}

describe("assignRoomGroup", () => {
  it("groups rooms by naming prefix", () => {
    expect(assignRoomGroup("LH 4")).toBe("Lecture halls");
    expect(assignRoomGroup("CR 3")).toBe("Classrooms");
    expect(assignRoomGroup("LT 9")).toBe("Lecture theatres");
    expect(assignRoomGroup("CS C.Lab 1")).toBe("Labs");
    expect(assignRoomGroup("WorkS Lab")).toBe("Labs");
  });
});

describe("computeFree", () => {
  const sessions: ResolvedSession[] = [
    session({
      id: 1,
      slot: 0,
      roomId: 2,
      roomName: "CR 1",
      teacherId: 1,
      teacherName: "Dr. A",
      batchLabel: "BS(CS)-I",
    }),
    session({
      id: 2,
      slot: 0,
      roomId: 4,
      roomName: "CS C.Lab 1",
      teacherId: 2,
      teacherName: "Dr. B",
      batchLabel: "BS(CS)-III",
    }),
    session({
      id: 3,
      slot: 1,
      roomId: 1,
      roomName: "LH 1",
      teacherId: 1,
      teacherName: "Dr. A",
      batchLabel: "BS(SE)-I",
    }),
  ];

  it("lists free and busy rooms for the slot", () => {
    const result = computeFree(sessions, rooms, teachers, 0, 0, "rooms");
    expect(result.freeRooms?.map((r) => r.name)).toEqual(["LH 1", "LT 1"]);
    expect(result.busyRooms?.map((b) => b.room.name)).toEqual(["CR 1", "CS C.Lab 1"]);
    expect(result.busyRooms?.[0].entries[0]).toEqual({
      batchLabel: "BS(CS)-I",
      teacherName: "Dr. A",
    });
  });

  it("lists free and busy teachers for the slot", () => {
    const result = computeFree(sessions, rooms, teachers, 0, 0, "teachers");
    expect(result.freeTeachers).toEqual([]);
    expect(result.busyTeachers?.map((b) => b.teacher.name)).toEqual(["Dr. A", "Dr. B"]);
    expect(result.busyTeachers?.[0].entries[0]).toEqual({
      batchLabel: "BS(CS)-I",
      roomName: "CR 1",
    });
  });

  it("shows everyone free when no session exists in the slot", () => {
    const roomsResult = computeFree(sessions, rooms, teachers, 3, 4, "rooms");
    expect(roomsResult.freeRooms).toHaveLength(rooms.length);
    expect(roomsResult.busyRooms).toHaveLength(0);
    const teachersResult = computeFree(sessions, rooms, teachers, 3, 4, "teachers");
    expect(teachersResult.freeTeachers).toHaveLength(teachers.length);
  });
});

describe("mergeDayBlocks", () => {
  it("merges consecutive identical sessions into a single block", () => {
    const sessions: ResolvedSession[] = [
      session({ id: 1, slot: 0, roomId: 2, teacherId: 1, subjectId: 5 }),
      session({ id: 2, slot: 1, roomId: 2, teacherId: 1, subjectId: 5 }),
      session({ id: 3, slot: 3, roomId: 2, teacherId: 1, subjectId: 5 }),
    ];
    const blocks = mergeDayBlocks(sessions, 0);
    expect(blocks).toHaveLength(2);
    expect([blocks[0].startSlot, blocks[0].endSlot]).toEqual([0, 1]);
    expect([blocks[1].startSlot, blocks[1].endSlot]).toEqual([3, 3]);
  });

  it("does not merge across a different room", () => {
    const sessions: ResolvedSession[] = [
      session({ id: 1, slot: 0, roomId: 2, teacherId: 1, subjectId: 5 }),
      session({ id: 2, slot: 1, roomId: 3, teacherId: 1, subjectId: 5 }),
    ];
    expect(mergeDayBlocks(sessions, 0)).toHaveLength(2);
  });
});
