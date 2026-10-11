import { eq } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Database } from "../db";
import {
  auditLogs,
  batches,
  classSessions,
  periods,
  programs,
  rooms,
  subjects,
  teachers,
  workingDays,
} from "../db/schema";

export const ADMIN_ENTITIES = [
  "programs",
  "batches",
  "rooms",
  "teachers",
  "subjects",
  "periods",
  "working-days",
] as const;

export type AdminEntity = (typeof ADMIN_ENTITIES)[number];

export function isAdminEntity(value: string): value is AdminEntity {
  return (ADMIN_ENTITIES as readonly string[]).includes(value);
}

/** A validation or conflict error that maps cleanly to an HTTP status. */
export class AdminError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AdminError";
    this.status = status;
  }
}

type IdTable = PgTable & { id: PgColumn };
type Input = Record<string, unknown>;
type Mode = "create" | "update";
type EntityRow = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function asObject(body: unknown): Input {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AdminError("Request body must be a JSON object");
  }
  return body as Input;
}

type TextOpts = { required?: boolean; max?: number; upper?: boolean };

function requiredText(input: Input, key: string, opts: TextOpts = {}): string | undefined {
  if (!(key in input)) {
    if (opts.required) throw new AdminError(`${key} is required`);
    return undefined;
  }
  const raw = input[key];
  if (typeof raw !== "string") throw new AdminError(`${key} must be a string`);
  let value = raw.trim();
  if (value === "") throw new AdminError(`${key} cannot be empty`);
  if (opts.upper) value = value.toUpperCase();
  if (opts.max && value.length > opts.max) {
    throw new AdminError(`${key} must be at most ${opts.max} characters`);
  }
  return value;
}

function optionalText(
  input: Input,
  key: string,
  opts: { max?: number; upper?: boolean } = {},
): string | null | undefined {
  if (!(key in input)) return undefined;
  const raw = input[key];
  if (raw === null) return null;
  if (typeof raw !== "string") throw new AdminError(`${key} must be a string or null`);
  let value = raw.trim();
  if (value === "") return null;
  if (opts.upper) value = value.toUpperCase();
  if (opts.max && value.length > opts.max) {
    throw new AdminError(`${key} must be at most ${opts.max} characters`);
  }
  return value;
}

type IntOpts = { required?: boolean; min?: number; max?: number };

