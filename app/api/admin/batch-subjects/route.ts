import { connection } from "next/server";
import { adminActor, requireAdmin } from "@/lib/admin/auth";
import { adminErrorResponse, readJsonBody } from "@/lib/admin/http";
import { json, serverError } from "@/lib/api";
import { getDb } from "@/lib/db";
import {
  assignSubjectsToBatch,
  listBatchSubjects,
  unassignSubjectFromBatch,
} from "@/lib/services/batch-subjects";

/** GET /api/admin/batch-subjects — list batch→subject assignments (public read). */
export async function GET() {
  await connection();
  try {
    const db = await getDb();
    return json({ items: await listBatchSubjects(db) });
  } catch (error) {
    console.error("batch-subjects list failed", error);
    return serverError();
  }
}

/** POST /api/admin/batch-subjects — assign subject(s) to a batch (requires the admin token). */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    const db = await getDb();
    const body = (await readJsonBody(req)) as { batchId?: unknown; subjectIds?: unknown } | null;
    const items = await assignSubjectsToBatch(
      db,
      body?.batchId,
      body?.subjectIds,
      adminActor(req),
    );
    return json({ items }, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

/** DELETE /api/admin/batch-subjects — unassign a subject from a batch (requires the admin token). */
export async function DELETE(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    const db = await getDb();
    const body = (await readJsonBody(req)) as { batchId?: unknown; subjectId?: unknown } | null;
    const deleted = await unassignSubjectFromBatch(
      db,
      body?.batchId,
      body?.subjectId,
      adminActor(req),
    );
    if (!deleted) return json({ error: "Not found" }, { status: 404 });
    return json({ deleted: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
