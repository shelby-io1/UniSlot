import { count, desc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import {
  academicTerms,
  auditLogs,
  batches,
  batchSubjects,
  classSessions,
  importJobs,
  periods,
  programs,
  rooms,
  subjects,
  teachers,
  workingDays,
} from "@/lib/db/schema";
import { detectClashes } from "@/lib/services/clashes";
import { getActiveTermId } from "@/lib/services/timetable";

/**
 * Dashboard read model (Phase 6). Every number is a live database count — there
 * are no placeholder or hardcoded statistics. The clash figures come straight
 * from the same detector the conflicts page and the resolver use.
 */

export type RecentImport = {
  id: number;
  kind: string;
  sourceName: string;
  status: string;
  rowsTotal: number;
  rowsImported: number;
  rowsFailed: number;
  createdAt: string;
};

export type DashboardStats = {
  counts: {
    programs: number;
    batches: number;
    rooms: number;
    teachers: number;
    subjects: number;
    periods: number;
    workingDays: number;
    batchSubjects: number;
    auditEntries: number;
    importJobs: number;
  };
  term: { id: number; name: string | null; sessions: number } | null;
  clashes: {
    total: number;
    batch: number;
    course: number;
    teacher: number;
    room: number;
    repeatsInvolved: number;
    sessionsChecked: number;
  };
  recentImports: RecentImport[];
};

export async function getDashboardStats(db: Database): Promise<DashboardStats> {
  const termId = await getActiveTermId(db);

  const [
    programsN,
    batchesN,
    roomsN,
    teachersN,
    subjectsN,
    periodsN,
    daysN,
    batchSubjectsN,
    auditN,
    jobsN,
  ] = await Promise.all([
    db.select({ n: count() }).from(programs),
    db.select({ n: count() }).from(batches),
    db.select({ n: count() }).from(rooms),
    db.select({ n: count() }).from(teachers),
    db.select({ n: count() }).from(subjects),
    db.select({ n: count() }).from(periods),
    db.select({ n: count() }).from(workingDays),
    db.select({ n: count() }).from(batchSubjects),
    db.select({ n: count() }).from(auditLogs),
    db.select({ n: count() }).from(importJobs),
  ]).then((rows) => rows.map((r) => r[0]?.n ?? 0));

  let termName: string | null = null;
  let sessions = 0;
  if (termId !== null) {
    const [termRow] = await db
      .select({ name: academicTerms.name })
      .from(academicTerms)
      .where(eq(academicTerms.id, termId))
      .limit(1);
    termName = termRow?.name ?? null;
    const [sessionRow] = await db
      .select({ n: count() })
      .from(classSessions)
      .where(eq(classSessions.termId, termId));
    sessions = sessionRow?.n ?? 0;
  }

  const report = await detectClashes(db, termId ?? undefined);

  const recentImports = (
    await db.select().from(importJobs).orderBy(desc(importJobs.id)).limit(6)
  ).map((r) => ({
    id: r.id,
    kind: r.kind,
    sourceName: r.sourceName,
    status: r.status,
    rowsTotal: r.rowsTotal,
    rowsImported: r.rowsImported,
    rowsFailed: r.rowsFailed,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));

  return {
    counts: {
      programs: programsN,
      batches: batchesN,
      rooms: roomsN,
      teachers: teachersN,
      subjects: subjectsN,
      periods: periodsN,
      workingDays: daysN,
      batchSubjects: batchSubjectsN,
      auditEntries: auditN,
      importJobs: jobsN,
    },
    term: termId !== null ? { id: termId, name: termName, sessions } : null,
    clashes: {
      total: report.clashes.length,
      batch: report.counts.batch,
      course: report.counts.course,
      teacher: report.counts.teacher,
      room: report.counts.room,
      repeatsInvolved: report.clashes.filter((c) => c.repeats).length,
      sessionsChecked: report.sessionsChecked,
    },
    recentImports,
  };
}
