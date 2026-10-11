import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import writeXlsxFile from "write-excel-file/node";
import type { Cell } from "write-excel-file/node";
import type { MetaPeriod, ResolvedSession } from "@/lib/services/timetable";
import { formatMinutes } from "@/lib/time";

/**
 * Phase 6 export service.
 *
 * Produces real files (CSV, XLSX, PDF) from the database. Everything here is a
 * pure function of the data passed in, so the writers are unit-testable without
 * a database (buffers start with the correct magic bytes and round-trip).
 */

export const EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

/**
 * Parses the `format` query param against the formats the endpoint supports.
 * Missing/empty → `csv`; anything else → null (the route returns 400).
 */
export function parseFormat(
  value: string | null | undefined,
  allowed: readonly ExportFormat[],
): ExportFormat | null {
  if (value === null || value === undefined || value.trim() === "") return "csv";
  const v = value.trim().toLowerCase();
  return (allowed as readonly string[]).includes(v) ? (v as ExportFormat) : null;
}

/** Turns a label into a safe attachment filename (strips path characters). */
export function safeFilename(name: string, fallback = "export"): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .replace(/\.\./g, ".")
    .slice(0, 120);
  return cleaned || fallback;
}

function stringify(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** Escapes a value for a CSV field (RFC 4180-style quotes). */
export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(headers: string[], rows: (string | number | boolean | null)[][]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map((v) => csvEscape(stringify(v))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export type SheetColumn<T> = {
  label: string;
  width: number;
  align?: "left" | "center" | "right";
  get: (row: T) => string | number | boolean | null;
};

function cellOf(value: string | number | boolean | null, align: "left" | "center" | "right"): Cell {
  if (value === null || value === undefined) return { value: "" };
  if (typeof value === "boolean") return { value, type: Boolean, align };
  if (typeof value === "number") return { value, type: Number, align };
  return { value, align };
}

/** Serialises rows into a real XLSX workbook buffer. */
export async function rowsToXlsx<T>(
  sheetName: string,
  columns: SheetColumn<T>[],
  rows: T[],
): Promise<Buffer> {
  const safeSheet = sheetName
    .replace(/[\\/*?:[\]]/g, "-")
    .slice(0, 31);
  const header: Cell[] = columns.map((c) => ({
    value: c.label,
    fontWeight: "bold",
    backgroundColor: "#E8E8E8",
    align: c.align ?? "left",
  }));
  const body: Cell[][] = rows.map((r) =>
    columns.map((c) => cellOf(c.get(r), c.align ?? "left")),
  );
  const workbook = writeXlsxFile([header, ...body], {
    sheet: safeSheet,
    columns: columns.map((c) => ({ width: c.width })),
  });
  return workbook.toBuffer();
}

// ---------------------------------------------------------------------------
// Timetable export
// ---------------------------------------------------------------------------

export type TimetableRow = {
  day: string;
  period: string;
  start: string;
  end: string;
  batch: string;
  subject: string;
  room: string;
  teacher: string;
  repeater: boolean;
};

/**
 * One row per scheduled session (period + times resolved from the period
 * definition), ordered by day then period slot then session id. Lossless — no
 * consecutive-block merging in exports, so the data matches the database.
 */
export function timetableRows(sessions: ResolvedSession[], dayNames: string[]): TimetableRow[] {
  const sorted = [...sessions].sort(
    (a, b) => a.dayIndex - b.dayIndex || a.slot - b.slot || a.id - b.id,
  );
  return sorted.map((s) => ({
    day: dayNames[s.dayIndex] ?? `Day ${s.dayIndex + 1}`,
    period: `${s.periodLabel} ${formatMinutes(s.startMinutes)}-${formatMinutes(s.endMinutes)}`,
    start: formatMinutes(s.startMinutes),
    end: formatMinutes(s.endMinutes),
    batch: s.batchLabel,
    subject: s.subjectTitle,
    room: s.roomName ?? "",
    teacher: s.teacherName ?? "",
    repeater: s.isRepeater,
  }));
}

export const TIMETABLE_COLUMNS: SheetColumn<TimetableRow>[] = [
  { label: "Day", width: 12, get: (r) => r.day },
  { label: "Period", width: 14, get: (r) => r.period },
  { label: "Start", width: 8, get: (r) => r.start },
  { label: "End", width: 8, get: (r) => r.end },
  { label: "Batch", width: 18, get: (r) => r.batch },
  { label: "Subject", width: 28, get: (r) => r.subject },
  { label: "Room", width: 16, get: (r) => r.room },
  { label: "Teacher", width: 24, get: (r) => r.teacher },
  { label: "Repeater", width: 10, get: (r) => r.repeater },
];

/**
 * A PDF grid: rows are days, columns are periods, each cell holds the
 * subject/room/teacher (and batch, for a combined teacher class). Blank cells
 * mean no class in that slot.
 */
export async function buildTimetablePdf(opts: {
  title: string;
  dayNames: string[];
  periods: MetaPeriod[];
  sessions: ResolvedSession[];
}): Promise<Uint8Array> {
  const { title, dayNames, periods, sessions } = opts;
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("UniSlot");

  const page = doc.addPage([841.89, 595.28]); // A4 landscape
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const shade = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  };

  const margin = 36;
  const dayColWidth = 86;
  const headerH = 22;
  const cellH = 46;
  const labelGap = 4;
  const lh = 7.6; // line height at 6.5pt

  const fit = (text: string, max: number): string => {
    if (font.widthOfTextAtSize(text, 6.5) <= max) return text;
    let out = text;
    while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, 6.5) > max) {
      out = out.slice(0, -1);
    }
    return `${out}…`;
  };

  const sortedPeriods = [...periods].sort((a, b) => a.sortOrder - b.sortOrder);
  const byKey = new Map<string, ResolvedSession[]>();
  for (const s of sessions) {
    const key = `${s.dayIndex}:${s.slot}`;
    const list = byKey.get(key) ?? [];
    list.push(s);
    byKey.set(key, list);
  }

  const gridLeft = margin + dayColWidth;
  const gridRight = 841.89 - margin;
  const colWidth = (gridRight - gridLeft) / sortedPeriods.length;
  const gridTop = 595.28 - margin - headerH;

  const grey = shade("#E0E0E0");
  const light = shade("#F4F4F4");
  const dark = rgb(0.2, 0.2, 0.2);

  // Title
  page.drawText(title, { x: margin, y: 595.28 - 26, size: 13, font: bold, color: dark });
  page.drawText("1 cell = 1 slot. Blank = no class.", {
    x: margin,
    y: 595.28 - 40,
    size: 7,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  // Column header row (period labels)
  page.drawRectangle({
    x: gridLeft,
    y: gridTop - headerH,
    width: gridRight - gridLeft,
    height: headerH,
    color: grey,
  });
  sortedPeriods.forEach((p, col) => {
    const x = gridLeft + col * colWidth;
    const label = `${p.label}  ${p.displayStart}–${p.displayEnd}`;
    page.drawText(label, { x: x + 4, y: gridTop - 15, size: 7, font: bold, color: dark });
  });

  // Day label column
  [...dayNames, ...Array(Math.max(0, 5 - dayNames.length)).fill("")].forEach((_, row) => {
    if (row === 0 && dayNames.length === 0) return;
    const yTop = gridTop - headerH - row * cellH;
    page.drawRectangle({ x: margin, y: yTop - cellH, width: dayColWidth, height: cellH, color: light });
    const day = dayNames[row] ?? `Day ${row + 1}`;
    page.drawText(fit(day, dayColWidth - 10), { x: margin + 4, y: yTop - cellH + 4, size: 7, font: bold, color: dark });
  });

  // Body cells
  for (let row = 0; row < Math.max(dayNames.length, 1); row++) {
    const yTop = gridTop - headerH - row * cellH;
    for (let col = 0; col < sortedPeriods.length; col++) {
      const x = gridLeft + col * colWidth;
      page.drawRectangle({ x, y: yTop - cellH, width: colWidth, height: cellH, color: rgb(1, 1, 1) });
      page.drawRectangle({ x, y: yTop - cellH, width: colWidth, height: cellH, borderColor: grey, borderWidth: 0.5 });

      const cells = byKey.get(`${row}:${col}`) ?? [];
      if (cells.length === 0) {
        page.drawText("—", { x: x + colWidth / 2 - 3, y: yTop - cellH + 4, size: 6, font, color: rgb(0.7, 0.7, 0.7) });
        continue;
      }
      let cursor = yTop - cellH + 4;
      for (const s of cells) {
        const lines = [
          fit(s.subjectTitle, colWidth - labelGap),
          [s.batchLabel, s.roomName, s.teacherName].filter(Boolean).join(" · "),
        ];
        for (const line of lines) {
          if (cursor - lh < yTop - cellH) break;
          page.drawText(fit(line, colWidth - labelGap), { x: x + 2, y: cursor, size: 6.5, font, color: dark });
          cursor -= lh;
        }
        cursor -= 2;
      }
    }
  }

  // Horizontal grid lines
  for (let row = 0; row <= Math.max(dayNames.length, 1); row++) {
    const y = gridTop - headerH - row * cellH;
    page.drawLine({ start: { x: margin, y }, end: { x: gridRight, y }, thickness: 0.5, color: grey });
  }

  return doc.save();
}

// ---------------------------------------------------------------------------
// Clash report export
// ---------------------------------------------------------------------------

export type ConflictRow = {
  kind: string;
  day: string;
  entity: string;
  sessions: string;
  repeats: boolean;
  message: string;
};

/** Wraps a file buffer in a downloadable Response with the right headers. */
export function fileResponse(
  body: string | Uint8Array | Buffer,
  contentType: string,
  filename: string,
): Response {
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : new Uint8Array(body);
  return new Response(bytes, {
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

export const CONFLICT_COLUMNS: SheetColumn<ConflictRow>[] = [
  { label: "Kind", width: 10, get: (r) => r.kind },
  { label: "Day", width: 12, get: (r) => r.day },
  { label: "Entity", width: 24, get: (r) => r.entity },
  { label: "Sessions", width: 12, get: (r) => r.sessions },
  { label: "Repeater", width: 10, get: (r) => r.repeats },
  { label: "Message", width: 70, get: (r) => r.message },
];