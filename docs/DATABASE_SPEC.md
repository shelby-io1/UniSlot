# DATABASE_SPEC.md

PostgreSQL (Neon or PGlite). Migrations live in `drizzle/` and are generated
from `lib/db/schema.ts` with `npm run db:generate`. Migrations are applied
automatically on first database use.

## Phase 1 tables

### `academic_terms`
| Column | Type | Notes |
| --- | --- | --- |
| id | serial PK | |
| name | text unique | e.g. "Timetable CUI Attock Campus w.e.f Sep 14, 2026" |
| starts_on / ends_on | text | ISO dates |
| is_active | boolean | exactly one active term is used by the API |
| created_at | timestamptz | |

### `programs`
`id`, `code` (unique, e.g. `BS(CS)`), `name`, `department`.

### `batches`
`id`, `program_id` → programs, `semester_number`, `label` (unique, e.g.
`BS(CS)-III`). Indexed on `program_id`.

### `rooms`
`id`, `name` (unique), `kind` (`classroom` | `lab` | `lecture_hall`).

### `teachers`
`id`, `name` (unique).

### `subjects`
`id`, `code` (nullable, e.g. `CSC103`), `title`, and catalogue fields populated
by the course-catalog import: `credit_hours`, `theory_hours`, `lab_hours`,
`prerequisites`, `co_requisites`, `category`. All catalogue fields are nullable
because sessions from the timetable source may reference a subject before the
catalogue is imported.

### `periods`
`id`, `label` (unique, e.g. `L1`), `start_minutes`, `end_minutes`,
`sort_order`. Times are stored as minutes after midnight so the half-open
overlap rule is exact.

### `working_days`
`id`, `name` (unique), `sort_order`, `is_working`.

### `class_sessions`
One row per scheduled session.
| Column | Type | Notes |
| --- | --- | --- |
| id | serial PK | |
| term_id | FK academic_terms | cascade delete |
| batch_id | FK batches | cascade delete |
| room_id | FK rooms | nullable, set null |
| teacher_id | FK teachers | nullable, set null |
| subject_id | FK subjects | restrict |
| day_index | integer | 0 = first working day |
| period_id | FK periods | restrict |
| is_repeater | boolean | explicit; never inferred from semester |
| source / source_ref | text | provenance |
| created_at | timestamptz | |

Indexes: `(term_id, day_index, period_id)`, plus one on each FK. A unique
constraint `sessions_identity_uidx` on
`(term_id, batch_id, day_index, period_id, subject_id, room_id, teacher_id)`
with `NULLS NOT DISTINCT` keeps seeding and future imports idempotent.

### `import_jobs`
`id`, `kind`, `source_name`, `status`, `rows_total`, `rows_imported`,
`rows_failed`, `notes`, `created_at`, `finished_at`.

### `import_errors`
`id`, `job_id` → import_jobs (cascade), `page`, `row_ref`, `level`
(`error` | `warning`), `code`, `message`, `detail` (jsonb), `created_at`.
Indexed on `job_id`. Populated by imports for anything that cannot be applied
faithfully (for example the PDF `AS` marker, or a room/teacher with no subject).

### `audit_logs`
`id`, `action`, `entity`, `entity_id`, `detail` (jsonb), `actor`, `created_at`.
Indexed on `(entity, entity_id)`.

## Phase 3 additions

### `batch_subjects`
Explicit, admin-editable mapping of which subjects a batch is taking
(e.g. `BS(CS)-VII` → DLD, PHY). Added by migration `0003_chunky_maximus`.

| Column | Type | Notes |
| --- | --- | --- |
| id | serial PK | |
| batch_id | FK batches | cascade delete |
| subject_id | FK subjects | cascade delete |
| source | text | `timetable` (backfill) or `admin` |
| created_at | timestamptz | |

Unique `batch_subjects_uidx` on `(batch_id, subject_id)`; indexed on each FK. On
the first startup after the migration it is backfilled **exactly once** from the
distinct `(batch_id, subject_id)` pairs in `class_sessions` (guarded by an
`audit_logs` marker), so every batch starts with the subjects it appears against
in the timetable and can then be edited freely without being overwritten.

### `app_settings`
Small key/value store for application-wide, admin-editable settings. Added by
migration `0004_violet_ricochet`.

| Column | Type | Notes |
| --- | --- | --- |
| key | text PK | setting name, e.g. `theme` |
| value | text | the stored value (a preset theme id for `theme`) |
| updated_at | timestamptz | |

Currently holds a single row, key `theme`, pointing at one of the six preset
themes in `lib/theme.ts`. `setTheme` validates the id against the registry and
writes an `audit_logs` entry (`admin.theme`) with the before/after values; the
active theme is read by the root layout and applied as
`<html data-theme="…">`. Unknown/missing values fall back to
`DEFAULT_THEME` (`institutional-blue`).

## Planned tables (later phases)

`course_requirements` (corequisites/prerequisites), `teacher_availability`,
`room_availability`, `session_teacher_assignments`,
`session_room_assignments`, `timetable_versions`, `conflicts`,
`resolution_attempts`, `resolution_candidates`.

The app has **no student entities**: clashes are detected at the schedule level
(batch, course, teacher, room), so no student rosters or registrations are
modelled. Phase 4 detection is computed on the fly (pure logic over the active
term's sessions, served by `GET /api/conflicts`); if a later phase needs to
persist clashes, the `conflicts` table above would materialise that report.
Phase 5 resolves clashes without new tables: the solver commits moves straight
onto `class_sessions` (updating `day_index`, `period_id`, `room_id`) inside one
transaction that revalidates the resulting schedule and writes an
`audit_logs` entry (`resolution.apply`) describing the applied moves.

Phase 6 adds **no tables**. Exports are pure projections of `class_sessions`
(via `getSessions`, one row per period) and of `detectClashes`; the dashboard
issues aggregate `count(*)` queries plus a small page of `import_jobs`; and the
audit view pages `audit_logs` by descending `id`. All three read paths are
read-only, so the write model (`class_sessions`, `batch_subjects`,
`audit_logs`) is unchanged.

### Data-source notes

- **Batchwise.pdf** provides course title, teacher, room, plus `Repeater` and
  `Lab Group` tags. It has no course codes and no student registrations.
- **Course catalogs/computer science.pdf** provides code, title, credit hours
  and prerequisites. Known source inconsistencies (duplicate `CSC103` titles,
  conflicting credit-hour forms for `CSC232`/`CSC325`, three `XXXXXX`
  placeholders) must be surfaced as warnings, never silently resolved.
- The PDF `AS` marker (Wednesday Lecture 2) is not a schedulable course and is
  surfaced as a raw import row for an administrator to classify.
