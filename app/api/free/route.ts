import { connection } from "next/server";
import { badRequest, intParam, json, serverError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getFreeAvailability } from "@/lib/services/timetable";

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
    const lookup = await getFreeAvailability(db, kind, day, period);
    if (!lookup.ok) {
      return badRequest(lookup.reason === "day" ? "day out of range" : "period out of range");
    }
    return json(lookup.result, {
      headers: { "cache-control": "public, max-age=15, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("free failed", error);
    return serverError("Unable to compute availability");
  }
}
