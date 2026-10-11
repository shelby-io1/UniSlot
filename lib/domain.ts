const ROMAN: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
};

/** "BS(CS)-III" -> { program: "BS(CS)", semesterNumber: 3 } */
export function parseBatchLabel(label: string): { program: string; semesterNumber: number } {
  const match = label.match(/^(.*)-([IVX]+)$/);
  if (match) {
    return { program: match[1], semesterNumber: ROMAN[match[2]] ?? 0 };
  }
  return { program: label, semesterNumber: 0 };
}

/** Derives a room kind from its name (the source data has no explicit kind). */
export function roomKind(name: string): string {
  if (/lab/i.test(name)) return "lab";
  if (/^LH$|lecture theatre|^LT$|hall/i.test(name)) return "lecture_hall";
  return "classroom";
}

/** Canonical periods, used when an import targets an empty database. */
export const DEFAULT_PERIODS = [
  { label: "L1", startMinutes: 510, endMinutes: 600 },
  { label: "L2", startMinutes: 600, endMinutes: 690 },
  { label: "L3", startMinutes: 690, endMinutes: 795 },
  { label: "L4", startMinutes: 815, endMinutes: 900 },
  { label: "L5", startMinutes: 900, endMinutes: 990 },
];

export const DEFAULT_WORKING_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
];

