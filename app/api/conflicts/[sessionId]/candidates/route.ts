import { connection } from "next/server";
import { badRequest, json, serverError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { findCandidates, loadSolverInput } from "@/lib/services/solver";

/**
 * GET /api/conflicts/<sessionId>/candidates
 * Preview: legal alternative placements for one clashing session against the
 * rest of the schedule (nothing else moves).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  await connection();
  const sessionId = Number((await params).sessionId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return badRequest("invalid session id");
  }

  try {
    const db = await getDb();
    const { termId, input } = await loadSolverInput(db);
    const session = input.sessions.find((s) => s.id === sessionId);
    if (!session) {
      return json({ sessionId, termId, found: false, candidates: [] });
    }
    const candidates = findCandidates(input, sessionId);
    return json({
      sessionId,
      termId,
      found: true,
      current: { dayIndex: session.dayIndex, periodId: session.periodId, roomId: session.roomId },
      candidates,
    });
  } catch (error) {
    console.error("candidates failed", error);
    return serverError("Unable to compute candidates");
  }
}