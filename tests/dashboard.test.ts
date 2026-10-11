import { beforeAll, describe, expect, it } from "vitest";
import { GET as dashboardGET } from "@/app/api/dashboard/route";
import { getDb, type Database } from "@/lib/db";
import { getDashboardStats } from "@/lib/services/dashboard";

let db: Database;

beforeAll(async () => {
  db = await getDb();
});

describe("dashboard stats", () => {
  it("reports the seeded catalogue counts", async () => {
    const stats = await getDashboardStats(db);
    expect(stats.counts.rooms).toBe(39);
    expect(stats.counts.teachers).toBe(99);
    expect(stats.counts.batches).toBe(56);
    expect(stats.counts.periods).toBe(5);
    expect(stats.counts.workingDays).toBe(5);
    expect(stats.counts.programs).toBeGreaterThan(0);
    expect(stats.counts.subjects).toBeGreaterThan(0);
  });

  it("reports the active term and its sessions", async () => {
    const stats = await getDashboardStats(db);
    expect(stats.term).not.toBeNull();
    expect(stats.term!.sessions).toBe(813);
    expect(stats.clashes.sessionsChecked).toBe(813);
  });

  it("reports clashes straight from the detector", async () => {
    const stats = await getDashboardStats(db);
    expect(stats.clashes.total).toBe(38);
    expect(stats.clashes.batch).toBe(38);
    expect(stats.clashes.course).toBe(0);
    expect(stats.clashes.teacher).toBe(0);
    expect(stats.clashes.room).toBe(0);
    expect(stats.clashes.repeatsInvolved).toBe(4);
  });

  it("serves the same data over /api/dashboard", async () => {
    const res = await dashboardGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts.rooms).toBe(39);
    expect(body.term.sessions).toBe(813);
    expect(body.clashes.total).toBe(38);
  });
});
