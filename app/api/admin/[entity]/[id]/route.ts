import { connection } from "next/server";
import { adminActor, requireAdmin } from "@/lib/admin/auth";
import { adminErrorResponse, readJsonBody } from "@/lib/admin/http";
import { json, serverError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { deleteEntity, getEntity, isAdminEntity, updateEntity } from "@/lib/services/admin";

type EntityIdContext = { params: Promise<{ entity: string; id: string }> };

function unknownEntity(entity: string): Response {
  return json({ error: `Unknown entity '${entity}'` }, { status: 404 });
}

function badId(): Response {
  return json({ error: "id must be an integer" }, { status: 400 });
}

/** GET /api/admin/[entity]/[id] — read a single row (public read). */
export async function GET(_req: Request, ctx: EntityIdContext) {
  await connection();
  const { entity, id } = await ctx.params;
  if (!isAdminEntity(entity)) return unknownEntity(entity);
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) return badId();
  try {
    const db = await getDb();
    const item = await getEntity(db, entity, numericId);
    if (!item) return json({ error: "Not found" }, { status: 404 });
    return json({ item });
  } catch (error) {
    console.error("admin get failed", error);
    return serverError();
  }
}

/** PATCH /api/admin/[entity]/[id] — update a row (requires the admin token). */
export async function PATCH(req: Request, ctx: EntityIdContext) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { entity, id } = await ctx.params;
  if (!isAdminEntity(entity)) return unknownEntity(entity);
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) return badId();
  try {
    const db = await getDb();
    const body = await readJsonBody(req);
    const item = await updateEntity(db, entity, numericId, body, adminActor(req));
    if (!item) return json({ error: "Not found" }, { status: 404 });
    return json({ item });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

/** DELETE /api/admin/[entity]/[id] — delete a row (requires the admin token). */
export async function DELETE(req: Request, ctx: EntityIdContext) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { entity, id } = await ctx.params;
  if (!isAdminEntity(entity)) return unknownEntity(entity);
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) return badId();
  try {
    const db = await getDb();
    const deleted = await deleteEntity(db, entity, numericId, adminActor(req));
    if (!deleted) return json({ error: "Not found" }, { status: 404 });
    return json({ deleted: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
