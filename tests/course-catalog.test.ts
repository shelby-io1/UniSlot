import { describe, expect, it } from "vitest";
import { parseCatalogPages, parseCredits } from "@/lib/import/course-catalog";
import type { PdfPage, PdfTextItem } from "@/lib/import/batchwise";

function item(text: string, x: number, y: number, font = "g_d0_f3"): PdfTextItem {
  return { text, x, y, font };
}

function page(items: PdfTextItem[], pageNumber = 2): PdfPage {
  return { pageNumber, items };
}

const headerRow = (y: number, font = "g_d0_f2"): PdfTextItem[] => [
  item("Course Code", 101.29, y, font),
  item("Course Title", 204.21, y, font),
  item("Credit Hours", 469, y, font),
  item("Co-requisite(s)", 570.23, y, font),
  item("Prerequisite (s)", 674.25, y, font),
];

describe("course catalog parser", () => {
  it("parses credit hour strings", () => {
    expect(parseCredits("3(2, 1)")).toEqual({ total: 3, theory: 2, lab: 1 });
    expect(parseCredits("1(0, 1)")).toEqual({ total: 1, theory: 0, lab: 1 });
    expect(parseCredits("garbage")).toBeNull();
  });

  it("extracts a course row with category and prerequisites", () => {
    const items = [
      item("a. General Education Courses:", 65.62, 318.96, "g_d0_f2"),
      ...headerRow(283.71),
      item("3", 80.26, 267.21),
      item("CSC101", 101.29, 267.21),
      item("Applications of Information and Communication Technologies", 204.21, 267.21),
      item("3(2, 1)", 507.49, 267.21),
      item("HUM104", 711.45, 267.21),
    ];
    const { courses, issues } = parseCatalogPages([page(items)]);
    expect(issues).toHaveLength(0);
    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({
      category: "a. General Education Courses:",
      serial: 3,
      code: "CSC101",
      title: "Applications of Information and Communication Technologies",
      creditHours: 3,
      theoryHours: 2,
      labHours: 1,
      prerequisites: "HUM104",
      coRequisites: null,
    });
  });

  it("does not treat prerequisite codes as their own rows", () => {
    const items = [
      item("CSC232", 101.29, 230.46),
      item("Information Security", 204.21, 230.46),
      item("3(2, 1)", 507.49, 230.46),
      item("CSC103", 711.45, 230.46),
    ];
    const { courses } = parseCatalogPages([page(items)]);
    expect(courses.map((c) => c.code)).toEqual(["CSC232"]);
    expect(courses[0].prerequisites).toBe("CSC103");
  });

  it("flags placeholder codes and conflicting duplicates", () => {
    const items = [
      item("XXXXXX", 101.29, 120.96),
      item("Art & Humanities (one course)", 204.21, 120.96),
      item("2(2, 0)", 507.49, 120.96),
      item("CSC103", 101.29, 252.96),
      item("Introduction to Computers and Programming", 204.21, 252.96),
      item("4(3, 1)", 507.49, 252.96),
      item("CSC103", 101.29, 585.96),
      item("Programming Fundamentals", 204.21, 585.96),
      item("4(3, 1)", 507.49, 585.96),
    ];
    const { issues } = parseCatalogPages([page(items)]);
    expect(issues.some((i) => i.code === "placeholder-code")).toBe(true);
    expect(issues.some((i) => i.code === "conflicting-course" && i.message.includes("CSC103"))).toBe(true);
  });
});
