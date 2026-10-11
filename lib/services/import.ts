import { eq } from "drizzle-orm";
import { DEFAULT_PERIODS, DEFAULT_WORKING_DAYS, parseBatchLabel, roomKind } from "../domain";
import type { Database } from "../db";
import {
  academicTerms,
  auditLogs,
  batches,
  classSessions,
  importErrors,
  importJobs,
  periods,
  programs,
  rooms,
  subjects,
  teachers,
  workingDays,
} from "../db/schema";
import type { BatchwiseParseResult, ParsedIssue, ParsedSession } from "../import/batchwise";

export type SideCount = { total: number; existing: number; new: number };

export type ImportPreview = {
  source: string;
  term: string | null;
  pages: number;
  batches: SideCount;
  rooms: SideCount;
  teachers: SideCount;
  subjects: SideCount;
  sessions: { total: number; existing: number; new: number; skipped: number };
  issues: ParsedIssue[];
};

export type ImportApplyResult = {
  jobId: number;
  termId: number;
  termCreated: boolean;
  batches: number;
  rooms: number;
  teachers: number;
  subjects: number;
  sessions: number;
  skipped: number;
};

const IDENTITY_SEP = "\u0001";

function identityKey(parts: (string | number | null)[]): string {
  return parts.map((p) => (p === null ? "" : String(p))).join(IDENTITY_SEP);
}

function sessionKey(session: ParsedSession, periodLabel: string | null): string {
  return identityKey([
    session.batchLabel,
    session.dayIndex,
    periodLabel,
    session.subject,
    session.room,
    session.teacher,
  ]);
}

async function periodLabels(db: Database): Promise<string[]> {
  const rows = await db
    .select({ label: periods.label, sortOrder: periods.sortOrder })
    .from(periods);
  return rows.sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.label);
}

function sessionPeriodLabel(session: ParsedSession, labels: string[]): string | null {
  return session.column >= 0 && session.column < labels.length ? labels[session.column] : null;
}

function isImportable(session: ParsedSession, labels: string[]): boolean {
  if (session.unresolved) return false;
  if (session.subject.trim() === "") return false;
  return sessionPeriodLabel(session, labels) !== null;
}

async function loadSessionKeys(db: Database): Promise<Set<string>> {
  const rows = await db
    .select({
      batch: batches.label,
      dayIndex: classSessions.dayIndex,
      period: periods.label,
      subject: subjects.title,
      room: rooms.name,
      teacher: teachers.name,
    })
    .from(classSessions)
    .innerJoin(batches, eq(batches.id, classSessions.batchId))
    .innerJoin(periods, eq(periods.id, classSessions.periodId))
    .innerJoin(subjects, eq(subjects.id, classSessions.subjectId))
    .leftJoin(rooms, eq(rooms.id, classSessions.roomId))
    .leftJoin(teachers, eq(teachers.id, classSessions.teacherId));

  const keys = new Set<string>();
  for (const row of rows) {
    keys.add(identityKey([row.batch, row.dayIndex, row.period, row.subject, row.room, row.teacher]));
  }
  return keys;
}

function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

export async function previewBatchwiseImport(
  db: Database,
  result: BatchwiseParseResult,
): Promise<ImportPreview> {
  const labels = await periodLabels(db);
  const existingSessionKeys = await loadSessionKeys(db);
  const [existingBatches, existingRooms, existingTeachers, existingSubjects] = await Promise.all([
    db.select({ name: batches.label }).from(batches),
    db.select({ name: rooms.name }).from(rooms),
    db.select({ name: teachers.name }).from(teachers),
    db.select({ name: subjects.title }).from(subjects),
  ]);

  const batchSet = new Set(existingBatches.map((r) => r.name));
  const roomSet = new Set(existingRooms.map((r) => r.name));
  const teacherSet = new Set(existingTeachers.map((r) => r.name));
  const subjectSet = new Set(existingSubjects.map((r) => r.name));

  const batchNames = distinct(result.sessions.map((s) => s.batchLabel));
  const roomNames = distinct(result.sessions.map((s) => s.room));
  const teacherNames = distinct(result.sessions.map((s) => s.teacher));
  const subjectNames = distinct(result.sessions.map((s) => s.subject));

  const importable = result.sessions.filter((s) => isImportable(s, labels));
  let existing = 0;
  for (const session of importable) {
    if (existingSessionKeys.has(sessionKey(session, sessionPeriodLabel(session, labels)))) {
      existing++;
    }
  }

  return {
    source: "Batchwise.pdf",
    term: result.term,
    pages: result.pageCount,
    batches: { total: batchNames.length, existing: batchNames.filter((n) => batchSet.has(n)).length, new: batchNames.filter((n) => !batchSet.has(n)).length },
    rooms: { total: roomNames.length, existing: roomNames.filter((n) => roomSet.has(n)).length, new: roomNames.filter((n) => !roomSet.has(n)).length },
    teachers: { total: teacherNames.length, existing: teacherNames.filter((n) => teacherSet.has(n)).length, new: teacherNames.filter((n) => !teacherSet.has(n)).length },
    subjects: { total: subjectNames.length, existing: subjectNames.filter((n) => subjectSet.has(n)).length, new: subjectNames.filter((n) => !subjectSet.has(n)).length },
    sessions: {
      total: result.sessions.length,
      existing,
      new: importable.length - existing,
      skipped: result.sessions.length - importable.length,
    },
    issues: result.issues,
  };
}

