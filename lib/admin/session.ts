import { cookies } from "next/headers";
import { safeEqual } from "./auth";

/**
 * Cookie-based admin session for the admin UI. The cookie holds the shared
 * admin token (httpOnly) and is verified against `ADMIN_TOKEN` on every server
 * render and mutation, so the token never reaches the browser's JS.
 */
export const ADMIN_COOKIE = "unislot_admin_session";
export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 8;

export async function isAdminAuthenticated(): Promise<boolean> {
  const provided = (await cookies()).get(ADMIN_COOKIE)?.value;
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !provided) return false;
  return safeEqual(expected, provided);
}
