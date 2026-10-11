import { connection } from "next/server";
import { badRequest, intParam, json, serverError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { computeFree, getMeta, getSessions } from "@/lib/services/timetable";

/**
 * GET /api/free?kind=rooms|teachers&day=0&period=0
 * Server-computed free/busy lists for a specific day and lecture period.
 */
export async function GET(request: Request) {
  await connection();
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const day = intParam(params, "day");
  const period = intParam(params, "period");

  if (kind !== "rooms" && kind !== "teachers") {
    return badRequest("kind must be 'rooms' or 'teachers'");
  }
  if (day === null || period === null) {
    return badRequest("day and period are required integers");
  }

  try {
    const db = await getDb();
    const meta = await getMeta(db);
    if (day < 0 || day >= meta.days.length) return badRequest("day out of range");
    if (period < 0 || period >= meta.periods.length) return badRequest("period out of range");

    const sessions = await getSessions(db);
    const result = computeFree(sessions, meta.rooms, meta.teachers, day, period, kind);
    return json(result);
  } catch (error) {
    console.error("free failed", error);
    return serverError("Unable to compute availability");
  }
}
