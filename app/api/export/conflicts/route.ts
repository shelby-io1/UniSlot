import { connection } from "next/server";
import { badRequest, intParam, serverError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { detectClashes } from "@/lib/services/clashes";
import {
  CONFLICT_COLUMNS,
  EXPORT_CONTENT_TYPES,
  fileResponse,
  parseFormat,
  rowsToXlsx,
  safeFilename,
  toCsv,
  type ConflictRow,
  type ExportFormat,
} from "@/lib/services/export";

const ALLOWED: readonly ExportFormat[] = ["csv", "xlsx"];

/**
 * GET /api/export/conflicts?term=<id>&format=csv|xlsx
 * Downloads the clash report (one row per clash) for a term (defaults to the
 * active term). Defaults to CSV.
 */
export async function GET(request: Request) {
  await connection();
  const params = new URL(request.url).searchParams;
  const term = intParam(params, "term");

  const format = parseFormat(params.get("format"), ALLOWED);
  if (format === null) return badRequest("format must be one of csv, xlsx");

  try {
    const db = await getDb();
    const report = await detectClashes(db, term ?? undefined);
    const rows: ConflictRow[] = report.clashes.map((c) => ({
      kind: c.kind,
      day: c.dayName,
      entity: c.entityLabel,
      sessions: c.sessionIds.join(" + "),
      repeats: c.repeats,
      message: c.message,
    }));

    const headers = CONFLICT_COLUMNS.map((c) => c.label);
    const matrix = rows.map((r) => CONFLICT_COLUMNS.map((c) => c.get(r)));
    const base = safeFilename(
      `conflicts-${report.termId === null ? "all" : `term-${report.termId}`}`,
      "conflicts",
    );

    if (format === "csv") {
      return fileResponse(toCsv(headers, matrix), EXPORT_CONTENT_TYPES.csv, `${base}.csv`);
    }
    const buffer = await rowsToXlsx("Conflicts", CONFLICT_COLUMNS, rows);
    return fileResponse(buffer, EXPORT_CONTENT_TYPES.xlsx, `${base}.xlsx`);
  } catch (error) {
    console.error("conflicts export failed", error);
    return serverError("Unable to export conflicts");
  }
}
