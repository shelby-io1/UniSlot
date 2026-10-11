import { json, serverError } from "../api";
import { AdminError } from "../services/admin";

/** Parses a JSON request body, raising a clean 400 when it is malformed. */
export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AdminError("Request body must be valid JSON");
  }
}

/** Maps a thrown error to a JSON response with an appropriate status. */
export function adminErrorResponse(error: unknown): Response {
  if (error instanceof AdminError) {
    return json({ error: error.message }, { status: error.status });
  }
  const code = (error as { code?: string } | null)?.code;
  if (code === "23505") {
    return json({ error: "A record with that value already exists" }, { status: 409 });
  }
  console.error("admin request failed", error);
  return serverError();
}
