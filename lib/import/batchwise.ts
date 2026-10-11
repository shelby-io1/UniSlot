/**
 * Pure parser for the campus "Batchwise" timetable PDF.
 *
 * The PDF is a grid: five day rows (Mon-Fri) crossed with five lecture columns.
 * Each populated cell holds a subject block (bold font), an optional teacher,
 * an optional room, and optional markers ("Repeater", "Lab Group N"). This
 * module contains no I/O so it can be unit-tested against synthetic fixtures;
 * `loadPdfPages` in `./pdf-text` supplies the real coordinates.
 */

export type PdfTextItem = {
  text: string;
  x: number;
  y: number;
  font?: string;
};

export type PdfPage = {
  pageNumber: number;
  items: PdfTextItem[];
};

export type ParsedSession = {
  page: number;
  batchLabel: string;
  day: string;
  dayIndex: number;
  column: number;
  subject: string;
  teacher: string | null;
  room: string | null;
  isRepeater: boolean;
  labGroup: number | null;
  unresolved: string | null;
};

export type ParsedIssue = {
  page: number;
  level: "warning" | "error";
  code: string;
  message: string;
};

export type BatchwiseParseResult = {
  term: string | null;
  pageCount: number;
  sessions: ParsedSession[];
  issues: ParsedIssue[];
};

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

const HEADER_RE = /^Timetable\b/i;
const FOOTER_RE = /^(Timetable generated|aSc Timetables)/i;
const LECTURE_RE = /^Lecture\s*(\d)\b/i;
const TIME_RE = /^\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}$/;
const REPEATER_RE = /^repeat/i;
const GROUP_RE = /group\s*(\d+)/i;

const DEFAULT_BOUNDARIES = [227.0, 365.25, 503.4, 641.5];
const HEADER_MIN_Y = 515;
const TITLE_MIN_Y = 520;
const TITLE_MAX_Y = 590;
// The day label baseline sits ~8pt below the vertical centre of its grid row.
const ROW_CENTER_OFFSET = 8;

type CellLine = { text: string; y: number; font?: string };

type SessionAcc = {
  subject: string[];
  teacher: string[];
  room: string[];
  isRepeater: boolean;
  labGroup: number | null;
  unresolved: string | null;
  sawF1: boolean;
};

