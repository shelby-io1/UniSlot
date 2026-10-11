import { count } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { requireAdmin } from "@/lib/admin/auth";
import { getDb } from "@/lib/db";
import { auditLogs, classSessions, programs } from "@/lib/db/schema";
import {
  AdminError,
  createEntity,
  deleteEntity,
  getEntity,
  isAdminEntity,
  listEntity,
  updateEntity,
} from "@/lib/services/admin";

let seq = 0;
function unique(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}

afterEach(() => {
  delete process.env.ADMIN_TOKEN;
});

describe("isAdminEntity", () => {
  it("recognises known entities and rejects others", () => {
    expect(isAdminEntity("rooms")).toBe(true);
    expect(isAdminEntity("working-days")).toBe(true);
    expect(isAdminEntity("students")).toBe(false);
  });
});

describe("createEntity", () => {
  it("creates a program and writes an audit entry", async () => {
    const db = await getDb();
    const [before] = await db.select({ n: count() }).from(auditLogs);

    const code = unique("ZP").toUpperCase();
    const row = await createEntity(db, "programs", { code, name: "Admin Test Program" }, "tester");

    expect(row.code).toBe(code);
    const [after] = await db.select({ n: count() }).from(auditLogs);
    expect(after.n).toBe(before.n + 1);
  });

  it("rejects duplicate unique values with a 409", async () => {
    const db = await getDb();
    const code = unique("ZD").toUpperCase();
    await createEntity(db, "programs", { code, name: "First" }, "tester");
    await expect(
      createEntity(db, "programs", { code, name: "Second" }, "tester"),
    ).rejects.toMatchObject({ name: "AdminError", status: 409 });
  });

  it("validates required and typed fields", async () => {
    const db = await getDb();
    await expect(createEntity(db, "subjects", { code: "ZZ1" }, "tester")).rejects.toBeInstanceOf(
      AdminError,
    );
    await expect(
      createEntity(db, "subjects", { title: "Bad Hours", creditHours: -1 }, "tester"),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createEntity(db, "rooms", { name: unique("Room"), kind: "hangar" }, "tester"),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("creates a period with an auto sort order and validates the interval", async () => {
    const db = await getDb();
    const label = unique("L");
    const created = await createEntity(
      db,
      "periods",
      { label, startMinutes: 495, endMinutes: 505 },
      "tester",
    );
    expect(created.sortOrder).toBeGreaterThanOrEqual(0);

    await expect(
      createEntity(db, "periods", { label: unique("L"), startMinutes: 600, endMinutes: 600 }, "tester"),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("requires a batch to reference an existing program", async () => {
    const db = await getDb();
    await expect(
      createEntity(
        db,
        "batches",
        { programId: 999_999_999, semesterNumber: 1, label: unique("ZB") },
        "tester",
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("updateEntity", () => {
  it("updates fields and returns undefined for unknown ids", async () => {
    const db = await getDb();
    const code = unique("ZU").toUpperCase();
    const created = await createEntity(db, "programs", { code, name: "Before" }, "tester");

    const updated = await updateEntity(
      db,
      "programs",
      created.id as number,
      { name: "After" },
      "tester",
    );
    expect(updated?.name).toBe("After");

    const missing = await updateEntity(db, "programs", 999_999_999, { name: "Nope" }, "tester");
    expect(missing).toBeUndefined();
  });

  it("keeps the interval valid when only one endpoint changes", async () => {
    const db = await getDb();
    const created = await createEntity(
      db,
      "periods",
      { label: unique("L"), startMinutes: 700, endMinutes: 800 },
      "tester",
    );
    await expect(
      updateEntity(db, "periods", created.id as number, { endMinutes: 650 }, "tester"),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("deleteEntity", () => {
  it("deletes an unreferenced row", async () => {
    const db = await getDb();
    const created = await createEntity(db, "rooms", { name: unique("Deletable Room") }, "tester");
    const deleted = await deleteEntity(db, "rooms", created.id as number, "tester");
    expect(deleted).toBe(true);
    const gone = await getEntity(db, "rooms", created.id as number);
    expect(gone).toBeUndefined();
  });

  it("refuses to delete a program that still has batches", async () => {
    const db = await getDb();
    const [program] = await db.select().from(programs).limit(1);
    await expect(deleteEntity(db, "programs", program.id, "tester")).rejects.toMatchObject({
      status: 409,
    });
  });

  it("refuses to delete a subject referenced by a session", async () => {
    const db = await getDb();
    const [session] = await db.select({ subjectId: classSessions.subjectId }).from(classSessions).limit(1);
    await expect(
      deleteEntity(db, "subjects", session.subjectId, "tester"),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("returns false for unknown ids", async () => {
    const db = await getDb();
    expect(await deleteEntity(db, "teachers", 999_999_999, "tester")).toBe(false);
  });
});

describe("listEntity", () => {
  it("returns rows for each entity", async () => {
    const db = await getDb();
    const rooms = await listEntity(db, "rooms");
    expect(Array.isArray(rooms)).toBe(true);
    expect(rooms.length).toBeGreaterThan(0);
  });
});

describe("requireAdmin", () => {
  it("returns 503 when no token is configured", () => {
    delete process.env.ADMIN_TOKEN;
    const response = requireAdmin(new Request("http://localhost/api/admin/rooms"));
    expect(response?.status).toBe(503);
  });

  it("returns 401 for a wrong token and null for the right one", () => {
    process.env.ADMIN_TOKEN = "s3cret";
    const wrong = requireAdmin(
      new Request("http://localhost/api/admin/rooms", { headers: { "x-admin-token": "nope" } }),
    );
    expect(wrong?.status).toBe(401);

    const ok = requireAdmin(
      new Request("http://localhost/api/admin/rooms", { headers: { "x-admin-token": "s3cret" } }),
    );
    expect(ok).toBeNull();

    const bearer = requireAdmin(
      new Request("http://localhost/api/admin/rooms", {
        headers: { authorization: "Bearer s3cret" },
      }),
    );
    expect(bearer).toBeNull();
  });
});
