# UniSlot

Timetable management for **COMSATS University Islamabad, Attock Campus**.

UniSlot is a ground-up rebuild of the campus "CUISlot" timetable viewer as a real,
database-backed web application. It imports the official timetable and course
catalog, serves the public timetable views on top of a PostgreSQL data model, and
(in later phases) detects and resolves schedule clashes across batches, courses,
teachers and rooms using only fully validated placements. Student identities are
not modelled — a batch-level clash simply affects everyone in that batch.

> **Status:** Phase 1 (database + public views) **complete**. Phase 2 (import
> pipeline: Batchwise + course catalog, with preview/apply APIs) **complete**.
> Phase 3 (admin CRUD API + `/admin` editing UI) **complete**. Phase 4
> (schedule clash detection) **complete**. Phase 5 (conflict resolution
> solver + atomic resolution commit) **complete**. Phase 6 (PDF/XLSX/CSV
> exports, audit-log views, real-data dashboard) **complete**. Next: Phase 7
> (concurrency/rollback/e2e hardening and Vercel deployment verification).

---

## Table of contents

- [Overview](#overview)
- [Stack](#stack)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Neon setup](#neon-setup)
- [Data model](#data-model)
- **API**
- **Import pipeline**
- **Domain rules**
- **Project structure**
- **Scripts**
- **Testing**
- **Data provenance**
- **Changelog**

## Overview

UniSlot is a single Next.js (App Router) application deployed to Vercel. It serves
both the UI and a JSON API from the same codebase — there is no separate backend
service.

```
Browser ──fetch──▶ Route Handlers ──▶ Services ──▶ Drizzle ORM ──▶ Postgres
   ▲                                                              (Neon or
   └────────────── React client components ◀── JSON ──┘           PGlite)
```

- **Route handlers** (`app/api/**/route.ts`) are thin: validate input, call
  services, serialise JSON.
- **Services** (`lib/services/**`) contain pure, testable domain logic.
- **`lib/db`** is a single facade that selects a driver at runtime and runs
  migrations + seeding once per process.

The four public views (matching the original CUISlot) are:

1. **Free Rooms** — which rooms are free/busy in a chosen day + period.
2. **Free Faculty** — which teachers are free/busy in a chosen day + period.
3. **Faculty Timetable** — a merged weekly schedule for one teacher.
4. **Batchwise Timetable** — a merged weekly schedule for one batch.

Shared UI behaviour: day/period chips, search, "Back to now", today highlight,
merged consecutive slots, repeater badges and dark mode.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | **Next.js 16.4** (App Router, Turbopack, Cache Components) |
| UI | **React 19**, Tailwind CSS v4 + hand-written design tokens ported from CUISlot |
| Language | **TypeScript** (strict) |
| ORM / migrations | **Drizzle ORM** + Drizzle Kit |
| Database | **Neon serverless Postgres** (prod) / **PGlite** (WASM, zero-install local) |
| PDF parsing | **pdfjs-dist** (text + coordinate extraction) |
| Export | **write-excel-file** (XLSX), **pdf-lib** (PDF), zero-dep CSV |
| Tests | **Vitest** |
| Deploy | **Vercel** |
| Agent tooling | Neon skills + Neon MCP (installed for opencode) |

## Running locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. The admin editing UI is at http://localhost:3000/admin
(set `ADMIN_TOKEN` in `.env` to sign in).

No database install is required: when `DATABASE_URL` is unset, the app creates an
**in-memory PGlite** (WASM Postgres) instance, applies migrations from `drizzle/`,
and seeds the committed dataset on first request. Nothing is written to disk.

## Environment

Copy `.env.example` to `.env` (git-ignored) or configure the same variables in
Vercel.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | No | Neon/Postgres connection string. **Unset → in-memory PGlite.** |
| `PGLITE_DATA_DIR` | No | Persist the local PGlite instance to disk instead of memory |
| `ADMIN_TOKEN` | No | Shared secret for admin mutations. **Unset → admin writes return 503.** |
| `BATCHWISE_PDF_PATH` | No | Override the Batchwise PDF path (default `data/source/Batchwise.pdf`) |

## Data model

See [`DATABASE_SPEC.md`](docs/DATABASE_SPEC.md) for the full column-level reference.

**Phase 1 tables:** `academic_terms`, `programs`, `batches`, `rooms`, `teachers`,
`subjects`, `periods`, `working_days`, `class_sessions`, `import_jobs`,
`import_errors`, `audit_logs`. **Phase 3 addition:** `batch_subjects` (which
subjects each batch is taking; backfilled from `class_sessions`, then editable).

Key points:

- Interval times are stored as **minutes after midnight** so half-open overlap is
  exact.
- `class_sessions.sessions_identity_uidx` is a unique constraint on
  `(term_id, batch_id, day_index, period_id, subject_id, room_id, teacher_id)`
  with `NULLS NOT DISTINCT` — this keeps seeding and imports idempotent.
- `is_repeater` is an **explicit** flag; a repeater is never inferred from the
  semester number.
- Migrations live in `drizzle/` (`0000_amazing_tusk` = Phase 1 schema,
  `0001_happy_meteorite` = `import_errors`, `0002_cuddly_solo` = catalogue fields
  on `subjects`, `0003_chunky_maximus` = `batch_subjects`, `0004_violet_ricochet`
  = `app_settings`).

## API

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/api/health` | Driver, persistence flag and row counts |
| GET | `/api/meta` | Terms, days, periods, rooms, teachers, batches, subjects |
| GET | `/api/free?kind=rooms\|teachers&day=&period=` | Free/busy lists for a slot |
| GET | `/api/timetable?batch=<id>` \| `?teacher=<id>` | Merged weekly timetable |
| GET | `/api/conflicts[?term=<id>]` | Entity-level schedule clashes (batch, course, teacher, room) |
| GET | `/api/conflicts/<sessionId>/candidates` | Legal alternative placements for one session (preview) |
| POST | `/api/resolutions` | Apply approved solver moves atomically (admin token; version-checked + revalidated) |
| GET | `/api/export/timetable?batch=<id>\|teacher=<id>&format=csv\|xlsx\|pdf` | Download a batch/teacher timetable (lossless, one row per period) |
| GET | `/api/export/conflicts[?term=<id>]&format=csv\|xlsx` | Download the clash report as a file |
| GET | `/api/dashboard` | Live row counts, active-term session count and clash totals |
| GET | `/api/admin/audit[?before=<id>&limit=<n>]` | Newest-first audit-log page (requires `ADMIN_TOKEN`) |
| GET | `/api/import/batchwise` | **Dry-run** preview of a Batchwise PDF import |
| POST | `/api/import/batchwise` | Apply the Batchwise import in one transaction (records job/errors/audit) |
| GET | `/api/import/catalog` | **Dry-run** preview of the course-catalog import |
| POST | `/api/import/catalog` | Apply the catalog import in one transaction (records job/errors/audit) |
| GET | `/api/admin/[entity]` | List rows for an entity (`programs`, `batches`, `rooms`, `teachers`, `subjects`, `periods`, `working-days`) |
| POST | `/api/admin/[entity]` | Create a row (requires `ADMIN_TOKEN`) |
| GET | `/api/admin/[entity]/[id]` | Read one row |
| PATCH | `/api/admin/[entity]/[id]` | Update a row (requires `ADMIN_TOKEN`) |
| DELETE | `/api/admin/[entity]/[id]` | Delete a row (requires `ADMIN_TOKEN`) |
| GET | `/api/admin/batch-subjects` | List batch→subject assignments |
| POST | `/api/admin/batch-subjects` | Assign subject(s) to a batch (requires `ADMIN_TOKEN`) |
| DELETE | `/api/admin/batch-subjects` | Unassign a subject from a batch (requires `ADMIN_TOKEN`) |
| GET | `/api/admin/session` | Report whether the current cookie is an admin session |
| DELETE | `/api/admin/session` | Clear the admin session cookie (sign out) |

The import handlers read the PDF from disk (Batchwise default
`data/source/Batchwise.pdf` / override `BATCHWISE_PDF_PATH`; catalog default
`course catalogs/computer science.pdf` / override `CATALOG_PDF_PATH`). `pdfjs-dist`
runs in Node mode (no worker), and each PDF is included in the Vercel trace via
`outputFileTracingIncludes`.

### Admin CRUD

Admin mutations are guarded by a shared secret. Send the token as `x-admin-token`
(or `Authorization: Bearer …`); set an optional `x-admin-actor` to label audit
entries. When `ADMIN_TOKEN` is unset every mutation returns `503`. Deletes are
refused when timetable sessions or child rows still reference the record, and
every create/update/delete is written to `audit_logs` inside the same transaction.

```bash
# Example: create a room
curl -X POST http://localhost:3000/api/admin/rooms \
  -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"name":"CR-99","kind":"classroom"}'
```

### Admin UI (`/admin`)

The same CRUD is available in the browser at `http://localhost:3000/admin`.

- Sign in with the shared `ADMIN_TOKEN`. The token is verified server-side and
  stored in an **httpOnly** cookie, so it never reaches client JavaScript.
- The global top bar reflects the session: while signed out, **Admin Panel** opens
  `/admin` in a new tab; while signed in, that button becomes a red **Sign out**
  button. The header reads the session server-side (the shared `lib/admin/session.ts`
  helper, streamed inside a `<Suspense>` boundary) rather than fetching it in the
  browser, so it is correct on first paint and after sign-in. Signing out calls
  `DELETE /api/admin/session`, refreshes, and closes the tab. This is the single
  sign-out control.
- On the admin page the public nav links (Home, Free Rooms, Free Faculty, Faculty
  Timetable, Batch Timetable) are hidden, leaving only the red **Sign out**.
- Tabs cover programmes, batches, subjects, teachers, rooms, periods and working
  days, with add/edit/delete. Every mutation runs through a Server Action that
  re-checks the session and calls the same validated service as the API.
- A **Batch subjects** tab assigns the subjects each batch is taking: each batch
  shows its subjects as removable chips plus a picker to add more. The list is
  backfilled once from the timetable, then fully editable.
- An **Appearance** tab switches the site-wide theme between six presets
  (Institutional Blue, Margalla Mist, Ivory Press, Sage Calm, Indigo Night,
  Graphite). The choice is stored in `app_settings` (global, not per-user) and
  applied by the root layout as `<html data-theme="…">`; a Server Action writes
  it and expires the cached theme so every page picks it up.
- The page is a static shell with the authenticated section streamed behind a
  `<Suspense>` boundary (Cache Components), so it stays fast while the session is
  read per request.
- Deletes are guarded exactly like the API (e.g. a programme with batches, or a
  subject used by a session, cannot be removed).

## Import pipeline

### Batchwise timetable (`data/source/Batchwise.pdf`)

- 56-page landscape timetable, real text layer (no OCR).
- Parser (`lib/import/batchwise.ts`) is pure and coordinate-driven: day rows at
  known y-baselines, five lecture columns, bold font = subject.
- Per-page footers (`Timetable generated:…`, `aSc Timetables`) and the title row
  are skipped.
- Source quirks surfaced as issues rather than guessed:
  - the `AS` marker (Wed, Lecture 2),
  - orphan room/teacher entries,
  - the page-7 title typo `BA(BA)-VII`.
- Latest parse result: **808 sessions**, **47 repeaters**, **52 lab-group
  sessions**, **24 unresolved**, **51 issues** (24 `unresolved-marker` +
  27 `orphan-detail`), across **56 batches**.

Import flow: `previewBatchwiseImport` (dry-run diff) → `applyBatchwiseImport`
(single transaction; creates missing programs/batches/rooms/teachers/subjects,
inserts sessions idempotently, writes `import_jobs`, `import_errors` and an
`audit_logs` entry).

### Course catalog (`course catalogs/computer science.pdf`)

- BS Computer Science scheme of studies: 10-page table of code, title, credit
  hours, co-requisites and prerequisites, grouped into 19 categories.
- Parser (`lib/import/course-catalog.ts`) extracts each row and raises issues for
  three `XXXXXX` placeholder codes, duplicate `CSC103` titles, and conflicting
  credit-hour forms for `CSC232`/`CSC325` (6 issues total).
- Latest parse result: **186 rows**, **163 unique codes**, **0 rows without
  credit hours**.
- Import flow: `previewCatalogImport` → `applyCatalogImport`. Existing subjects
  are matched by code then by normalised title; catalogue fields are written onto
  `subjects` (creating missing ones). Idempotent — on the Neon production branch
  the first apply created 123 subjects and updated 42, and a re-apply created 0.

## Domain rules

- **Interval overlap** is half-open: `[aStart, aEnd)` and `[bStart, bEnd)` overlap
  iff `aStart < bEnd && bStart < aEnd`. Adjacent slots do **not** overlap.
- **Rooms** are grouped by name prefix: `LH` → Lecture halls, `CR` → Classrooms,
  `LT` → Lecture theatres, otherwise Labs.
- **Consecutive blocks** are merged when batch, room, teacher and subject all
  match and the slots are adjacent.
- **Repeaters** carry an explicit session flag.
- **Clash detection** (`lib/services/clashes.ts`, `/api/conflicts`) compares
  sessions with half-open overlaps and reports every (batch, course, teacher,
  room) clash. **Combined classes** are respected: several sessions that share
  the same teacher *and* room in a slot are one lecture across batches, so a
  teacher clash requires the same teacher in different rooms and a room clash
  requires the same room under different teachers. Repeater-involved clashes are
  flagged `repeats`. A batch clash stands for every student in that cohort
  (there are no student entities).
- **Conflict resolution** (`lib/services/solver.ts`, `/api/resolutions`) finds a
  conflict-free way to move the clashing sessions and applies moves atomically.
  Statuses are faithful: `FEASIBLE`/`OPTIMAL` (minimum moves, proven),
  `INFEASIBLE` (search space exhausted), `UNKNOWN` (timeout — never reported as
  infeasible), `MODEL_INVALID` (bad references/intervals). The search is
  deterministic; keep-current is tried first, then day → period → room.
  Committing a resolution (service `applyResolution` or the guarded
  `POST /api/resolutions`) checks each moved session against the placement the
  solver built from (optimistic version check) and re-runs **full-term clash
  detection inside the same transaction** — if any clash still involves a moved
  session the whole resolution is rolled back rather than making the schedule
  worse.

## Project structure

```
app/
    api/                 route handlers (health, meta, free, timetable, conflicts, conflicts/[sessionId]/candidates,
                         resolutions, export/timetable, export/conflicts, dashboard, import/batchwise,
                         import/catalog, admin/[entity], admin/audit)
  page.tsx             home page (landing + cards linking to each tool)
  rooms/ faculty/      public views (free rooms, free faculty)
  teacher-timetable/   public view (faculty weekly timetable)
  batch-timetable/     public view (batchwise weekly timetable)
  admin/               admin editing UI (layout.tsx, page.tsx, actions.ts server actions)
  layout.tsx globals.css
components/
  uni-slot-app.tsx     client UI for the four tool views (driven by a `view` prop)
  site-header.tsx      global top menu bar (+ Admin Panel link / Sign out button)
  site-header-server.tsx  server wrapper that reads the admin session for the bar
  site-footer.tsx      global footer (developer details + navigation)
  admin/               dashboard.tsx (tab shell + CRUD tabs/forms/delete),
                       dashboard-tab.tsx (stats cards), audit-log.tsx (audit tab),
                       login.tsx (sign-in form), theme-picker.tsx (Appearance tab)
lib/
  api.ts               JSON helpers
  time.ts              interval math
  domain.ts            shared helpers (parseBatchLabel, roomKind, default periods/days)
  theme.ts             preset theme registry (ids, labels, preview swatches)
  admin/               entities.ts (entity/field schema + form parser),
                       auth.ts (bearer/x-admin-token guard), session.ts (cookie session)
  import/              batchwise.ts, course-catalog.ts, pdf-text.ts, pdfjs.d.ts
  db/                  schema.ts, index.ts (driver facade), seed.ts
services/            timetable.ts, import.ts, catalog-import.ts, admin.ts,
                        batch-subjects.ts, clashes.ts (clash detection),
                        solver.ts (conflict resolution solver),
                        resolution.ts (atomic resolution commit),
                        export.ts (CSV/XLSX/PDF writers),
                        audit.ts (audit-log read model),
                        dashboard.ts (dashboard stats),
                        settings.ts (get/set theme),
                        theme.ts (cached active-theme getter)
drizzle/               generated SQL migrations + meta
data/
  seed/                committed seed dataset (cui-space-dataset.json)
  source/              Batchwise.pdf
  parsed/              parser output (git-ignored)
  inspect/             raw text dumps used for recon (git-ignored)
scripts/
  db/                  seed.ts
  import/              parse-batchwise.ts, parse-catalog.ts, import-catalog.ts
  recon/               extract-cui-space.mjs, inspect-batchwise.mjs
docs/                  PROJECT_PLAN.md, ARCHITECTURE.md, DATABASE_SPEC.md, TESTING.md
reference/             original CUISlot page + assets
tests/                 Vitest unit + integration tests
neon.ts                Neon branch policy (scaffolded)
```

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` / `npm run test:watch` | Run tests (once / watch) |
| `npm run db:generate` | Generate a migration from the Drizzle schema |
| `npm run db:push` | Push the schema directly to the configured database |
| `npm run db:prepare` | Migrate + seed the configured database |
| `npm run extract:source` | Re-extract the seed dataset from the reference page |
| `npm run import:batchwise` | Parse `Batchwise.pdf` → `data/parsed/batchwise.json` |
| `npm run import:catalog` | Preview the course-catalog import (`-- --apply` to write) |

## Testing

Run with `npm test`. Tests never touch a real database: the setup clears
`DATABASE_URL` (in-memory PGlite) and stubs `next/server` so route handlers run
outside a Next render context.

Current suite: **118 tests across 17 files**, covering interval math, room
grouping, free/busy partitioning, block merging, seed counts + idempotency, API
responses, the Batchwise parser, the import service, the course catalog, the
catalog import service (preview/apply/idempotency/audit), the admin CRUD service
(validation, conflicts, delete guards, audit, token guard), the admin entity
schema/form parser, the batch↔subject service (backfill, assign/unassign,
validation, audit), the theme settings service (default, upsert, validation,
audit), clash detection (matrix A/C/D/H + seeded-term regression lock of 38
batch clashes), the resolution solver (B/E/F/G/L/M, `MODEL_INVALID`,
candidate legality/determinism, atomic apply + version/clash rejection on the
seeded database), and the Phase 6 services (CSV/XLSX/PDF export writers with
magic-byte assertions, the export route validation/404s, the audit-log cursor
pagination + guard, and the dashboard counts).

See [`TESTING.md`](docs/TESTING.md) for the full test matrix (cases A–O) tracked per
phase.

## Data provenance

- `reference/cui-space-live.html` — the original single-file CUISlot page. The
  Phase 1 seed dataset (56 batches, 39 rooms, 99 teachers, 200 subjects,
  813 sessions) is extracted from its embedded data by
  `scripts/recon/extract-cui-space.mjs`.
- `data/source/Batchwise.pdf` — the official 56-page PDF timetable used by the
  Phase 2 import.
- `course catalogs/computer science.pdf` — BS Computer Science Scheme of Studies
  (course codes, titles, credit hours, prerequisites).

## Changelog

### Phase 0 — Discovery
- Analysed `reference/cui-space-live.html` and its embedded dataset.
- Characterised `Batchwise.pdf` geometry (grid, cells, repeater/lab-group markers)
  via coordinate extraction.
- Parsed `course catalogs/computer science.pdf` and catalogued source
  inconsistencies.
- Confirmed constraints: Vercel-only, no local DB required.

### Phase 1 — Data foundation and public views
- Drizzle schema for terms, programs, batches, rooms, teachers, subjects, periods,
  working days, class sessions, import jobs and audit logs.
- Dual-driver DB facade: Neon (postgres.js) or in-memory PGlite when no
  `DATABASE_URL`; migrations + seeding run on first use, idempotently.
- Dataset extraction script + committed seed JSON.
- API: `/api/health`, `/api/meta`, `/api/free`, `/api/timetable`.
- UI: the four public views ported to match the original design and behaviour.
- Tests: interval math, grouping, merging, seed counts, API responses.
- Docs: `docs/PROJECT_PLAN.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_SPEC.md`, `docs/TESTING.md`.

### Phase 2 — Import pipeline (complete)
- Added `pdfjs-dist` and a Node PDF text/coordinate loader (`lib/import/pdf-text.ts`).
- Batchwise parser (`lib/import/batchwise.ts`) + `scripts/import/parse-batchwise.ts` +
  `npm run import:batchwise`. Parse: 808 sessions, 47 repeaters, 52 lab-group,
  24 unresolved, 51 issues.
- Course-catalog parser `lib/import/course-catalog.ts` + `scripts/import/parse-catalog.ts`.
  Result: 186 rows, 163 unique codes, 19 categories, 6 issues (3 `XXXXXX`
  placeholders, `CSC103` duplicate titles, `CSC232`/`CSC325` conflicting credits).
- `import_errors` table + migration `0001_happy_meteorite`; `import_jobs`,
  `import_errors` and `audit_logs` written by imports.
- `lib/domain.ts` shared helpers; `lib/db/seed.ts` refactored to use them.
- Import service (`lib/services/import.ts`) + route
  (`app/api/import/batchwise`: GET preview, POST apply).
- Catalogue fields added to `subjects` (migration `0002_cuddly_solo`); catalog
  import service (`lib/services/catalog-import.ts`) + route
  (`app/api/import/catalog`: GET preview, POST apply) + `scripts/import/import-catalog.ts`
  (`npm run import:catalog`). Matching by code then normalised title; idempotent.
- Tests: Batchwise parser, course catalog, import service, catalog import.
- Agent tooling: Neon skills + MCP installed (`--agent opencode`); `neon.ts`
  branch policy scaffolded.
- Neon project linked (`noisy-glitter-14612520`, branch `production`), policy
  deployed, and the production database migrated + seeded (11 programs, 56
  batches, 39 rooms, 99 teachers, 200 subjects, 813 sessions) and the course
  catalog imported.
- Seed rewritten to use multi-row inserts (~1,200 round trips → ~8) so it can
  seed a remote database; added `closeDb()` so CLI scripts exit cleanly; CLI
  scripts now auto-load `.env.local`.

### Phase 3 — Admin CRUD (complete)
- `lib/services/admin.ts`: validated, transactional CRUD for `programs`,
  `batches`, `rooms`, `teachers`, `subjects`, `periods` and `working_days`,
  with uniqueness/foreign-key checks, delete reference guards and `audit_logs`
  written in the same transaction.
- Admin API: `GET/POST /api/admin/[entity]` and
  `GET/PATCH/DELETE /api/admin/[entity]/[id]`.
- Shared-secret guard (`lib/admin/auth.ts`) via `ADMIN_TOKEN`; mutations return
  401/503 when the token is missing or wrong.
- Admin UI at `/admin`: token sign-in (httpOnly cookie session, `lib/admin/session.ts`),
  tabbed editing dashboard (`components/admin/dashboard.tsx`) driving Server
  Actions (`app/admin/actions.ts`), with a shared entity/field schema
  (`lib/admin/entities.ts`) used by both the forms and the server-side parser.
- Tests: `tests/admin-service.test.ts` (CRUD, validation, conflicts, delete
  guards, audit logging, token guard) and `tests/admin-entities.test.ts`
  (entity schema + form parser).
- Batch↔subject mapping: `batch_subjects` table (migration `0003_chunky_maximus`),
  `lib/services/batch-subjects.ts`, `GET/POST/DELETE /api/admin/batch-subjects`,
  and a **Batch subjects** admin tab (per-batch add/remove). Backfilled once from
  the scheduled sessions (`ensureBatchSubjects`), covered by
  `tests/batch-subjects.test.ts`.
- Session-aware top bar: the admin session (`lib/admin/session.ts`) is read in a
  server component (`components/site-header-server.tsx`) streamed inside a
  `<Suspense>` boundary, so the bar shows the red **Sign out** button while
  authenticated and the **Admin Panel** link otherwise. Signing out calls
  `DELETE /api/admin/session`.

### Theming (complete)
- `app_settings` key/value table (migration `0004_violet_ricochet`) and
  `lib/services/settings.ts` (`getTheme`/`setTheme`, validated + audited).
- Six preset themes in `lib/theme.ts`, with their tokens defined as
  `:root[data-theme="…"]` blocks in `app/globals.css`; default is
  **Institutional Blue**.
- The root layout reads the active theme through the cached `getActiveTheme()`
  (`lib/services/theme.ts`, `use cache` + `cacheTag("app-theme")`) and sets
  `<html data-theme="…">`, keeping every page in the static shell.
- The admin **Appearance** tab (`components/admin/theme-picker.tsx`) plus
  `setThemeAction` writes the choice and calls `updateTag("app-theme")` so the
  change is visible everywhere immediately.
- Tests: `tests/settings.test.ts`; browser-verified login → switch → reload →
  cross-route persistence → revert.

### Phase 4 — Schedule clash detection (complete)
- `lib/services/clashes.ts`: entity-level detection across **batch**, **course**,
  **teacher** and **room**, with half-open interval semantics.
- Combined-class handling: sessions that share the same teacher *and* room in a
  slot are one lecture across batches (not a clash); a teacher clash needs the
  same teacher in different rooms and a room clash needs the same room under
  different teachers.
- Repeater sessions take part in detection and every such clash is flagged
  `repeats`; there are no student entities, so a batch clash stands for the
  whole cohort.
- `GET /api/conflicts[?term=<id>]` returns `{ termId, sessionsChecked, clashes, counts }`.
- Seeded-term regression test locks the report to **38 batch clashes** and zero
  teacher/room/course clashes (source duplicates are combined lectures).
- Tests: `tests/clashes.test.ts` covers matrix cases **A** (repeat clash), **C**
  (teacher clash), **D** (room clash) and **H** (multiple simultaneous clashes).

### Phase 5 — Conflict resolution (complete)
- `lib/services/solver.ts`: `TimetableSolverService` + `findCandidates` +
  `loadSolverInput`. Faithful statuses `FEASIBLE`/`OPTIMAL`/`INFEASIBLE`/
  `UNKNOWN`/`MODEL_INVALID`; the timeout reports `UNKNOWN`, never `INFEASIBLE`.
  Deterministic search (moveable sessions by id; options in order: keep the
  current placement first, then day → period → room). `wouldClash` mirrors the
  Phase 4 detector so combined classes stay legal and `OPTIMAL` is a proven
  minimum-move assignment.
- `lib/services/resolution.ts`: `applyResolution` applies approved moves in one
  transaction — row-locks moved sessions, compares their placement with the
  `expected` snapshot (version conflict → rollback), re-runs full-term clash
  detection on the resulting schedule (any clash still involving a moved
  session aborts the resolution), and writes an `audit_logs` entry.
- API: `GET /api/conflicts/<sessionId>/candidates` (legal placements preview)
  and admin-guarded `POST /api/resolutions` (maps `version`→409, `invalid`→400,
  `clash`→422).
- Tests: `tests/solver.test.ts` covers matrix cases **B** (valid alternative
  accepted), **E** (a change introducing a new clash is rejected), **F**
  (infeasible → `INFEASIBLE`), **G** (timeout → `UNKNOWN`, never `INFEASIBLE`),
  **L** (existing valid placements preserved) and **M** (full-schedule
  revalidation), plus `MODEL_INVALID`, candidate legality/determinism and
  apply/rollback on the seeded database.

### Phase 6 — Exports, audit views and dashboard (complete)
- `lib/services/export.ts`: pure writers for **CSV** (RFC-4180 escaping),
  **XLSX** (`write-excel-file`, real ZIP/`PK` workbook) and **PDF** (`pdf-lib`,
  a landscape grid: rows = days, columns = periods). `timetableRows` emits one
  lossless row per scheduled period (no block merging), sorted by day → slot →
  id, with a filename sanitiser.
- API: `GET /api/export/timetable?batch=<id>|teacher=<id>&format=csv|xlsx|pdf`
  (exactly one selector; unknown entity → 404; existing entity with no sessions
  → header-only file) and `GET /api/export/conflicts?term=<id>&format=csv|xlsx`.
  Responses set the right `Content-Type` and an attachment `Content-Disposition`.
- `lib/services/audit.ts`: `listAuditEntries` (newest-first, id cursor, capped
  page size) + `countAuditEntries`; `GET /api/admin/audit` is admin-guarded.
  The admin **Audit log** tab (`components/admin/audit-log.tsx`) renders entries
  with a **Load older** button backed by the `loadAuditAction` server action.
- `lib/services/dashboard.ts`: `getDashboardStats` returns only live database
  counts (catalogue sizes, active-term session count, clash totals from the same
  detector, recent imports); `GET /api/dashboard`. The admin **Dashboard** tab
  (`components/admin/dashboard-tab.tsx`) renders them as stat cards. The admin
  tab bar was refactored to an explicit key list (Dashboard, entity schemas,
  Batch subjects, Audit log, Appearance).
- Tests: `tests/export.test.ts` (CSV escaping/ordering, XLSX `PK` header, PDF
  `%PDF-` header, route validation/404s), `tests/audit.test.ts` (seed baseline,
  cursor pagination, 503/401 guard) and `tests/dashboard.test.ts` (seeded
  counts + route). Live-verified against Neon: dashboard, all three timetable
  formats, the conflicts file and the audit page.

### Planned
- Phase 7: concurrency/rollback/e2e hardening and Vercel deployment verification.

## Documentation

- [`PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) — phases and scope
- [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design
- [`DATABASE_SPEC.md`](docs/DATABASE_SPEC.md) — schema reference
- [`TESTING.md`](docs/TESTING.md) — test strategy and required cases

## Neon setup

This project is linked to a Neon project (`noisy-glitter-14612520`, branch
`production`) and uses a `neon.ts` branch policy.

```bash
npm i -g neon@latest
neon login                     # browser sign-in (required once)
neon link --project-id noisy-glitter-14612520 --branch production -y
neon config init               # scaffold neon.ts + install @neon/config, @neon/env
neon deploy                    # apply the neon.ts policy to the branch
```

The Neon MCP server (`https://mcp.neon.tech/mcp`) and Neon agent skills are
installed. Set `DATABASE_URL` (from `neon connection-string production`) to use
Neon instead of PGlite.