function intField(input: Input, key: string, opts: IntOpts = {}): number | undefined {
  if (!(key in input)) {
    if (opts.required) throw new AdminError(`${key} is required`);
    return undefined;
  }
  const raw = input[key];
  const value = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isInteger(value)) throw new AdminError(`${key} must be an integer`);
  if (opts.min !== undefined && value < opts.min) {
    throw new AdminError(`${key} must be at least ${opts.min}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new AdminError(`${key} must be at most ${opts.max}`);
  }
  return value;
}

function boolField(input: Input, key: string): boolean | undefined {
  if (!(key in input)) return undefined;
  const raw = input[key];
  if (typeof raw !== "boolean") throw new AdminError(`${key} must be a boolean`);
  return raw;
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

async function insertRow(
  tx: Database,
  table: IdTable,
  values: Record<string, unknown>,
): Promise<EntityRow> {
  const rows = (await tx
    .insert(table)
    .values(values as never)
    .returning()) as EntityRow[];
  return rows[0];
}

async function updateRowById(
  tx: Database,
  table: IdTable,
  id: number,
  values: Record<string, unknown>,
): Promise<EntityRow | undefined> {
  const rows = (await tx
    .update(table)
    .set(values as never)
    .where(eq(table.id, id))
    .returning()) as EntityRow[];
  return rows[0];
}

async function writeAudit(
  tx: Database,
  action: string,
  entity: string,
  entityId: number,
  actor: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditLogs).values({
    action,
    entity,
    entityId: String(entityId),
    actor,
    detail,
  });
}

/** Throws a 409 when a unique column already holds the value (excluding `keepId`). */
async function assertUnique(
  tx: Database,
  table: IdTable,
  column: PgColumn,
  value: string | null | undefined,
  message: string,
  keepId?: number,
): Promise<void> {
  if (value === undefined || value === null) return;
  const rows = (await tx
    .select({ id: table.id })
    .from(table)
    .where(eq(column, value))) as { id: number }[];
  if (rows.some((row) => row.id !== keepId)) throw new AdminError(message, 409);
}

async function assertProgramExists(tx: Database, programId: number): Promise<void> {
  const [row] = await tx.select({ id: programs.id }).from(programs).where(eq(programs.id, programId));
  if (!row) throw new AdminError("programId does not reference an existing program");
}

// ---------------------------------------------------------------------------
// Per-entity value builders
// ---------------------------------------------------------------------------

const ROOM_KINDS = ["classroom", "lab", "lecture_hall"] as const;

function programValues(input: Input, mode: Mode): Partial<InferInsertModel<typeof programs>> {
  const values: Partial<InferInsertModel<typeof programs>> = {};
  const code = requiredText(input, "code", { required: mode === "create", max: 32, upper: true });
  if (code !== undefined) values.code = code;
  const name = requiredText(input, "name", { required: mode === "create", max: 120 });
  if (name !== undefined) values.name = name;
  const department = optionalText(input, "department", { max: 120 });
  if (department !== undefined) values.department = department;
  return values;
}

function batchValues(input: Input, mode: Mode): Partial<InferInsertModel<typeof batches>> {
  const values: Partial<InferInsertModel<typeof batches>> = {};
  const programId = intField(input, "programId", { required: mode === "create", min: 1 });
  if (programId !== undefined) values.programId = programId;
  const semesterNumber = intField(input, "semesterNumber", {
    required: mode === "create",
    min: 1,
    max: 16,
  });
  if (semesterNumber !== undefined) values.semesterNumber = semesterNumber;
  const label = requiredText(input, "label", { required: mode === "create", max: 40 });
  if (label !== undefined) values.label = label;
  return values;
}

function roomValues(input: Input, mode: Mode): Partial<InferInsertModel<typeof rooms>> {
  const values: Partial<InferInsertModel<typeof rooms>> = {};
  const name = requiredText(input, "name", { required: mode === "create", max: 60 });
  if (name !== undefined) values.name = name;
  const kind = requiredText(input, "kind", { max: 40 });
  if (kind !== undefined) {
    if (!(ROOM_KINDS as readonly string[]).includes(kind)) {
      throw new AdminError(`kind must be one of ${ROOM_KINDS.join(", ")}`);
    }
    values.kind = kind;
  }
  return values;
}

function teacherValues(input: Input, mode: Mode): Partial<InferInsertModel<typeof teachers>> {
  const values: Partial<InferInsertModel<typeof teachers>> = {};
  const name = requiredText(input, "name", { required: mode === "create", max: 120 });
  if (name !== undefined) values.name = name;
  return values;
}

function subjectValues(input: Input, mode: Mode): Partial<InferInsertModel<typeof subjects>> {
  const values: Partial<InferInsertModel<typeof subjects>> = {};
  const title = requiredText(input, "title", { required: mode === "create", max: 200 });
  if (title !== undefined) values.title = title;
  const code = optionalText(input, "code", { max: 32, upper: true });
  if (code !== undefined) values.code = code;
  const creditHours = intField(input, "creditHours", { min: 0, max: 30 });
  if (creditHours !== undefined) values.creditHours = creditHours;
  const theoryHours = intField(input, "theoryHours", { min: 0, max: 30 });
  if (theoryHours !== undefined) values.theoryHours = theoryHours;
  const labHours = intField(input, "labHours", { min: 0, max: 30 });
  if (labHours !== undefined) values.labHours = labHours;
  const prerequisites = optionalText(input, "prerequisites", { max: 200 });
  if (prerequisites !== undefined) values.prerequisites = prerequisites;
  const coRequisites = optionalText(input, "coRequisites", { max: 200 });
  if (coRequisites !== undefined) values.coRequisites = coRequisites;
  const category = optionalText(input, "category", { max: 80 });
  if (category !== undefined) values.category = category;
  return values;
}

function periodValues(input: Input, mode: Mode): Partial<InferInsertModel<typeof periods>> {
  const values: Partial<InferInsertModel<typeof periods>> = {};
  const label = requiredText(input, "label", { required: mode === "create", max: 40 });
  if (label !== undefined) values.label = label;
  const startMinutes = intField(input, "startMinutes", {
    required: mode === "create",
    min: 0,
    max: 1440,
  });
  if (startMinutes !== undefined) values.startMinutes = startMinutes;
  const endMinutes = intField(input, "endMinutes", {
    required: mode === "create",
    min: 0,
    max: 1440,
  });
  if (endMinutes !== undefined) values.endMinutes = endMinutes;
  const sortOrder = intField(input, "sortOrder", { min: 0 });
  if (sortOrder !== undefined) values.sortOrder = sortOrder;
  return values;
}

function workingDayValues(input: Input, mode: Mode): Partial<InferInsertModel<typeof workingDays>> {
  const values: Partial<InferInsertModel<typeof workingDays>> = {};
  const name = requiredText(input, "name", { required: mode === "create", max: 40 });
  if (name !== undefined) values.name = name;
  const sortOrder = intField(input, "sortOrder", { min: 0 });
  if (sortOrder !== undefined) values.sortOrder = sortOrder;
  const isWorking = boolField(input, "isWorking");
  if (isWorking !== undefined) values.isWorking = isWorking;
  return values;
}

async function nextPeriodSortOrder(tx: Database): Promise<number> {
  const rows = await tx.select({ sortOrder: periods.sortOrder }).from(periods);
  return rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
}

async function nextWorkingDaySortOrder(tx: Database): Promise<number> {
  const rows = await tx.select({ sortOrder: workingDays.sortOrder }).from(workingDays);
  return rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listEntity(db: Database, entity: AdminEntity): Promise<EntityRow[]> {
  switch (entity) {
    case "programs":
      return db.select().from(programs).orderBy(programs.id);
    case "batches":
      return db.select().from(batches).orderBy(batches.id);
    case "rooms":
      return db.select().from(rooms).orderBy(rooms.id);
    case "teachers":
      return db.select().from(teachers).orderBy(teachers.id);
    case "subjects":
      return db.select().from(subjects).orderBy(subjects.id);
    case "periods":
      return db.select().from(periods).orderBy(periods.sortOrder);
    case "working-days":
      return db.select().from(workingDays).orderBy(workingDays.sortOrder);
  }
}

export async function getEntity(
  db: Database,
  entity: AdminEntity,
  id: number,
): Promise<EntityRow | undefined> {
  switch (entity) {
    case "programs":
      return (await db.select().from(programs).where(eq(programs.id, id)))[0];
    case "batches":
      return (await db.select().from(batches).where(eq(batches.id, id)))[0];
    case "rooms":
      return (await db.select().from(rooms).where(eq(rooms.id, id)))[0];
    case "teachers":
      return (await db.select().from(teachers).where(eq(teachers.id, id)))[0];
    case "subjects":
      return (await db.select().from(subjects).where(eq(subjects.id, id)))[0];
    case "periods":
      return (await db.select().from(periods).where(eq(periods.id, id)))[0];
    case "working-days":
      return (await db.select().from(workingDays).where(eq(workingDays.id, id)))[0];
  }
}

async function createRow(tx: Database, entity: AdminEntity, input: Input): Promise<EntityRow> {
  switch (entity) {
    case "programs": {
      const values = programValues(input, "create");
      await assertUnique(
        tx,
        programs,
        programs.code,
        values.code,
        "A program with that code already exists",
      );
      return insertRow(tx, programs, values as InferInsertModel<typeof programs>);
    }
    case "batches": {
      const values = batchValues(input, "create");
      if (values.programId !== undefined) await assertProgramExists(tx, values.programId);
      await assertUnique(
        tx,
        batches,
        batches.label,
        values.label,
        "A batch with that label already exists",
      );
      return insertRow(tx, batches, values as InferInsertModel<typeof batches>);
    }
    case "rooms": {
      const values = roomValues(input, "create");
      await assertUnique(tx, rooms, rooms.name, values.name, "A room with that name already exists");
      return insertRow(tx, rooms, values as InferInsertModel<typeof rooms>);
    }
    case "teachers": {
      const values = teacherValues(input, "create");
      await assertUnique(
        tx,
        teachers,
        teachers.name,
        values.name,
        "A teacher with that name already exists",
      );
      return insertRow(tx, teachers, values as InferInsertModel<typeof teachers>);
    }
    case "subjects": {
      const values = subjectValues(input, "create");
      return insertRow(tx, subjects, values as InferInsertModel<typeof subjects>);
    }
    case "periods": {
      const values = periodValues(input, "create");
      if (
        values.startMinutes !== undefined &&
        values.endMinutes !== undefined &&
        values.endMinutes <= values.startMinutes
      ) {
        throw new AdminError("endMinutes must be greater than startMinutes");
      }
      if (values.sortOrder === undefined) values.sortOrder = await nextPeriodSortOrder(tx);
      await assertUnique(
        tx,
        periods,
        periods.label,
        values.label,
        "A period with that label already exists",
      );
      return insertRow(tx, periods, values as InferInsertModel<typeof periods>);
    }
    case "working-days": {
      const values = workingDayValues(input, "create");
      if (values.sortOrder === undefined) values.sortOrder = await nextWorkingDaySortOrder(tx);
      await assertUnique(
        tx,
        workingDays,
        workingDays.name,
        values.name,
        "A working day with that name already exists",
      );
      return insertRow(tx, workingDays, values as InferInsertModel<typeof workingDays>);
    }
  }
}

export async function createEntity(
  db: Database,
  entity: AdminEntity,
  body: unknown,
  actor: string,
): Promise<EntityRow> {
  const input = asObject(body);
  return db.transaction(async (tx) => {
    const row = await createRow(tx, entity, input);
    await writeAudit(tx, "admin.create", entity, Number(row.id), actor, { after: row });
    return row;
  });
}

async function updateRowInner(
  tx: Database,
  entity: AdminEntity,
  id: number,
  input: Input,
  before: EntityRow,
): Promise<EntityRow> {
  switch (entity) {
    case "programs": {
      const values = programValues(input, "update");
      if (values.code !== undefined) {
        await assertUnique(
          tx,
          programs,
          programs.code,
          values.code,
          "A program with that code already exists",
          id,
        );
      }
      return (await updateRowById(tx, programs, id, values)) ?? before;
    }
    case "batches": {
      const values = batchValues(input, "update");
      if (values.programId !== undefined) await assertProgramExists(tx, values.programId);
      if (values.label !== undefined) {
        await assertUnique(
          tx,
          batches,
          batches.label,
          values.label,
          "A batch with that label already exists",
          id,
        );
      }
      return (await updateRowById(tx, batches, id, values)) ?? before;
    }
    case "rooms": {
      const values = roomValues(input, "update");
      if (values.name !== undefined) {
        await assertUnique(
          tx,
          rooms,
          rooms.name,
          values.name,
          "A room with that name already exists",
          id,
        );
      }
      return (await updateRowById(tx, rooms, id, values)) ?? before;
    }
    case "teachers": {
      const values = teacherValues(input, "update");
      if (values.name !== undefined) {
        await assertUnique(
          tx,
          teachers,
          teachers.name,
          values.name,
          "A teacher with that name already exists",
          id,
        );
      }
      return (await updateRowById(tx, teachers, id, values)) ?? before;
    }
    case "subjects": {
      const values = subjectValues(input, "update");
      return (await updateRowById(tx, subjects, id, values)) ?? before;
    }
    case "periods": {
      const values = periodValues(input, "update");
      const start = values.startMinutes ?? Number(before.startMinutes);
      const end = values.endMinutes ?? Number(before.endMinutes);
      if (end <= start) throw new AdminError("endMinutes must be greater than startMinutes");
      if (values.label !== undefined) {
        await assertUnique(
          tx,
          periods,
          periods.label,
          values.label,
          "A period with that label already exists",
          id,
        );
      }
      return (await updateRowById(tx, periods, id, values)) ?? before;
    }
    case "working-days": {
      const values = workingDayValues(input, "update");
      if (values.name !== undefined) {
        await assertUnique(
          tx,
          workingDays,
          workingDays.name,
          values.name,
          "A working day with that name already exists",
          id,
        );
      }
      return (await updateRowById(tx, workingDays, id, values)) ?? before;
    }
  }
}

export async function updateEntity(
  db: Database,
  entity: AdminEntity,
  id: number,
  body: unknown,
  actor: string,
): Promise<EntityRow | undefined> {
  const input = asObject(body);
  return db.transaction(async (tx) => {
    const before = await getEntity(tx, entity, id);
    if (!before) return undefined;
    const after = await updateRowInner(tx, entity, id, input, before);
    await writeAudit(tx, "admin.update", entity, id, actor, { before, after });
    return after;
  });
}

async function countSessionsBy(tx: Database, column: PgColumn, id: number): Promise<number> {
  const rows = (await tx
    .select({ id: classSessions.id })
    .from(classSessions)
    .where(eq(column, id))) as { id: number }[];
  return rows.length;
}

export async function deleteEntity(
  db: Database,
  entity: AdminEntity,
  id: number,
  actor: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const before = await getEntity(tx, entity, id);
    if (!before) return false;

    switch (entity) {
      case "programs": {
        const refs = await tx
          .select({ id: batches.id })
          .from(batches)
          .where(eq(batches.programId, id));
        if (refs.length > 0) {
          throw new AdminError("Cannot delete: batches still reference this program", 409);
        }
        await tx.delete(programs).where(eq(programs.id, id));
        break;
      }
      case "batches": {
        if ((await countSessionsBy(tx, classSessions.batchId, id)) > 0) {
          throw new AdminError("Cannot delete: timetable sessions reference this batch", 409);
        }
        await tx.delete(batches).where(eq(batches.id, id));
        break;
      }
      case "subjects": {
        if ((await countSessionsBy(tx, classSessions.subjectId, id)) > 0) {
          throw new AdminError("Cannot delete: timetable sessions reference this subject", 409);
        }
        await tx.delete(subjects).where(eq(subjects.id, id));
        break;
      }
      case "rooms":
        await tx.delete(rooms).where(eq(rooms.id, id));
        break;
      case "teachers":
        await tx.delete(teachers).where(eq(teachers.id, id));
        break;
      case "periods": {
        if ((await countSessionsBy(tx, classSessions.periodId, id)) > 0) {
          throw new AdminError("Cannot delete: timetable sessions reference this period", 409);
        }
        await tx.delete(periods).where(eq(periods.id, id));
        break;
      }
      case "working-days":
        await tx.delete(workingDays).where(eq(workingDays.id, id));
        break;
    }

    await writeAudit(tx, "admin.delete", entity, id, actor, { before });
    return true;
  });
}
