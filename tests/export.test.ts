import { beforeAll, describe, expect, it } from "vitest";
import { GET as conflictsExport } from "@/app/api/export/conflicts/route";
import { GET as timetableExport } from "@/app/api/export/timetable/route";
import { getDb, type Database } from "@/lib/db";
import {
  EXPORT_CONTENT_TYPES,
  buildTimetablePdf,
  parseFormat,
  rowsToXlsx,
  safeFilename,
  timetableRows,
  toCsv,
  type SheetColumn,
} from "@/lib/services/export";
import { getMeta, getSessions, type ResolvedSession } from "@/lib/services/timetable";

let db: Database;

const PK = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PDF = "%PDF-";

function session(over: Partial<ResolvedSession> = {}): ResolvedSession {
  return {
    id: 1,
    dayIndex: 0,
    slot: 0,
    periodLabel: "P1",
    startMinutes: 510,
    endMinutes: 555,
    batchId: 1,
    batchLabel: "BSCS-1A",
    roomId: 1,
    roomName: "LH-1",
    teacherId: 1,
    teacherName: "Dr. Ada",
    subjectId: 1,
    subjectTitle: "Programming Fundamentals",
    isRepeater: false,
    ...over,
  };
}

beforeAll(async () => {
  db = await getDb();
});

describe("export helpers", () => {
  it("parses formats with a csv default and rejects unknown values", () => {
    expect(parseFormat(null, ["csv", "xlsx", "pdf"])).toBe("csv");
    expect(parseFormat("", ["csv", "xlsx", "pdf"])).toBe("csv");
    expect(parseFormat(" XLSX ", ["csv", "xlsx", "pdf"])).toBe("xlsx");
    expect(parseFormat("docx", ["csv", "xlsx", "pdf"])).toBeNull();
    expect(parseFormat("pdf", ["csv", "xlsx"])).toBeNull();
  });

  it("sanitises filenames against path traversal and odd characters", () => {
    expect(safeFilename("timetable-batch BSCS-1 A")).toBe("timetable-batch-BSCS-1-A");
    expect(safeFilename("../../etc/passwd")).toBe("etc-passwd");
    expect(safeFilename("")).toBe("export");
  });

  it("escapes CSV fields and terminates lines with CRLF", () => {
    const csv = toCsv(
      ["a", "b", "c"],
      [
        ["plain", 'has "quote"', "has,comma"],
        ["line\nbreak", true, null],
      ],
    );
    expect(csv.startsWith("a,b,c\r\n")).toBe(true);
    expect(csv).toContain('"has ""quote"""');
    expect(csv).toContain('"has,comma"');
    expect(csv).toContain('"line\nbreak",true,');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("orders timetable rows by day, then slot, and formats the period", () => {
    const rows = timetableRows(
      [
        session({ id: 3, dayIndex: 1, slot: 0 }),
        session({ id: 1, dayIndex: 0, slot: 2, periodLabel: "P3", startMinutes: 630, endMinutes: 675 }),
        session({ id: 2, dayIndex: 0, slot: 0 }),
      ],
      ["Mon", "Tue", "Wed", "Thu", "Fri"],
    );
    expect(rows.map((r) => r.day)).toEqual(["Mon", "Mon", "Tue"]);
    expect(rows[0].start).toBe("8:30");
    expect(rows[1].period).toBe("P3 10:30-11:15");
  });

  it("writes an XLSX buffer with a ZIP (PK) header", async () => {
    const columns: SheetColumn<{ name: string; n: number }>[] = [
      { label: "Name", width: 20, get: (r) => r.name },
      { label: "Count", width: 10, align: "right", get: (r) => r.n },
    ];
    const buffer = await rowsToXlsx("Sheet 1", columns, [{ name: "Rooms", n: 39 }]);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 4).equals(PK)).toBe(true);
    expect(buffer.includes("xl/workbook.xml")).toBe(true);
  });

  it("writes a PDF document with a %PDF header", async () => {
    const meta = await getMeta(db);
    const bytes = await buildTimetablePdf({
      title: "Batch timetable — demo",
      dayNames: meta.days,
      periods: meta.periods,
      sessions: [session()],
    });
    expect(Buffer.from(bytes).subarray(0, 5).toString("latin1")).toBe(PDF);
  });
});

describe("export routes", () => {
  let batchId: number;
  let batchLabel: string;
  let teacherId: number;
  let teacherName: string;

  beforeAll(async () => {
    const meta = await getMeta(db);
    batchId = meta.batches[0].id;
    batchLabel = meta.batches[0].label;
    const sessions = await getSessions(db);
    teacherId = sessions[0].teacherId!;
    teacherName = sessions[0].teacherName!;
  });

  it("exports a batch timetable as CSV", async () => {
    const res = await timetableExport(
      new Request(`http://localhost/api/export/timetable?batch=${batchId}`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(EXPORT_CONTENT_TYPES.csv);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const body = await res.text();
    expect(body.startsWith("Day,Period,Start,End,Batch,Subject,Room,Teacher,Repeater")).toBe(true);
    expect(body).toContain(batchLabel);
  });

  it("exports a teacher timetable as XLSX", async () => {
    const csv = await timetableExport(
      new Request(`http://localhost/api/export/timetable?teacher=${teacherId}`),
    );
    expect(await csv.text()).toContain(teacherName);

    const res = await timetableExport(
      new Request(`http://localhost/api/export/timetable?teacher=${teacherId}&format=xlsx`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(EXPORT_CONTENT_TYPES.xlsx);
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 4).equals(PK)).toBe(true);
  });

  it("exports a batch timetable as PDF", async () => {
    const res = await timetableExport(
      new Request(`http://localhost/api/export/timetable?batch=${batchId}&format=pdf`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(EXPORT_CONTENT_TYPES.pdf);
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 5).toString("latin1")).toBe(PDF);
  });

  it("requires exactly one selector and a valid format", async () => {
    expect((await timetableExport(new Request("http://localhost/api/export/timetable"))).status).toBe(400);
    expect(
      (await timetableExport(new Request(`http://localhost/api/export/timetable?batch=${batchId}&teacher=${teacherId}`)))
        .status,
    ).toBe(400);
    expect(
      (await timetableExport(new Request(`http://localhost/api/export/timetable?batch=${batchId}&format=docx`)))
        .status,
    ).toBe(400);
  });

  it("returns 404 for an unknown entity", async () => {
    const res = await timetableExport(
      new Request("http://localhost/api/export/timetable?batch=999999"),
    );
    expect(res.status).toBe(404);
  });

  it("exports the clash report as CSV containing the batch clashes", async () => {
    const res = await conflictsExport(new Request("http://localhost/api/export/conflicts"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(EXPORT_CONTENT_TYPES.csv);
    const body = await res.text();
    expect(body.startsWith("Kind,Day,Entity,Sessions,Repeater,Message")).toBe(true);
    expect(body).toContain("batch");
  });

  it("exports the clash report as XLSX and rejects unsupported formats", async () => {
    const ok = await conflictsExport(
      new Request("http://localhost/api/export/conflicts?format=xlsx"),
    );
    expect(Buffer.from(await ok.arrayBuffer()).subarray(0, 4).equals(PK)).toBe(true);
    const bad = await conflictsExport(
      new Request("http://localhost/api/export/conflicts?format=pdf"),
    );
    expect(bad.status).toBe(400);
  });
});
