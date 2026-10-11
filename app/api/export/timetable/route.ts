import { connection } from "next/server";
import { badRequest, intParam, json, serverError } from "@/lib/api";
import { getDb } from "@/lib/db";
import {
  EXPORT_CONTENT_TYPES,
  TIMETABLE_COLUMNS,
  buildTimetablePdf,
  fileResponse,
  parseFormat,
  rowsToXlsx,
  safeFilename,
  timetableRows,
  toCsv,
  type ExportFormat,
} from "@/lib/services/export";
import { getMeta, getSessions } from "@/lib/services/timetable";

const ALLOWED: readonly ExportFormat[] = ["csv", "xlsx", "pdf"];

/**
 * GET /api/export/timetable?batch=<id>|teacher=<id>&format=csv|xlsx|pdf
 * Downloads the uncompressed (one row per period) weekly schedule for a batch or
 * teacher. Defaults to CSV. 404 for an unknown entity; an existing entity with
 * no sessions downloads an empty (header-only) file.
 */
export async function GET(request: Request) {
  await connection();
  const params = new URL(request.url).searchParams;
  const batch = intParam(params, "batch");
  const teacher = intParam(params, "teacher");

  if ((batch === null) === (teacher === null)) {
    return badRequest("provide exactly one of batch or teacher");
  }

  const format = parseFormat(params.get("format"), ALLOWED);
  if (format === null) return badRequest("format must be one of csv, xlsx, pdf");

  try {
    const db = await getDb();
    const meta = await getMeta(db);

    const isBatch = batch !== null;
    const label = isBatch
      ? meta.batches.find((b) => b.id === batch)?.label
      : meta.teachers.find((t) => t.id === teacher)?.name;
    if (!label) return json({ error: `no such ${isBatch ? "batch" : "teacher"}` }, { status: 404 });

    const sessions = await getSessions(
      db,
      isBatch ? { batchId: batch! } : { teacherId: teacher! },
    );
    const rows = timetableRows(sessions, meta.days);
    const headers = TIMETABLE_COLUMNS.map((c) => c.label);
    const matrix = rows.map((r) => TIMETABLE_COLUMNS.map((c) => c.get(r)));

    const base = safeFilename(`timetable-${isBatch ? "batch" : "teacher"}-${label}`, "timetable");

    if (format === "csv") {
      return fileResponse(toCsv(headers, matrix), EXPORT_CONTENT_TYPES.csv, `${base}.csv`);
    }
    if (format === "xlsx") {
      const buffer = await rowsToXlsx("Timetable", TIMETABLE_COLUMNS, rows);
      return fileResponse(buffer, EXPORT_CONTENT_TYPES.xlsx, `${base}.xlsx`);
    }
    const pdf = await buildTimetablePdf({
      title: `${isBatch ? "Batch" : "Teacher"} timetable — ${label}`,
      dayNames: meta.days,
      periods: meta.periods,
      sessions,
    });
    return fileResponse(pdf, EXPORT_CONTENT_TYPES.pdf, `${base}.pdf`);
  } catch (error) {
    console.error("timetable export failed", error);
    return serverError("Unable to export timetable");
  }
}
