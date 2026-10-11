import { connection } from "next/server";
import { intParam, json, serverError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { detectClashes } from "@/lib/services/clashes";

/**
 * GET /api/conflicts[?term=<id>]
 * Reports every entity-level schedule clash (batch, course, teacher, room) for
 * the active term (or an explicit term). Read-only.
 */
export async function GET(request: Request) {
  await connection();
  const params = new URL(request.url).searchParams;
  const term = intParam(params, "term");

  try {
    const db = await getDb();
    const report = await detectClashes(db, term ?? undefined);
    return json(report);
  } catch (error) {
    console.error("conflicts failed", error);
    return serverError("Unable to compute clashes");
  }
}
