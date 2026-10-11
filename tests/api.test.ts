import { describe, expect, it } from "vitest";
import { GET as freeGET } from "@/app/api/free/route";
import { GET as healthGET } from "@/app/api/health/route";
import { GET as metaGET } from "@/app/api/meta/route";
import { GET as timetableGET } from "@/app/api/timetable/route";

describe("API route handlers", () => {
  it("GET /api/health reports ok with seeded counts", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.driver).toBe("pglite");
    expect(body.counts.sessions).toBe(813);
    expect(body.counts.batches).toBe(56);
  });

  it("GET /api/meta returns the reference data", async () => {
    const res = await metaGET();
    const body = await res.json();
    expect(body.days).toHaveLength(5);
    expect(body.periods).toHaveLength(5);
    expect(body.rooms).toHaveLength(39);
    expect(body.teachers).toHaveLength(99);
    expect(body.batches).toHaveLength(56);
    expect(body.term.name).toContain("Sep 14, 2026");
  });

  it("GET /api/free partitions every room into free or busy", async () => {
    const res = await freeGET(new Request("http://localhost/api/free?kind=rooms&day=0&period=0"));
    const body = await res.json();
    expect(body.freeRooms.length + body.busyRooms.length).toBe(39);
  });

  it("GET /api/free partitions every teacher into free or busy", async () => {
    const res = await freeGET(new Request("http://localhost/api/free?kind=teachers&day=0&period=0"));
    const body = await res.json();
    expect(body.freeTeachers.length + body.busyTeachers.length).toBe(99);
  });

  it("GET /api/free rejects invalid input", async () => {
    const res = await freeGET(new Request("http://localhost/api/free?kind=rooms&day=x&period=0"));
    expect(res.status).toBe(400);
  });

  it("GET /api/timetable returns five days for a batch", async () => {
    const metaRes = await metaGET();
    const meta = await metaRes.json();
    const batchId = meta.batches[0].id;
    const res = await timetableGET(
      new Request(`http://localhost/api/timetable?batch=${batchId}`),
    );
    const body = await res.json();
    expect(body.mode).toBe("batch");
    expect(body.days).toHaveLength(5);
  });

  it("GET /api/timetable requires exactly one selector", async () => {
    const res = await timetableGET(new Request("http://localhost/api/timetable"));
    expect(res.status).toBe(400);
  });
});
