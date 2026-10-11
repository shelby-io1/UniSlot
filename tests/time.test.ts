import { describe, expect, it } from "vitest";
import { formatMinutes, overlaps } from "@/lib/time";

describe("overlaps (half-open intervals)", () => {
  it("detects a genuine overlap", () => {
    expect(overlaps(510, 600, 570, 690)).toBe(true);
  });

  it("treats touching intervals as non-overlapping", () => {
    // 8:30-10:00 and 10:00-11:30 share only the boundary.
    expect(overlaps(510, 600, 600, 690)).toBe(false);
    expect(overlaps(600, 690, 510, 600)).toBe(false);
  });

  it("is false for fully separate intervals", () => {
    expect(overlaps(510, 600, 690, 795)).toBe(false);
  });

  it("is true for containment and equality", () => {
    expect(overlaps(510, 795, 600, 690)).toBe(true);
    expect(overlaps(600, 690, 600, 690)).toBe(true);
  });
});

describe("formatMinutes", () => {
  it("formats lecture slot times without a meridiem, matching the source UI", () => {
    expect(formatMinutes(510)).toBe("8:30");
    expect(formatMinutes(600)).toBe("10:00");
    expect(formatMinutes(795)).toBe("1:15");
    expect(formatMinutes(815)).toBe("1:35");
    expect(formatMinutes(990)).toBe("4:30");
  });
});