function newAcc(): SessionAcc {
  return { subject: [], teacher: [], room: [], isRepeater: false, labGroup: null, unresolved: null, sawF1: false };
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** True when a text token is a room label rather than a person. */
export function isRoom(text: string): boolean {
  const t = normalize(text);
  if (t === "") return false;
  if (/lab/i.test(t)) return true;
  if (/\b(hall|studio|theatre|auditorium|gym)\b/i.test(t)) return true;
  if (/^(LH|CR|LT|LAB|R|L)\s*-?\s*\d+/i.test(t)) return true;
  if (/^[A-Z]{1,4}\s*[C.]?\s*Lab/i.test(t)) return true;
  if (/^\d{1,3}$/.test(t)) return true;
  return false;
}

/** The lecture column for a given x coordinate (0-based). */
export function columnIndexFor(x: number, boundaries: number[] = DEFAULT_BOUNDARIES): number {
  let column = 0;
  for (const boundary of boundaries) if (x > boundary) column++;
  return Math.min(column, boundaries.length);
}

function columnBoundaries(items: PdfTextItem[]): number[] {
  const headers: { n: number; cx: number }[] = [];
  for (const item of items) {
    const match = normalize(item.text).match(LECTURE_RE);
    if (match) headers.push({ n: Number(match[1]), cx: item.x + 30 });
  }
  if (headers.length === 5) {
    const centers = headers.sort((a, b) => a.n - b.n).map((h) => h.cx);
    const boundaries: number[] = [];
    for (let i = 0; i < centers.length - 1; i++) boundaries.push((centers[i] + centers[i + 1]) / 2);
    return boundaries;
  }
  return DEFAULT_BOUNDARIES;
}

type DayLabel = { day: string; dayIndex: number; y: number };

function nearestDay(labels: DayLabel[], y: number): DayLabel | null {
  const center = y - ROW_CENTER_OFFSET;
  let best: DayLabel | null = null;
  let bestDist = Infinity;
  for (const label of labels) {
    const dist = Math.abs(label.y - center);
    if (dist < bestDist) {
      bestDist = dist;
      best = label;
    }
  }
  return best;
}

function classify(line: CellLine, acc: SessionAcc): void {
  const text = normalize(line.text);
  if (text === "") return;

  if (REPEATER_RE.test(text)) {
    acc.isRepeater = true;
    acc.sawF1 = true;
    return;
  }
  const group = text.match(GROUP_RE);
  if (group) {
    acc.labGroup = Number(group[1]);
    acc.sawF1 = true;
    return;
  }
  if (/^AS$/i.test(text)) {
    acc.unresolved = "AS";
    acc.sawF1 = true;
    return;
  }
  // Subject blocks use the bold font (f2 in the source PDF).
  if (line.font && /f2/.test(line.font)) {
    acc.subject.push(text);
    return;
  }
  acc.sawF1 = true;
  if (isRoom(text)) {
    acc.room.push(text);
    return;
  }
  acc.teacher.push(text);
}

/**
 * Splits the lines of one (day, column) cell into one or more sessions. A new
 * session begins at a bold subject line that follows a non-subject line, which
 * is how the PDF stacks parallel lab-group sessions in a single cell.
 */
function splitCell(lines: CellLine[]): SessionAcc[] {
  const accs: SessionAcc[] = [];
  let current = newAcc();
  for (const line of lines.sort((a, b) => b.y - a.y)) {
    const isSubject = /f2/.test(line.font ?? "");
    if (isSubject && current.subject.length > 0 && current.sawF1) {
      accs.push(current);
      current = newAcc();
    }
    classify(line, current);
  }
  accs.push(current);
  return accs;
}

function toSession(acc: SessionAcc, base: {
  page: number;
  batchLabel: string;
  dayIndex: number;
  column: number;
}): ParsedSession | null {
  const subject = acc.subject.join(" ");
  if (subject === "" && acc.unresolved === null) return null;
  return {
    page: base.page,
    batchLabel: base.batchLabel,
    day: DAYS[base.dayIndex],
    dayIndex: base.dayIndex,
    column: base.column,
    subject: acc.unresolved ? acc.unresolved : subject,
    teacher: acc.teacher.length ? acc.teacher.join(" & ") : null,
    room: acc.room.length ? acc.room.join(" & ") : null,
    isRepeater: acc.isRepeater,
    labGroup: acc.labGroup,
    unresolved: acc.unresolved,
  };
}

function parsePage(page: PdfPage, issues: ParsedIssue[]): ParsedSession[] {
  const items = page.items;
  const boundaries = columnBoundaries(items);

  const titleParts: string[] = [];
  const labels: DayLabel[] = [];
  const cellItems: PdfTextItem[] = [];

  for (const item of items) {
    const text = normalize(item.text);
    if (text === "") continue;
    if (FOOTER_RE.test(text)) continue;
    if (HEADER_RE.test(text)) continue;
    const dayIndex = (DAYS as readonly string[]).indexOf(text);
    if (dayIndex >= 0 && item.x < 70) {
      labels.push({ day: text, dayIndex, y: item.y });
      continue;
    }
    if (item.y > TITLE_MAX_Y) continue; // header/title band handled below
    if (item.y > TITLE_MIN_Y) {
      titleParts.push(text);
      continue;
    }
    if (item.y >= HEADER_MIN_Y) continue; // column headers / time ranges
    if (LECTURE_RE.test(text) || TIME_RE.test(text)) continue;
    cellItems.push(item);
  }

  const batchLabel = titleParts.join(" ").trim();

  if (labels.length === 0) {
    issues.push({ page: page.pageNumber, level: "error", code: "no-days", message: "page has no day labels" });
    return [];
  }

  const cells = new Map<string, CellLine[]>();
  for (const item of cellItems) {
    const label = nearestDay(labels, item.y);
    if (!label) continue;
    const column = columnIndexFor(item.x, boundaries);
    const key = `${label.dayIndex}|${column}`;
    const list = cells.get(key) ?? [];
    list.push({ text: item.text, y: item.y, font: item.font });
    cells.set(key, list);
  }

  const sessions: ParsedSession[] = [];
  for (const [key, lines] of cells) {
    const [dayIndex, column] = key.split("|").map(Number);
    for (const acc of splitCell(lines)) {
      const session = toSession(acc, { page: page.pageNumber, batchLabel, dayIndex, column });
      if (session) {
        sessions.push(session);
        if (session.unresolved) {
          issues.push({
            page: page.pageNumber,
            level: "warning",
            code: "unresolved-marker",
            message: `${batchLabel} ${session.day} L${column + 1}: unresolved marker "${session.unresolved}"`,
          });
        }
        continue;
      }
      if (acc.room.length > 0 || acc.teacher.length > 0) {
        issues.push({
          page: page.pageNumber,
          level: "warning",
          code: "orphan-detail",
          message: `${batchLabel} ${DAYS[dayIndex]} L${column + 1}: room/teacher without a subject`,
        });
      }
    }
  }

  sessions.sort((a, b) => a.dayIndex - b.dayIndex || a.column - b.column);
  return sessions;
}

export function parseBatchwisePages(pages: PdfPage[]): BatchwiseParseResult {
  const issues: ParsedIssue[] = [];
  const sessions: ParsedSession[] = [];
  let term: string | null = null;

  for (const page of pages) {
    const pageProblems: ParsedIssue[] = [];
    const parsed = parsePage(page, pageProblems);
    if (!term) {
      const header = page.items
        .filter((i) => HEADER_RE.test(normalize(i.text)) && !FOOTER_RE.test(normalize(i.text)))
        .sort((a, b) => b.y - a.y)[0];
      if (header) term = normalize(header.text);
    }
    if (parsed[0]?.batchLabel === "") {
      pageProblems.push({ page: page.pageNumber, level: "warning", code: "no-title", message: "page has no batch title" });
    }
    issues.push(...pageProblems);
    sessions.push(...parsed);
  }

  return { term, pageCount: pages.length, sessions, issues };
}
