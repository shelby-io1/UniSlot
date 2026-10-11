import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { badRequest, intParam, json, serverError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { listAuditEntries } from "@/lib/services/audit";

/**
 * GET /api/admin/audit?before=<id>&limit=<n>
 * Newest-first page of the audit log. Admin-guarded because it exposes actor
 * identities and change payloads.
 */
export async function GET(request: Request) {
  await connection();
  const denied = requireAdmin(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const limit = intParam(params, "limit");
  if (limit !== null && limit <= 0) return badRequest("limit must be a positive integer");

  let beforeId: number | undefined;
  const beforeParam = params.get("before");
  if (beforeParam !== null && beforeParam.trim() !== "") {
    const parsed = Number(beforeParam);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return badRequest("before must be a positive integer");
    }
    beforeId = parsed;
  }

  try {
    const db = await getDb();
    return json(await listAuditEntries(db, { limit: limit ?? undefined, beforeId }));
  } catch (error) {
    console.error("audit list failed", error);
    return serverError("Unable to load audit log");
  }
}
