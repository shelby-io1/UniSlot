import { describe, expect, it } from "vitest";
import {
  columnIndexFor,
  isRoom,
  parseBatchwisePages,
  type PdfPage,
  type PdfTextItem,
} from "@/lib/import/batchwise";

function item(text: string, x: number, y: number, font = "g_d0_f1"): PdfTextItem {
  return { text, x, y, font };
}

function page(items: PdfTextItem[], pageNumber = 1): PdfPage {
  return { pageNumber, items };
}

const baseHeader = (batch: string): PdfTextItem[] => [
  item("Timetable generated:9/18/2026", 12.24, 21.72),
  item(term(), 227.53, 594.26),
  item(batch, 328.31, 561.95),
  item("Lecture 1", 127.67, 519.96),
  item("Lecture 2", 265.79, 519.96),
  item("Lecture 3", 404.04, 519.96),
  item("Lecture 4", 542.16, 519.96),
  item("Lecture 5", 680.28, 519.96),
  item("8:30 - 10:00", 123.36, 504.24),
  item("10:00 - 11:30", 257.99, 504.24),
  item("11:30 - 13:15", 396.11, 504.24),
  item("13:35 - 15:00", 534.23, 504.24),
  item("15:00 - 16:30", 672.47, 504.24),
  item("aSc Timetables", 713.79, 21.72),
];

function term(): string {
  return "Timetable CUI Attock Campus w.e.f Sep 14, 2026";
}

const dayLabels = (): PdfTextItem[] => [
  item("Mon", 18.01, 440.39),
  item("Tue", 21.72, 346.79),
  item("Wed", 16.08, 253.09),
  item("Thu", 21.72, 159.49),
  item("Fri", 30.95, 65.89),
];

describe("batchwise parser", () => {
  it("classifies rooms and lecture columns", () => {
    expect(isRoom("LH 2")).toBe(true);
    expect(isRoom("CR7")).toBe(true);
    expect(isRoom("LT 9")).toBe(true);
    expect(isRoom("EE C.Lab (U)")).toBe(true);
    expect(isRoom("CS C.Lab 3")).toBe(true);
    expect(isRoom("Dr. Ismail")).toBe(false);
    expect(isRoom("Bukhari Maryam")).toBe(false);

    expect(columnIndexFor(120)).toBe(0);
    expect(columnIndexFor(265)).toBe(1);
    expect(columnIndexFor(410)).toBe(2);
    expect(columnIndexFor(560)).toBe(3);
    expect(columnIndexFor(700)).toBe(4);
  });

  it("reads the term and batch title and skips page furniture", () => {
    const result = parseBatchwisePages([page([...baseHeader("BS(CS)-I"), ...dayLabels()])]);
    expect(result.term).toBe("Timetable CUI Attock Campus w.e.f Sep 14, 2026");
    expect(result.sessions).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
  });

  it("parses a single session with a multi-line subject", () => {
    const items = [
      ...baseHeader("BS(CS)-I"),
      ...dayLabels(),
      item("Application of Information", 98.4, 485.15, "g_d0_f2"),
      item("and Communication", 98.4, 473.74, "g_d0_f2"),
      item("Technologies (Lab)", 98.4, 462.34, "g_d0_f2"),
      item("Mr. Umar Zia", 133.44, 449.27),
      item("EE C.Lab (U)", 133.44, 411.71),
    ];
    const [session] = parseBatchwisePages([page(items)]).sessions;
    expect(session.day).toBe("Mon");
    expect(session.column).toBe(0);
    expect(session.subject).toBe("Application of Information and Communication Technologies (Lab)");
    expect(session.teacher).toBe("Mr. Umar Zia");
    expect(session.room).toBe("EE C.Lab (U)");
    expect(session.isRepeater).toBe(false);
  });

  it("records repeater and lab-group markers", () => {
    const items = [
      ...baseHeader("BS(CS)-I"),
      ...dayLabels(),
      item("Programming Fundamentals", 95.76, 391.55, "g_d0_f2"),
      item("Repeater", 95.76, 362.63),
      item("LH 2", 202.68, 362.63),
      item("Lab Group 2", 95.76, 355.55),
    ];
    const [session] = parseBatchwisePages([page(items)]).sessions;
    expect(session.day).toBe("Tue");
    expect(session.isRepeater).toBe(true);
    expect(session.room).toBe("LH 2");
    expect(session.labGroup).toBe(2);
  });

  it("splits two stacked sessions that share a cell", () => {
    const items = [
      ...baseHeader("BS(CS)-I"),
      ...dayLabels(),
      item("PF(Lab)", 510.24, 113.04, "g_d0_f2"),
      item("Bukhari Maryam", 530.15, 98.16),
      item("Lab Group 1", 510.22, 81.72),
      item("CS C.Lab 2", 591.94, 81.72),
      item("AoIaCT (Lab)", 510.24, 66.24, "g_d0_f2"),
      item("Mr. Muhammad Fawad", 530.15, 51.24),
      item("Lab Group 2", 510.22, 34.8),
      item("CS C. Lab 7", 591.94, 34.8),
    ];
    const sessions = parseBatchwisePages([page(items)]).sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions[0].subject).toBe("PF(Lab)");
    expect(sessions[0].labGroup).toBe(1);
    expect(sessions[1].subject).toBe("AoIaCT (Lab)");
    expect(sessions[1].room).toBe("CS C. Lab 7");
  });

  it("flags the AS marker instead of inventing a session", () => {
    const items = [...baseHeader("BS(BA)-I"), ...dayLabels(), item("AS", 281.64, 257.39)];
    const result = parseBatchwisePages([page(items)]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].unresolved).toBe("AS");
    expect(result.issues.some((i) => i.code === "unresolved-marker")).toBe(true);
  });

  it("flags a room or teacher that has no subject", () => {
    const items = [...baseHeader("BS(CE)-V"), ...dayLabels(), item("Dr. Ihtesham Jadoon", 413.03, 130.8)];
    const result = parseBatchwisePages([page(items)]);
    expect(result.sessions).toHaveLength(0);
    expect(result.issues.some((i) => i.code === "orphan-detail")).toBe(true);
  });
});
