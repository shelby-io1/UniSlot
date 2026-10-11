import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * UniSlot core schema (Phase 1).
 *
 * Phase 1 covers the academic structure required to serve the four public
 * timetable views backed by a real database. Later phases extend this schema
 * (students, registrations, conflicts, resolution attempts, versions).
 */

export const academicTerms = pgTable("academic_terms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  startsOn: text("starts_on"),
  endsOn: text("ends_on"),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const programs = pgTable("programs", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  department: text("department"),
});

export const batches = pgTable(
  "batches",
  {
    id: serial("id").primaryKey(),
    programId: integer("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "restrict" }),
    semesterNumber: integer("semester_number").notNull(),
    label: text("label").notNull().unique(),
  },
  (t) => [index("batches_program_idx").on(t.programId)],
);

export const rooms = pgTable("rooms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  kind: text("kind").notNull().default("classroom"),
});

export const teachers = pgTable("teachers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const subjects = pgTable("subjects", {
  id: serial("id").primaryKey(),
  code: text("code"),
  title: text("title").notNull(),
  creditHours: integer("credit_hours"),
  theoryHours: integer("theory_hours"),
  labHours: integer("lab_hours"),
  prerequisites: text("prerequisites"),
  coRequisites: text("co_requisites"),
  category: text("category"),
});

export const periods = pgTable("periods", {
  id: serial("id").primaryKey(),
  label: text("label").notNull().unique(),
  startMinutes: integer("start_minutes").notNull(),
  endMinutes: integer("end_minutes").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const workingDays = pgTable("working_days", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull(),
  isWorking: boolean("is_working").notNull().default(true),
});

export const classSessions = pgTable(
  "class_sessions",
  {
    id: serial("id").primaryKey(),
    termId: integer("term_id")
      .notNull()
      .references(() => academicTerms.id, { onDelete: "cascade" }),
    batchId: integer("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),
    teacherId: integer("teacher_id").references(() => teachers.id, { onDelete: "set null" }),
    subjectId: integer("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "restrict" }),
    dayIndex: integer("day_index").notNull(),
    periodId: integer("period_id")
      .notNull()
      .references(() => periods.id, { onDelete: "restrict" }),
    isRepeater: boolean("is_repeater").notNull().default(false),
    source: text("source"),
    sourceRef: text("source_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sessions_term_day_period_idx").on(t.termId, t.dayIndex, t.periodId),
    index("sessions_batch_idx").on(t.batchId),
    index("sessions_teacher_idx").on(t.teacherId),
    index("sessions_room_idx").on(t.roomId),
    index("sessions_subject_idx").on(t.subjectId),
    unique("sessions_identity_uidx")
      .on(t.termId, t.batchId, t.dayIndex, t.periodId, t.subjectId, t.roomId, t.teacherId)
      .nullsNotDistinct(),
  ],
);

export const batchSubjects = pgTable(
  "batch_subjects",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    subjectId: integer("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("batch_subjects_uidx").on(t.batchId, t.subjectId),
    index("batch_subjects_batch_idx").on(t.batchId),
    index("batch_subjects_subject_idx").on(t.subjectId),
  ],
);

export const importJobs = pgTable("import_jobs", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  sourceName: text("source_name").notNull(),
  status: text("status").notNull(),
  rowsTotal: integer("rows_total").notNull().default(0),
  rowsImported: integer("rows_imported").notNull().default(0),
  rowsFailed: integer("rows_failed").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const importErrors = pgTable(
  "import_errors",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    page: integer("page"),
    rowRef: text("row_ref"),
    level: text("level").notNull().default("error"),
    code: text("code").notNull(),
    message: text("message").notNull(),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("import_errors_job_idx").on(t.jobId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    detail: jsonb("detail"),
    actor: text("actor"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_entity_idx").on(t.entity, t.entityId)],
);

/**
 * Small key/value store for application-wide settings the admin can change at
 * runtime. Currently used for the active UI theme; designed to hold future
 * global preferences without a schema change per setting.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = {
  academicTerms,
  programs,
  batches,
  rooms,
  teachers,
  subjects,
  periods,
  workingDays,
  classSessions,
  batchSubjects,
  importJobs,
  importErrors,
  auditLogs,
  appSettings,
};
