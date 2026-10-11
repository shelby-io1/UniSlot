import { connection } from "next/server";
import { badRequest, intParam, json, serverError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getSessions, mergeDayBlocks } from "@/lib/services/timetable";

/**
 * GET /api/timetable?batch=<id> | ?teacher=<id>
 * Returns the merged weekly schedule for a single batch or teacher.
 */
export async function GET(request: Request) {
  await connection();
  const params = new URL(request.url).searchParams;
  const batch = intParam(params, "batch");
  const teacher = intParam(params, "teacher");

  if ((batch === null) === (teacher === null)) {
    return badRequest("provide exactly one of batch or teacher");
  }

  try {
    const db = await getDb();
    const sessions = await getSessions(
      db,
      batch !== null ? { batchId: batch } : { teacherId: teacher! },
    );

    const byDay = [0, 1, 2, 3, 4].map((dayIndex) => ({
      dayIndex,
      blocks: mergeDayBlocks(sessions, dayIndex).map((b) => ({
        startSlot: b.startSlot,
        endSlot: b.endSlot,
        batchId: b.session.batchId,
        batchLabel: b.session.batchLabel,
        roomId: b.session.roomId,
        roomName: b.session.roomName,
        teacherId: b.session.teacherId,
        teacherName: b.session.teacherName,
        subjectId: b.session.subjectId,
        subjectTitle: b.session.subjectTitle,
        isRepeater: b.session.isRepeater,
        startMinutes: b.session.startMinutes,
        endMinutes: b.session.endMinutes,
      })),
    }));

    return json({ mode: batch !== null ? "batch" : "teacher", days: byDay });
  } catch (error) {
    console.error("timetable failed", error);
    return serverError("Unable to load timetable");
  }
}
