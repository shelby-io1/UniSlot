import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { describeDriver, getDb } from "@/lib/db";
import { batches, classSessions, programs, rooms, subjects, teachers } from "@/lib/db/schema";
import { parseBatchLabel } from "@/lib/db/seed";

describe("database seed (in-memory PGlite)", () => {
  it("uses the in-memory PGlite driver when no DATABASE_URL is set", () => {
    const info = describeDriver();
    expect(info.driver).toBe("pglite");
    expect(info.persistent).toBe(false);
  });

  it("seeds the full CUISlot dataset", async () => {
    const db = await getDb();
    const [p] = await db.select({ n: count() }).from(programs);
    const [b] = await db.select({ n: count() }).from(batches);
    const [r] = await db.select({ n: count() }).from(rooms);
    const [t] = await db.select({ n: count() }).from(teachers);
    const [s] = await db.select({ n: count() }).from(subjects);
    const [c] = await db.select({ n: count() }).from(classSessions);

    expect(b.n).toBe(56);
    expect(r.n).toBe(39);
    expect(t.n).toBe(99);
    expect(s.n).toBe(200);
    expect(c.n).toBe(813);
    expect(p.n).toBeGreaterThan(0);
  });

  it("is idempotent (re-running does not duplicate rows)", async () => {
    const db = await getDb();
    const before = await db.select({ n: count() }).from(classSessions);
    const second = await getDb();
    const after = await second.select({ n: count() }).from(classSessions);
    expect(after[0].n).toBe(before[0].n);
  });
});

describe("parseBatchLabel", () => {
  it("splits the program prefix from the roman-numeral semester", () => {
    expect(parseBatchLabel("BS(CS)-III")).toEqual({ program: "BS(CS)", semesterNumber: 3 });
    expect(parseBatchLabel("BS(A&F)-VIII")).toEqual({ program: "BS(A&F)", semesterNumber: 8 });
    expect(parseBatchLabel("BS(CS)-I")).toEqual({ program: "BS(CS)", semesterNumber: 1 });
  });
});
