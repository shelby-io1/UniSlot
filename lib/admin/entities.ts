import type { AdminEntity } from "../services/admin";

/**
 * Shared, serialisable description of the editable academic entities. Used by
 * the admin UI (client) to render fields and by the admin server actions to
 * turn a submitted form back into an API body. Keep this module free of any
 * server-only imports so client components can import it.
 */

export type AdminEntityKey = AdminEntity;

export type FieldType = "text" | "textarea" | "number" | "checkbox" | "select" | "reference";

export type FieldOption = { value: string; label: string };

export type Field = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: FieldOption[];
  reference?: AdminEntityKey;
  min?: number;
  max?: number;
  defaultValue?: string | number | boolean;
};

export type EntitySchema = {
  key: AdminEntityKey;
  label: string;
  singular: string;
  description: string;
  primary: string;
  summaryFields: string[];
  fields: Field[];
};

export type FormState = {
  ok?: boolean;
  error?: string;
};

export const ROOM_KIND_OPTIONS: FieldOption[] = [
  { value: "classroom", label: "Classroom" },
  { value: "lab", label: "Lab" },
  { value: "lecture_hall", label: "Lecture hall" },
];

export const ENTITY_SCHEMAS: EntitySchema[] = [
  {
    key: "programs",
    label: "Programs",
    singular: "program",
    description: "Degree programmes offered by the campus.",
    primary: "code",
    summaryFields: ["name", "department"],
    fields: [
      { name: "code", label: "Code", type: "text", required: true, placeholder: "BSCS" },
      { name: "name", label: "Name", type: "text", required: true, placeholder: "BS Computer Science" },
      { name: "department", label: "Department", type: "text", placeholder: "Computer Science" },
    ],
  },
  {
    key: "batches",
    label: "Batches",
    singular: "batch",
    description: "Student groups that attend the timetable.",
    primary: "label",
    summaryFields: ["programId", "semesterNumber"],
    fields: [
      { name: "programId", label: "Program", type: "reference", reference: "programs", required: true },
      { name: "semesterNumber", label: "Semester", type: "number", required: true, min: 1, max: 16 },
      { name: "label", label: "Label", type: "text", required: true, placeholder: "e.g. BSCS-4A" },
    ],
  },
  {
    key: "subjects",
    label: "Subjects",
    singular: "subject",
    description: "Courses offered in the catalogue.",
    primary: "title",
    summaryFields: ["code", "creditHours", "category"],
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "code", label: "Code", type: "text", placeholder: "e.g. CSC103" },
      { name: "creditHours", label: "Credit hours", type: "number", min: 0, max: 30 },
      { name: "theoryHours", label: "Theory hours", type: "number", min: 0, max: 30 },
      { name: "labHours", label: "Lab hours", type: "number", min: 0, max: 30 },
      { name: "prerequisites", label: "Prerequisites", type: "text" },
      { name: "coRequisites", label: "Co-requisites", type: "text" },
      { name: "category", label: "Category", type: "text" },
    ],
  },
  {
    key: "teachers",
    label: "Teachers",
    singular: "teacher",
    description: "Faculty members.",
    primary: "name",
    summaryFields: [],
    fields: [{ name: "name", label: "Name", type: "text", required: true }],
  },
  {
    key: "rooms",
    label: "Rooms",
    singular: "room",
    description: "Rooms, labs and lecture halls.",
    primary: "name",
    summaryFields: ["kind"],
    fields: [
      { name: "name", label: "Name", type: "text", required: true, placeholder: "e.g. CR-12" },
      {
        name: "kind",
        label: "Kind",
        type: "select",
        required: true,
        options: ROOM_KIND_OPTIONS,
        defaultValue: "classroom",
      },
    ],
  },
  {
    key: "periods",
    label: "Periods",
    singular: "period",
    description: "Time slots that make up a day.",
    primary: "label",
    summaryFields: ["startMinutes", "endMinutes", "sortOrder"],
    fields: [
      { name: "label", label: "Label", type: "text", required: true, placeholder: "e.g. P1" },
      {
        name: "startMinutes",
        label: "Start (minutes)",
        type: "number",
        required: true,
        min: 0,
        max: 1440,
        help: "Minutes after midnight, e.g. 510 = 08:30",
      },
      { name: "endMinutes", label: "End (minutes)", type: "number", required: true, min: 0, max: 1440 },
      { name: "sortOrder", label: "Sort order", type: "number", min: 0 },
    ],
  },
  {
    key: "working-days",
    label: "Working days",
    singular: "working day",
    description: "Days the campus runs classes.",
    primary: "name",
    summaryFields: ["sortOrder", "isWorking"],
    fields: [
      { name: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Monday" },
      { name: "sortOrder", label: "Sort order", type: "number", min: 0 },
      { name: "isWorking", label: "Working day", type: "checkbox", defaultValue: true },
    ],
  },
];

export function getEntitySchema(key: AdminEntityKey): EntitySchema {
  const schema = ENTITY_SCHEMAS.find((item) => item.key === key);
  if (!schema) throw new Error(`Unknown admin entity '${key}'`);
  return schema;
}

/**
 * Converts submitted form fields into the JSON shape the admin service expects.
 * Checkboxes always become booleans; empty numbers/references are omitted so
 * the service can apply defaults (or leave update fields untouched); empty text
 * clears optional values and fails validation for required ones.
 */
export function parseEntityForm(
  key: AdminEntityKey,
  formData: FormData,
): Record<string, unknown> {
  const schema = getEntitySchema(key);
  const body: Record<string, unknown> = {};
  for (const field of schema.fields) {
    const raw = formData.get(field.name);
    if (field.type === "checkbox") {
      body[field.name] = raw !== null;
      continue;
    }
    if (raw === null) continue;
    const value = String(raw);
    if (field.type === "number" || field.type === "reference") {
      if (value.trim() === "") continue;
      body[field.name] = Number(value);
    } else {
      body[field.name] = value;
    }
  }
  return body;
}
