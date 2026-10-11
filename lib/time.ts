/**
 * Half-open interval helpers. Two intervals [aStart, aEnd) and [bStart, bEnd)
 * overlap iff `aStart < bEnd && bStart < aEnd`, matching the rule used across
 * the scheduler and the timetable views.
 */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** 510 -> "8:30", 795 -> "1:15" (12-hour, no meridiem, matching the source UI). */
export function formatMinutes(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")}`;
}
