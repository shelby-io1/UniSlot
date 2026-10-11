import { connection } from "next/server";
import { adminActor, requireAdmin } from "@/lib/admin/auth";
import { badRequest, json, serverError } from "@/lib/api";
import { getDb } from "@/lib/db";
import {
  applyResolution,
  ResolutionConflict,
  type ExpectedPlacement,
  type Move,
} from "@/lib/services/resolution";

/**
 * POST /api/resolutions
 * Applies approved solver moves atomically.
 * Body: { term?, expected: { [sessionId]: {dayIndex, periodId, roomId} }, moves: [{sessionId, dayIndex, periodId, roomId}] }
 * Guarded by the admin token; performs optimistic version checks and full-term
 * revalidation before committing, and aborts (409/422) on failure.
 */
export async function POST(request: Request) {
  await connection();
  const denied = requireAdmin(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  if (!isRecord(body)) return badRequest("body must be a JSON object");

  const moves = parseMoves(body.moves);
  if (moves === null) return badRequest("moves must be an array of {sessionId, dayIndex, periodId, roomId}");
  if (moves.length === 0) return badRequest("no moves to apply");

  const expected = parseExpected(body.expected);
  if (expected === null) return badRequest("expected must map each sessionId to {dayIndex, periodId, roomId}");

  const termId = Number.isInteger(body.termId) ? (body.termId as number) : undefined;

  try {
    const db = await getDb();
    const result = await applyResolution(db, { moves, expected, termId, actor: adminActor(request) });
    return json(result);
  } catch (error) {
    if (error instanceof ResolutionConflict) {
      const status = error.code === "version" ? 409 : error.code === "invalid" ? 400 : 422;
      return json({ error: error.message, code: error.code }, { status });
    }
    console.error("resolution failed", error);
    return serverError("Unable to apply resolution");
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return Number.isInteger(v);
}

function parsePlacement(v: unknown): ExpectedPlacement | null {
  if (!isRecord(v)) return null;
  const roomId = v.roomId === null || v.roomId === undefined ? null : v.roomId;
  if (!isInt(v.dayIndex) || !isInt(v.periodId) || !(roomId === null || isInt(roomId))) return null;
  return { dayIndex: v.dayIndex, periodId: v.periodId, roomId };
}

function parseExpected(v: unknown): Record<number, ExpectedPlacement> | null {
  if (!isRecord(v)) return null;
  const out: Record<number, ExpectedPlacement> = {};
  for (const [key, val] of Object.entries(v)) {
    const id = Number(key);
    if (!Number.isInteger(id) || !Object.hasOwn(v, key)) return null;
    const placement = parsePlacement(val);
    if (!placement) return null;
    out[id] = placement;
  }
  return out;
}

function parseMoves(v: unknown): Move[] | null {
  if (!Array.isArray(v)) return null;
  const out: Move[] = [];
  for (const item of v) {
    if (!isRecord(item)) return null;
    if (!isInt(item.sessionId)) return null;
    const placement = parsePlacement(item);
    if (!placement) return null;
    out.push({ sessionId: item.sessionId, ...placement });
  }
  return out;
}