# PROJECT_PLAN.md

UniSlot is built in phases. Each phase must be complete, tested, and free of
placeholder or fake behaviour before the next begins.

## Phase 0 — Discovery (complete)

- Analysed the existing CUI Space page (`reference/cui-space-live.html`) and its
  embedded dataset.
- Characterised `Batchwise.pdf` (grid geometry, cells, repeater and lab-group
  markers) via coordinate extraction.
- Parsed `course catalogs/computer science.pdf` (course codes, titles, credits,
  prerequisites) and catalogued source inconsistencies.
- Selected the stack and confirmed constraints (Vercel-only, no local DB).

## Phase 1 — Data foundation and public views (complete)

- Drizzle schema for terms, programs, batches, rooms, teachers, subjects,
  periods, working days, class sessions, import jobs and audit logs.
- Dual-driver database facade: Neon via postgres.js, or in-memory PGlite when
  no `DATABASE_URL` is present. Migrations + seeding run on first use.
- Dataset extraction script and committed seed JSON.
- API: `/api/health`, `/api/meta`, `/api/free`, `/api/timetable`.
- UI: the four public views, ported to match the original design and behaviour
  (day/period chips, search, "Back to now", today highlight, merged consecutive
  slots, repeater badges, dark mode).
- Tests: unit (interval math, grouping, merging) and integration (seed counts,
  API responses).

## Phase 2 — Import pipeline (complete)

- PDF (Batchwise) import with coordinate parsing and an admin-resolvable
  preview, including the unresolved `AS` marker surfaced as a raw row.
- Course-catalog import (PDF) with inconsistency warnings; catalogue fields
  (code, credit hours, prerequisites, co-requisites, category) written onto
  subjects, matched by code then normalised title.
- `import_jobs` / `import_errors` recording and audit logging.
- Preview (GET) + apply (POST) APIs and CLIs for both sources.

## Phase 3 — Academic entities and admin CRUD (complete)

- Admin CRUD API + service for `programs`, `batches`, `rooms`, `teachers`,
  `subjects`, `periods` and `working_days`: validated, audited, token-guarded,
  tested.
- Admin editing UI at `/admin` (token sign-in, tabbed dashboard, Server Actions).
- Validation, audit logging and provenance on every change.
- Batch↔subject mapping (`batch_subjects`, migration `0003_chunky_maximus`):
  backfilled once from the scheduled sessions, then editable per batch in the
  admin's **Batch subjects** tab (`GET/POST/DELETE /api/admin/batch-subjects`).
- Site-wide theme switcher: six presets chosen in the admin's **Appearance** tab,
  stored globally in `app_settings` (migration `0004_violet_ricochet`) and applied
  server-side on `<html data-theme>`.
- No student entities.

## Phase 4 — Schedule clash detection (complete)

- Entity-level clash detection across batches, courses, teachers and rooms,
  with half-open interval semantics. A cohort clash affects any student in that
  batch, so individual students are not modelled.
- Repeat and lab-group markers included in the analysis: repeater sessions take
  part and repeat-involved clashes are flagged `repeats`; combined classes
  (several batches, one teacher, one room) are recognised and are not clashes.
- Implemented in `lib/services/clashes.ts` + `GET /api/conflicts` and covered by
  `tests/clashes.test.ts` (matrix cases A, C, D, H).

## Phase 5 — Conflict resolution (complete)

- Deterministic TS `TimetableSolverService` (`lib/services/solver.ts`): moveable
  sessions ordered by id; options tried in a fixed order (keep the current
  placement first, then day → period → room). `wouldClash` mirrors the Phase 4
  detector, so combined classes stay legal.
- Faithful statuses: `FEASIBLE`, `OPTIMAL`, `INFEASIBLE`, `UNKNOWN`,
  `MODEL_INVALID`. `OPTIMAL` is a proven minimum-move assignment; a timeout is
  reported as `UNKNOWN`, never `INFEASIBLE`.
- `GET /api/conflicts/<sessionId>/candidates` previews all legal alternative
  placements for one session (deterministic, capped).
- Commit via `applyResolution` (`lib/services/resolution.ts`) or the
  admin-guarded `POST /api/resolutions`: moves are row-locked and compared with
  the `expected` placement the solver built from (optimistic version check),
  then full-term clash detection is re-run inside the same transaction — any
  clash still involving a moved session aborts the resolution (422) and the
  change is rolled back. Every applied resolution writes an `audit_logs` entry.
- Covered by `tests/solver.test.ts` (matrix cases B, E, F, G, L, M plus
  `MODEL_INVALID`, candidate legality/determinism and apply/rollback against the
  seeded database).

## Phase 6 — Exports, audit views and dashboard (complete)

- **Exports** (`lib/services/export.ts`): CSV (RFC-4180), XLSX
  (`write-excel-file`) and PDF (`pdf-lib` grid) writers over the lossless
  `timetableRows` projection, plus a clash-report projection. Served by
  `GET /api/export/timetable` (batch or teacher, `format=csv|xlsx|pdf`) and
  `GET /api/export/conflicts` (`format=csv|xlsx`), with correct content types,
  attachment headers and 404 for unknown entities.
- **Audit views** (`lib/services/audit.ts`): newest-first id-cursor pagination
  and a total count; `GET /api/admin/audit` is admin-guarded. The admin
  **Audit log** tab loads older pages through the `loadAuditAction` server
  action.
- **Dashboard** (`lib/services/dashboard.ts`): real counts only — catalogue
  sizes, active-term session count, clash totals from the existing detector,
  and recent imports; `GET /api/dashboard`. Rendered by the admin **Dashboard**
  tab, which also refactored the tab bar to an explicit key list.
- Covered by `tests/export.test.ts`, `tests/audit.test.ts` and
  `tests/dashboard.test.ts`; live-verified against the seeded Neon term.

## Phase 7 — Hardening

- Concurrency tests, DB-failure rollback, end-to-end (Playwright) coverage,
  deployment verification on Vercel.
