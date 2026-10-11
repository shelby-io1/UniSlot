/** Shared helpers for API route handlers. */

export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

export function badRequest(message: string): Response {
  return json({ error: message }, { status: 400 });
}

export function serverError(message = "Internal server error"): Response {
  return json({ error: message }, { status: 500 });
}

/** Parses an integer query param, returning null when absent or invalid. */
export function intParam(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}
