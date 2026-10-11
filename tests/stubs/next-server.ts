// Test stub for `next/server`. Route handlers call `connection()` to opt out of
// prerendering; in the Vitest (plain Node) environment there is no Next render
// context, so the call is a no-op.
export async function connection(): Promise<void> {}

export class NextResponse extends Response {
  static json(data: unknown, init?: ResponseInit): NextResponse {
    return new NextResponse(JSON.stringify(data), {
      ...init,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(init?.headers ?? {}),
      },
    });
  }
}
