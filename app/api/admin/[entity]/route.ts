import { connection } from "next/server";
import { adminActor, requireAdmin } from "@/lib/admin/auth";
import { adminErrorResponse, readJsonBody } from "@/lib/admin/http";
import { json, serverError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { createEntity, isAdminEntity, listEntity } from "@/lib/services/admin";

type EntityContext = { params: Promise<{ entity: string }> };

function unknownEntity(entity: string): Response {
  return json({ error: `Unknown entity '${entity}'` }, { status: 404 });
}

/** GET /api/admin/[entity] — list all rows for an entity (public read). */
export async function GET(_req: Request, ctx: EntityContext) {
  await connection();
  const { entity } = await ctx.params;
  if (!isAdminEntity(entity)) return unknownEntity(entity);
  try {
    const db = await getDb();
    return json({ entity, items: await listEntity(db, entity) });
  } catch (error) {
    console.error("admin list failed", error);
    return serverError();
  }
}

/** POST /api/admin/[entity] — create a row (requires the admin token). */
export async function POST(req: Request, ctx: EntityContext) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { entity } = await ctx.params;
  if (!isAdminEntity(entity)) return unknownEntity(entity);
  try {
    const db = await getDb();
    const body = await readJsonBody(req);
    const item = await createEntity(db, entity, body, adminActor(req));
    return json({ item }, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
