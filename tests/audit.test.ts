import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as auditGET } from "@/app/api/admin/audit/route";
import { getDb, type Database } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { countAuditEntries, listAuditEntries } from "@/lib/services/audit";

let db: Database;

beforeAll(async () => {
  db = await getDb();
});

describe("audit service", () => {
  it("starts with the two seed baseline entries, newest first", async () => {
    const page = await listAuditEntries(db);
    expect(page.entries.length).toBe(2);
    expect(page.entries[0].id).toBeGreaterThan(page.entries[1].id);
    expect(page.nextId).toBeNull();
    expect(await countAuditEntries(db)).toBe(2);
  });

  it("paginates newest-first with an id cursor", async () => {
    const baseline = await countAuditEntries(db);
    await db.insert(auditLogs).values(
      Array.from({ length: 5 }, (_, i) => ({
        action: "test.create",
        entity: "t",
        entityId: String(i),
        actor: "tester",
        detail: { i },
      })),
    );
    expect(await countAuditEntries(db)).toBe(baseline + 5);

    const first = await listAuditEntries(db, { limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.entries[0].id).toBeGreaterThan(first.entries[1].id);
    expect(first.nextId).toBe(first.entries[1].id);
    expect(first.entries[0].detail).toEqual({ i: 4 });

    const second = await listAuditEntries(db, { limit: 2, beforeId: first.nextId! });
    expect(second.entries).toHaveLength(2);
    expect(Math.max(...second.entries.map((e) => e.id))).toBeLessThan(first.nextId!);

    const third = await listAuditEntries(db, { limit: 2, beforeId: second.nextId! });
    expect(third.entries).toHaveLength(2);
    expect(third.nextId).toBe(third.entries[1].id);

    const fourth = await listAuditEntries(db, { limit: 2, beforeId: third.nextId! });
    expect(fourth.entries).toHaveLength(1);
    expect(fourth.nextId).toBeNull();
  });
});

describe("audit route guard", () => {
  const previous = process.env.ADMIN_TOKEN;

  afterAll(() => {
    if (previous === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previous;
  });

  it("returns 503 when ADMIN_TOKEN is unset", async () => {
    delete process.env.ADMIN_TOKEN;
    const res = await auditGET(new Request("http://localhost/api/admin/audit"));
    expect(res.status).toBe(503);
  });

  it("returns 401 for a wrong token", async () => {
    process.env.ADMIN_TOKEN = "secret";
    const res = await auditGET(
      new Request("http://localhost/api/admin/audit", { headers: { "x-admin-token": "nope" } }),
    );
    expect(res.status).toBe(401);
  });

  it("returns a page for the correct token", async () => {
    process.env.ADMIN_TOKEN = "secret";
    const res = await auditGET(
      new Request("http://localhost/api/admin/audit?limit=2", {
        headers: { "x-admin-token": "secret" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(2);
    expect(typeof body.nextId).toBe("number");
  });

  it("rejects an invalid cursor", async () => {
    process.env.ADMIN_TOKEN = "secret";
    const res = await auditGET(
      new Request("http://localhost/api/admin/audit?before=-1", {
        headers: { "x-admin-token": "secret" },
      }),
    );
    expect(res.status).toBe(400);
  });
});
