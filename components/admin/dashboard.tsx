"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  assignSubjectsAction,
  deleteEntityAction,
  saveEntityAction,
  unassignSubjectAction,
} from "@/app/admin/actions";
import AuditLog from "@/components/admin/audit-log";
import DashboardTab from "@/components/admin/dashboard-tab";
import ThemePicker from "@/components/admin/theme-picker";
import type { EntitySchema, Field, FormState } from "@/lib/admin/entities";
import type { AuditEntry } from "@/lib/services/audit";
import type { DashboardStats } from "@/lib/services/dashboard";
import type { ThemeId } from "@/lib/theme";

type Row = Record<string, unknown>;
type AdminData = Record<string, Row[]>;
type FormAction = (formData: FormData) => void;
type BatchSubjectRow = { id: number; batchId: number; subjectId: number };

type TabKind = "dashboard" | "schema" | "batch" | "audit" | "appearance";
type Tab = { key: string; label: string; count?: number; kind: TabKind };

export default function AdminDashboard({
  schemas,
  data,
  assignments,
  theme,
  stats,
  auditEntries,
  auditNextId,
}: {
  schemas: EntitySchema[];
  data: AdminData;
  assignments: BatchSubjectRow[];
  theme: ThemeId;
  stats: DashboardStats;
  auditEntries: AuditEntry[];
  auditNextId: number | null;
}) {
  const tabs: Tab[] = [
    { key: "dashboard", label: "Dashboard", kind: "dashboard" },
    ...schemas.map((item) => ({
      key: item.key,
      label: item.label,
      count: (data[item.key] ?? []).length,
      kind: "schema" as const,
    })),
    { key: "batch-subjects", label: "Batch subjects", count: assignments.length, kind: "batch" },
    { key: "audit", label: "Audit log", count: auditEntries.length, kind: "audit" },
    { key: "appearance", label: "Appearance", kind: "appearance" },
  ];
  const [active, setActive] = useState("dashboard");
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  const schema = schemas.find((s) => s.key === current.key);

  return (
    <div className="panel">
      <div className="admin-tabs">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={item.key === current.key ? "on" : ""}
            onClick={() => setActive(item.key)}
          >
            {item.label}
            {item.count !== undefined ? <small>{item.count}</small> : null}
          </button>
        ))}
      </div>

      <div className="admin-top">
        <Link href="/" className="btn">
          View timetable
        </Link>
      </div>

      {current.kind === "dashboard" ? (
        <DashboardTab stats={stats} />
      ) : current.kind === "schema" && schema ? (
        <EntityManager
          key={schema.key}
          schema={schema}
          rows={data[schema.key] ?? []}
          schemas={schemas}
          data={data}
        />
      ) : current.kind === "audit" ? (
        <AuditLog entries={auditEntries} nextId={auditNextId} />
      ) : current.kind === "appearance" ? (
        <ThemePicker current={theme} />
      ) : (
        <BatchSubjectsManager
          batches={data.batches ?? []}
          subjects={data.subjects ?? []}
          programs={data.programs ?? []}
          assignments={assignments}
        />
      )}
    </div>
  );
}