async function ensureReferenceData(db: Database): Promise<void> {
  const existingPeriods = await db.select({ id: periods.id }).from(periods);
  if (existingPeriods.length === 0) {
    await db.insert(periods).values(
      DEFAULT_PERIODS.map((p, index) => ({
        label: p.label,
        startMinutes: p.startMinutes,
        endMinutes: p.endMinutes,
        sortOrder: index,
      })),
    );
  }
  const existingDays = await db.select({ id: workingDays.id }).from(workingDays);
  if (existingDays.length === 0) {
    await db.insert(workingDays).values(
      DEFAULT_WORKING_DAYS.map((name, index) => ({ name, sortOrder: index, isWorking: true })),
    );
  }
}

export async function applyBatchwiseImport(
  db: Database,
  result: BatchwiseParseResult,
): Promise<ImportApplyResult> {
  return db.transaction(async (tx) => {
    await ensureReferenceData(tx);

    const termName = result.term ?? "Imported timetable";
    let termCreated = false;
    let term = (await tx.select().from(academicTerms).where(eq(academicTerms.name, termName)))[0];
    if (!term) {
      const anyActive = (await tx.select({ id: academicTerms.id }).from(academicTerms)).length > 0;
      term = (
        await tx
          .insert(academicTerms)
          .values({ name: termName, isActive: !anyActive })
          .returning()
      )[0];
      termCreated = true;
    }

    const labels = await periodLabels(tx);
    const periodRows = await tx.select().from(periods);
    const periodIdByLabel = new Map(periodRows.map((p) => [p.label, p.id]));

    const importable = result.sessions.filter((s) => isImportable(s, labels));

    const batchLabels = distinct(importable.map((s) => s.batchLabel));
    const existingBatches = await tx.select().from(batches);
    const batchIdByLabel = new Map(existingBatches.map((b) => [b.label, b.id]));
    let batchesCreated = 0;
    for (const label of batchLabels) {
      if (batchIdByLabel.has(label)) continue;
      const { program: programCode, semesterNumber } = parseBatchLabel(label);
      let program = (await tx.select().from(programs).where(eq(programs.code, programCode)))[0];
      if (!program) {
        program = (
          await tx.insert(programs).values({ code: programCode, name: programCode }).returning()
        )[0];
      }
      const created = (
        await tx
          .insert(batches)
          .values({ programId: program.id, semesterNumber, label })
          .returning()
      )[0];
      batchIdByLabel.set(label, created.id);
      batchesCreated++;
    }

    const roomIdByName = new Map<string, number>();
    for (const row of await tx.select().from(rooms)) roomIdByName.set(row.name, row.id);
    let roomsCreated = 0;
    for (const name of distinct(importable.map((s) => s.room))) {
      if (roomIdByName.has(name)) continue;
      const created = (await tx.insert(rooms).values({ name, kind: roomKind(name) }).returning())[0];
      roomIdByName.set(name, created.id);
      roomsCreated++;
    }

    const teacherIdByName = new Map<string, number>();
    for (const row of await tx.select().from(teachers)) teacherIdByName.set(row.name, row.id);
    let teachersCreated = 0;
    for (const name of distinct(importable.map((s) => s.teacher))) {
      if (teacherIdByName.has(name)) continue;
      const created = (await tx.insert(teachers).values({ name }).returning())[0];
      teacherIdByName.set(name, created.id);
      teachersCreated++;
    }

    const subjectIdByTitle = new Map<string, number>();
    for (const row of await tx.select().from(subjects)) subjectIdByTitle.set(row.title, row.id);
    let subjectsCreated = 0;
    for (const title of distinct(importable.map((s) => s.subject))) {
      if (subjectIdByTitle.has(title)) continue;
      const created = (await tx.insert(subjects).values({ title }).returning())[0];
      subjectIdByTitle.set(title, created.id);
      subjectsCreated++;
    }

    let sessionsInserted = 0;
    for (const session of importable) {
      const periodLabel = sessionPeriodLabel(session, labels);
      const periodId = periodLabel ? periodIdByLabel.get(periodLabel) : undefined;
      const batchId = batchIdByLabel.get(session.batchLabel);
      const subjectId = subjectIdByTitle.get(session.subject);
      if (!periodId || !batchId || !subjectId) continue;
      const inserted = await tx
        .insert(classSessions)
        .values({
          termId: term.id,
          batchId,
          roomId: session.room ? roomIdByName.get(session.room) ?? null : null,
          teacherId: session.teacher ? teacherIdByName.get(session.teacher) ?? null : null,
          subjectId,
          dayIndex: session.dayIndex,
          periodId,
          isRepeater: session.isRepeater,
          source: "batchwise-pdf",
          sourceRef: `page ${session.page}`,
        })
        .onConflictDoNothing()
        .returning({ id: classSessions.id });
      sessionsInserted += inserted.length;
    }

    const job = (
      await tx
        .insert(importJobs)
        .values({
          kind: "batchwise",
          sourceName: "Batchwise.pdf",
          status: "completed",
          rowsTotal: result.sessions.length,
          rowsImported: sessionsInserted,
          rowsFailed: result.issues.length,
          notes: termName,
          finishedAt: new Date(),
        })
        .returning({ id: importJobs.id })
    )[0];

    if (result.issues.length > 0) {
      await tx.insert(importErrors).values(
        result.issues.map((issue) => ({
          jobId: job.id,
          page: issue.page,
          level: issue.level,
          code: issue.code,
          message: issue.message,
        })),
      );
    }

    await tx.insert(auditLogs).values({
      action: "import.batchwise",
      entity: "import_jobs",
      entityId: String(job.id),
      actor: "admin",
      detail: {
        term: termName,
        sessions: sessionsInserted,
        batches: batchesCreated,
        issues: result.issues.length,
      },
    });

    return {
      jobId: job.id,
      termId: term.id,
      termCreated,
      batches: batchesCreated,
      rooms: roomsCreated,
      teachers: teachersCreated,
      subjects: subjectsCreated,
      sessions: sessionsInserted,
      skipped: result.sessions.length - importable.length,
    };
  });
}
