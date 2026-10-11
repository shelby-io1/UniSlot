import { count, eq } from "drizzle-orm";
import dataset from "../../data/seed/cui-space-dataset.json";
import { parseBatchLabel, roomKind } from "../domain";
import type { Database } from "./index";
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
} from "./schema";

type Dataset = typeof dataset;

export { parseBatchLabel } from "../domain";

export type SeedResult = {
  seeded: boolean;
  programs: number;
  batches: number;
  rooms: number;
  teachers: number;
  subjects: number;
  sessions: number;
  repeaters: number;
};

/**
 * Seeds the database from the extracted CUISlot dataset. Idempotent: if any
 * class sessions already exist the seed is skipped. Runs atomically and writes
 * an import job + audit log entry describing the operation.
 */
export async function seedDatabase(db: Database, data: Dataset = dataset): Promise<SeedResult> {
  const [existing] = await db.select({ n: count() }).from(classSessions);
  if ((existing?.n ?? 0) > 0) {
    return {
      seeded: false,
      programs: 0,
      batches: 0,
      rooms: 0,
      teachers: 0,
      subjects: 0,
      sessions: 0,
      repeaters: 0,
    };
  }

  return db.transaction(async (tx) => {
    const term = (
      await tx
        .insert(academicTerms)
        .values({
          name: data.timetableNote,
          startsOn: "2026-09-14",
          isActive: true,
        })
        .returning({ id: academicTerms.id })
    )[0];

    const programCodes = [...new Set(data.batches.map((b) => parseBatchLabel(b).program))];
    const programRows = await tx
      .insert(programs)
      .values(
        programCodes.map((code) => ({ code, name: code, department: "Computer Science" })),
      )
      .returning({ id: programs.id, code: programs.code });
    const programIdByCode = new Map(programRows.map((r) => [r.code, r.id]));

    const batchRows = await tx
      .insert(batches)
      .values(
        data.batches.map((label) => {
          const parsed = parseBatchLabel(label);
          return {
            programId: programIdByCode.get(parsed.program)!,
            semesterNumber: parsed.semesterNumber,
            label,
          };
        }),
      )
      .returning({ id: batches.id, label: batches.label });
    const batchIdByLabel = new Map(batchRows.map((r) => [r.label, r.id]));

    const roomRows = await tx
      .insert(rooms)
      .values(data.rooms.map((name) => ({ name, kind: roomKind(name) })))
      .returning({ id: rooms.id, name: rooms.name });
    const roomIdByName = new Map(roomRows.map((r) => [r.name, r.id]));

    const teacherRows = await tx
      .insert(teachers)
      .values(data.teachers.map((name) => ({ name })))
      .returning({ id: teachers.id, name: teachers.name });
    const teacherIdByName = new Map(teacherRows.map((r) => [r.name, r.id]));

    const subjectRows = await tx
      .insert(subjects)
      .values(data.subjects.map((title) => ({ title })))
      .returning({ id: subjects.id, title: subjects.title });
    const subjectIdByTitle = new Map(subjectRows.map((r) => [r.title, r.id]));

    const periodRows = await tx
      .insert(periods)
      .values(
        data.periods.map((p, i) => ({
          label: p.label,
          startMinutes: p.startMinutes,
          endMinutes: p.endMinutes,
          sortOrder: i,
        })),
      )
      .returning({ id: periods.id, label: periods.label });
    const periodIdByLabel = new Map(periodRows.map((r) => [r.label, r.id]));
    const periodIds = data.periods.map((p) => periodIdByLabel.get(p.label)!);

    await tx
      .insert(workingDays)
      .values(data.days.map((name, i) => ({ name, sortOrder: i, isWorking: true })));

    let repeaters = 0;
    const sessionValues = data.entries.map(
      ([day, slot, batchIdx, roomIdx, teacherIdx, subjectIdx, repeater]) => {
        if (repeater) repeaters++;
        return {
          termId: term.id,
          batchId: batchIdByLabel.get(data.batches[batchIdx])!,
          roomId: roomIdByName.get(data.rooms[roomIdx]) ?? null,
          teacherId: teacherIdByName.get(data.teachers[teacherIdx]) ?? null,
          subjectId: subjectIdByTitle.get(data.subjects[subjectIdx])!,
          dayIndex: day,
          periodId: periodIds[slot],
          isRepeater: Boolean(repeater),
          source: "cui-space",
          sourceRef: data.source,
        };
      },
    );
    for (let i = 0; i < sessionValues.length; i += 500) {
      await tx.insert(classSessions).values(sessionValues.slice(i, i + 500));
    }

    const job = (
      await tx
        .insert(importJobs)
        .values({
          kind: "seed",
          sourceName: data.source,
          status: "completed",
          rowsTotal: data.entries.length,
          rowsImported: data.entries.length,
          rowsFailed: 0,
          notes: data.timetableNote,
          finishedAt: new Date(),
        })
        .returning({ id: importJobs.id })
    )[0];

    await tx.insert(auditLogs).values({
      action: "seed.import",
      entity: "import_jobs",
      entityId: String(job.id),
      actor: "system",
      detail: {
        programs: programCodes.length,
        batches: data.batches.length,
        sessions: data.entries.length,
        repeaters,
      },
    });

    return {
      seeded: true,
      programs: programCodes.length,
      batches: data.batches.length,
      rooms: data.rooms.length,
      teachers: data.teachers.length,
      subjects: data.subjects.length,
      sessions: data.entries.length,
      repeaters,
    };
  });
}

const BATCH_SUBJECTS_BACKFILL = "batch_subjects.backfill";

/**
 * One-time backfill of `batch_subjects` from the scheduled sessions, so every
 * batch starts with the subjects it appears against in the timetable. Guarded
 * by an audit marker, so it runs exactly once per database; afterwards the
 * mapping is fully admin-editable and will not be overwritten.
 */
export async function ensureBatchSubjects(db: Database): Promise<number> {
  const [marker] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(eq(auditLogs.action, BATCH_SUBJECTS_BACKFILL))
    .limit(1);
  if (marker) return 0;

  const pairs = await db
    .selectDistinct({ batchId: classSessions.batchId, subjectId: classSessions.subjectId })
    .from(classSessions);

  return db.transaction(async (tx) => {
    if (pairs.length > 0) {
      await tx
        .insert(batchSubjects)
        .values(
          pairs.map((pair) => ({ batchId: pair.batchId, subjectId: pair.subjectId, source: "timetable" })),
        )
        .onConflictDoNothing();
    }
    await tx.insert(auditLogs).values({
      action: BATCH_SUBJECTS_BACKFILL,
      entity: "batch_subjects",
      actor: "system",
      detail: { assigned: pairs.length },
    });
    return pairs.length;
  });
}