function BatchSubjectsManager({
  batches,
  subjects,
  programs,
  assignments,
}: {
  batches: Row[];
  subjects: Row[];
  programs: Row[];
  assignments: BatchSubjectRow[];
}) {
  const [query, setQuery] = useState("");
  const byBatch = new Map<number, number[]>();
  for (const a of assignments) {
    const list = byBatch.get(a.batchId) ?? [];
    list.push(a.subjectId);
    byBatch.set(a.batchId, list);
  }
  const subjectById = new Map(subjects.map((s) => [Number(s.id), s]));
  const programById = new Map(programs.map((p) => [Number(p.id), String(p.code ?? p.name ?? "")]));
  const subjectLabel = (id: number) => {
    const subject = subjectById.get(id);
    if (!subject) return `#${id}`;
    const code = subject.code ? String(subject.code) : "";
    return code ? `${code} — ${subject.title}` : String(subject.title);
  };

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? batches.filter((b) => String(b.label ?? "").toLowerCase().includes(needle))
    : batches;

  return (
    <div className="admin-entity">
      <div className="admin-bar">
        <div>
          <h2 style={{ margin: 0 }}>Batch subjects</h2>
          <p className="muted" style={{ margin: "2px 0 0" }}>
            Subjects each batch is taking. Prefilled from the timetable — edit freely.
          </p>
        </div>
        <input
          type="search"
          className="bs-search"
          placeholder="Filter batches…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="empty">No batches match.</div>
      ) : (
        <div className="bs-list">
          {filtered.map((batch) => {
            const id = Number(batch.id);
            const assignedIds = byBatch.get(id) ?? [];
            const assignedSet = new Set(assignedIds);
            const options = subjects
              .filter((s) => !assignedSet.has(Number(s.id)))
              .map((s) => ({ id: Number(s.id), label: subjectLabel(Number(s.id)) }));
            const program = programById.get(Number(batch.programId));
            const subtitle = [program, `Semester ${batch.semesterNumber}`]
              .filter(Boolean)
              .join(" · ");
            return (
              <BatchSubjectsCard
                key={id}
                batchId={id}
                label={String(batch.label ?? `#${id}`)}
                subtitle={subtitle}
                assigned={assignedIds.map((sid) => ({ id: sid, label: subjectLabel(sid) }))}
                options={options}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function BatchSubjectsCard({
  batchId,
  label,
  subtitle,
  assigned,
  options,
}: {
  batchId: number;
  label: string;
  subtitle: string;
  assigned: { id: number; label: string }[];
  options: { id: number; label: string }[];
}) {
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function assign(subjectId: number) {
    const fd = new FormData();
    fd.set("batchId", String(batchId));
    fd.set("subjectId", String(subjectId));
    start(async () => {
      const res = await assignSubjectsAction({}, fd);
      setError(res.error ?? null);
      if (!res.error) setPick("");
    });
  }

  function unassign(subjectId: number) {
    const fd = new FormData();
    fd.set("batchId", String(batchId));
    fd.set("subjectId", String(subjectId));
    start(async () => {
      const res = await unassignSubjectAction({}, fd);
      setError(res.error ?? null);
    });
  }

  return (
    <div className="bs-batch">
      <div className="bs-batch-head">
        <strong>{label}</strong>
        <span className="muted">{subtitle}</span>
      </div>

      <div className="bs-chips">
        {assigned.length === 0 ? (
          <span className="muted">No subjects assigned.</span>
        ) : (
          assigned.map((subject) => (
            <span className="bs-chip" key={subject.id}>
              {subject.label}
              <button
                type="button"
                className="bs-chip-x"
                aria-label={`Remove ${subject.label}`}
                disabled={pending}
                onClick={() => unassign(subject.id)}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

      <div className="bs-add">
        <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={pending}>
          <option value="">— add subject —</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn primary"
          disabled={pending || pick === ""}
          onClick={() => assign(Number(pick))}
        >
          Add
        </button>
      </div>

      {error ? <div className="note error">{error}</div> : null}
    </div>
  );
}

function EntityManager({
  schema,
  rows,
  schemas,
  data,
}: {
  schema: EntitySchema;
  rows: Row[];
  schemas: EntitySchema[];
  data: AdminData;
}) {
  const [saveState, setSaveState] = useState<FormState>({});
  const [delState, setDelState] = useState<FormState>({});
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  function handleSave(formData: FormData) {
    startSave(async () => {
      const result = await saveEntityAction({}, formData);
      if (result.ok) {
        setAdding(false);
        setEditingId(null);
      }
      setSaveState(result);
    });
  }

  function handleDelete(formData: FormData) {
    startDelete(async () => {
      setDelState(await deleteEntityAction({}, formData));
    });
  }

  const error = saveState.error ?? delState.error ?? null;
  const success = delState.ok ? "Record deleted." : saveState.ok ? "Saved." : null;

  return (
    <div className="panel admin-entity">
      <div className="admin-bar">
        <div>
          <h2 style={{ margin: 0 }}>{schema.label}</h2>
          <p className="muted" style={{ margin: "2px 0 0" }}>
            {schema.description}
          </p>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setAdding((v) => !v);
            setEditingId(null);
          }}
        >
          {adding ? "Cancel" : `Add ${schema.singular}`}
        </button>
      </div>

      {error ? <div className="note error">{error}</div> : null}
      {!error && success ? <div className="note ok">{success}</div> : null}

      {adding ? (
        <EntityForm
          schema={schema}
          schemas={schemas}
          data={data}
          action={handleSave}
          pending={saving}
          submitLabel={`Create ${schema.singular}`}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {rows.length === 0 ? (
        <div className="empty">No {schema.label.toLowerCase()} yet.</div>
      ) : (
        <div className="admin-rows">
          {rows.map((row) => {
            const id = Number(row.id);
            const open = editingId === id;
            const primaryField = schema.fields.find((f) => f.name === schema.primary);
            return (
              <div className="admin-row" key={id}>
                <div className="admin-row-head">
                  <div className="t">
                    {displayValue(row[schema.primary], primaryField, schemas, data)}
                    <small>{summaryText(row, schema, schemas, data)}</small>
                  </div>
                  <div className="admin-row-actions">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setEditingId(open ? null : id)}
                    >
                      {open ? "Close" : "Edit"}
                    </button>
                    <form
                      action={handleDelete}
                      onSubmit={(e) => {
                        if (!window.confirm(`Delete this ${schema.singular}?`)) e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="entity" value={schema.key} />
                      <input type="hidden" name="id" value={id} />
                      <button type="submit" className="btn danger" disabled={deleting}>
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
                {open ? (
                  <EntityForm
                    schema={schema}
                    schemas={schemas}
                    data={data}
                    action={handleSave}
                    pending={saving}
                    submitLabel="Save changes"
                    id={id}
                    row={row}
                    onCancel={() => setEditingId(null)}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EntityForm({
  schema,
  schemas,
  data,
  action,
  pending,
  submitLabel,
  id,
  row,
  onCancel,
}: {
  schema: EntitySchema;
  schemas: EntitySchema[];
  data: AdminData;
  action: FormAction;
  pending: boolean;
  submitLabel: string;
  id?: number;
  row?: Row;
  onCancel: () => void;
}) {
  return (
    <form action={action} className="admin-row-body admin-form">
      <input type="hidden" name="entity" value={schema.key} />
      {id !== undefined ? <input type="hidden" name="id" value={id} /> : null}
      <div className="grid2">
        {schema.fields.map((field) => (
          <FieldInput
            key={field.name}
            field={field}
            schemas={schemas}
            data={data}
            value={row?.[field.name]}
          />
        ))}
      </div>
      <div className="admin-row-actions">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function FieldInput({
  field,
  schemas,
  data,
  value,
}: {
  field: Field;
  schemas: EntitySchema[];
  data: AdminData;
  value: unknown;
}) {
  const empty = value === null || value === undefined;
  const text = empty ? "" : String(value);

  if (field.type === "checkbox") {
    const checked = empty ? Boolean(field.defaultValue) : Boolean(value);
    return (
      <label className="fld fld-check">
        <span>{field.label}</span>
        <input type="checkbox" name={field.name} defaultChecked={checked} />
      </label>
    );
  }

  if (field.type === "select") {
    const selected = text || String(field.defaultValue ?? "");
    return (
      <label className="fld">
        <span>
          {field.label}
          {field.required ? " *" : ""}
        </span>
        <select name={field.name} defaultValue={selected}>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "reference") {
    const target = schemas.find((s) => s.key === field.reference);
    const options = data[field.reference ?? ""] ?? [];
    return (
      <label className="fld">
        <span>{field.label}</span>
        <select name={field.name} defaultValue={text}>
          <option value="">— select —</option>
          {options.map((opt) => (
            <option key={String(opt.id)} value={String(opt.id)}>
              {target ? String(opt[target.primary] ?? `#${opt.id}`) : String(opt.id)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "textarea") {
    return (
      <label className="fld">
        <span>{field.label}</span>
        <textarea name={field.name} defaultValue={text} rows={2} />
      </label>
    );
  }

  return (
    <label className="fld">
      <span>
        {field.label}
        {field.required ? " *" : ""}
      </span>
      <input
        type={field.type === "number" ? "number" : "text"}
        name={field.name}
        defaultValue={empty && field.defaultValue !== undefined ? String(field.defaultValue) : text}
        placeholder={field.placeholder}
        min={field.min}
        max={field.max}
      />
      {field.help ? <small className="muted">{field.help}</small> : null}
    </label>
  );
}

function summaryText(row: Row, schema: EntitySchema, schemas: EntitySchema[], data: AdminData) {
  return schema.summaryFields
    .map((name) => {
      const field = schema.fields.find((f) => f.name === name);
      if (!field) return null;
      return `${field.label}: ${displayValue(row[name], field, schemas, data)}`;
    })
    .filter(Boolean)
    .join(" · ");
}

function displayValue(
  value: unknown,
  field: Field | undefined,
  schemas: EntitySchema[],
  data: AdminData,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (!field) return String(value);
  if (field.type === "checkbox") return value ? "Yes" : "No";
  if (field.type === "select") {
    return field.options?.find((o) => o.value === String(value))?.label ?? String(value);
  }
  if (field.type === "reference") {
    const target = schemas.find((s) => s.key === field.reference);
    const match = (data[field.reference ?? ""] ?? []).find((r) => Number(r.id) === Number(value));
    if (match && target) return String(match[target.primary] ?? `#${value}`);
    return `#${value}`;
  }
  return String(value);
}
