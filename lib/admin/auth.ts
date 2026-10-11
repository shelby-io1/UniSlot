import { timingSafeEqual } from "node:crypto";

/**
 * Guards admin mutation endpoints with a shared secret.
 *
 * The token is read from the `ADMIN_TOKEN` environment variable and supplied by
 * the caller either as an `x-admin-token` header or as `Authorization: Bearer
 * <token>`. Read-only endpoints are intentionally not gated here.
 */

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** Constant-time comparison of two secrets. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return left.length > 0 && timingSafeEqual(left, right);
}

/**
 * Returns a Response to short-circuit the request when the caller is not
 * authorised, or `null` when the request may proceed.
 */
export function requireAdmin(req: Request): Response | null {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return Response.json(
      { error: "Admin API is not configured (ADMIN_TOKEN is unset)" },
      { status: 503 },
    );
  }
  const provided = req.headers.get("x-admin-token")?.trim() ?? bearerToken(req);
  if (!provided || !safeEqual(expected, provided)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** The actor recorded on audit entries (defaults to "admin"). */
export function adminActor(req: Request): string {
  return req.headers.get("x-admin-actor")?.trim() || "admin";
}
