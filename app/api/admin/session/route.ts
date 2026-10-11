import { cookies } from "next/headers";
import { connection } from "next/server";
import { ADMIN_COOKIE, isAdminAuthenticated } from "@/lib/admin/session";
import { json } from "@/lib/api";

/** GET /api/admin/session — report whether the current cookie is an admin session. */
export async function GET() {
  await connection();
  return json({ authenticated: await isAdminAuthenticated() });
}

/** DELETE /api/admin/session — clear the admin session cookie (sign out). */
export async function DELETE() {
  await connection();
  (await cookies()).delete(ADMIN_COOKIE);
  return json({ authenticated: false });
}
