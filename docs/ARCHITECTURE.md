# ARCHITECTURE.md

## Overview

UniSlot is a single Next.js (App Router) application deployed to Vercel. It
serves both the UI and a JSON API from the same codebase. There is no separate
backend service.

```
Browser ──fetch──▶ Route Handlers ──▶ Services ──▶ Drizzle ORM ──▶ Postgres
   ▲                                                              (Neon or
   └────────────── React client components ◀── JSON ──┘           PGlite)
```

- **Route handlers** (`app/api/**/route.ts`) are thin: they validate input,
  call services, and serialise JSON.
- **Services** (`lib/services/**`) contain pure, testable domain logic.
- **`lib/db`** is a single facade that selects a driver at runtime. The
  in-memory PGlite driver migrates + seeds on first use; a persisted
  `DATABASE_URL` database is provisioned once (see Database selection).

## Database selection

`lib/db/index.ts` chooses the driver by environment:

| Condition | Driver | Persistence |
| --- | --- | --- |
| `DATABASE_URL` set | `postgres` (postgres.js) → Neon | Persistent |
| `DATABASE_URL` unset | `@electric-sql/pglite` (WASM Postgres) | In-memory¹ |

¹ Set `PGLITE_DATA_DIR` to persist the local PGlite instance to disk.

Initialisation is memoised: the first call to `getDb()` creates the client.

- **PGlite** (no `DATABASE_URL`) always applies migrations from `drizzle/` and
  seeds the committed dataset, so tests and demo mode need no setup.
- **Postgres/Neon** connects as-is. Provision a database once with
  `npm run db:prepare` (or set `DB_AUTO_SETUP=1`) to migrate + seed it; leaving
  setup out of the connection path avoids several round-trips on every cold
  start. Seeding is idempotent — it is skipped when sessions already exist.

## Rendering and caching

Cache Components (`cacheComponents: true`) plus Partial Prefetching are enabled.
Pages and components are cached explicitly with `use cache`; data is otherwise
fetched at request time. The API handlers call `connection()` so they always run
per request and are never prerendered with stale data. The home page is a static
shell that streams client data.

Read-only JSON endpoints set a short `Cache-Control` (`/api/meta` 30s,
`/api/free` and `/api/timetable` 15s, all with `stale-while-revalidate`) so the
browser can serve repeat lookups without a round-trip; admin mutations remain
`no-store`. `/api/free` resolves the active term and reference lists in a single
pass (`getFreeAvailability`) rather than loading the full metadata payload.

The session-aware top bar (`components/site-header-server.tsx`) reads the admin
cookie via `lib/admin/session.ts` and is streamed inside a `<Suspense>` boundary
in the root layout, so the rest of each page stays prerenderable (routes render
as partial prerender, `◐`). Signing in through the admin Server Action
`redirect()`s back to `/admin`, which re-fetches the dynamic boundary so the bar
reflects the new session without any client-side session fetch.

The site-wide theme follows the same shape. `getActiveTheme()`
(`lib/services/theme.ts`) is a `use cache` function tagged `app-theme` that reads
the `theme` setting from `app_settings`; the root layout `await`s it and sets
`<html data-theme="…">`, so the theme is part of the static shell and every route
stays prerenderable. Changing the theme through the admin Server Action
(`setThemeAction`) writes the row and calls `updateTag("app-theme")`, expiring
only that entry on the next request. The token values for each preset live in
`app/globals.css` as `:root[data-theme="…"]` blocks; `lib/theme.ts` is the
client-safe registry (ids, labels, previews) shared by the UI and the service.

## Domain rules

- **Interval overlap** is half-open: `[aStart, aEnd)` and `[bStart, bEnd)`
  overlap iff `aStart < bEnd && bStart < aEnd`. Adjacent slots do not overlap.
- **Rooms** are grouped by name prefix (`LH` → Lecture halls, `CR` → Classrooms,
  `LT` → Lecture theatres, otherwise Labs).
- **Consecutive blocks** are merged when batch, room, teacher and subject all
  match and the slots are adjacent.
- **Repeaters** are carried as an explicit session flag; semester number is
  never used to infer a repeater.
- **Clash detection** (`lib/services/clashes.ts`, handled at
  `app/api/conflicts/route.ts`) is entity-level: two sessions on the same day
  whose intervals overlap and contend for a **batch**, **course** (same subject
  on the same batch), **teacher** or **room** form a clash. Combined classes are
  respected — sessions sharing the same teacher and room are one lecture across
  batches — so a teacher clash requires the same teacher in different rooms and
  a room clash requires the same room under different teachers. Clashes
  involving a repeater are flagged `repeats`. Every clash is reported, never
  suppressed, and a single pair can raise more than one kind (batch and course,
  for example).
- **Conflict resolution** is a two-stage flow built on the detector:
  1. **Solve/preview.** `lib/services/solver.ts` exposes
     `findCandidates(input, sessionId)` (all legal placements for a single
     session against the rest of the schedule, deterministic: day → period by
     sortOrder → room) and `TimetableSolverService.solve()` (backtracking over
     the moveable sessions, ordered by id, options in a fixed order — keep the
     current placement first, then the generated candidates). Statuses are
     faithful: `FEASIBLE` (first conflict-free assignment), `OPTIMAL` (minimum
     number of moved sessions, proven), `INFEASIBLE` (search space exhausted),
     `UNKNOWN` (the configured timeout fired — never reported as infeasible),
     `MODEL_INVALID` (unknown ids or inconsistent intervals). `wouldClash`
     reimplements the detector's rules, so a solution can never rely on an
     illegal placement. `GET /api/conflicts/<sessionId>/candidates` serves the
     single-session preview.
  2. **Commit.** `lib/services/resolution.ts` `applyResolution` applies the
     approved moves in one transaction: it row-locks the moved sessions and
     compares their current placement with the `expected` snapshot the solver
     built from (an optimistic version check; mismatch throws a
     `ResolutionConflict` with `code: "version"`), applies the moves, re-runs
     full-term detection on the resulting schedule — aborting if any clash still
     involves a moved session (`code: "clash"`) — and writes an `audit_logs`
     entry. The admin-guarded `POST /api/resolutions` maps `version`→409,
     `invalid`→400 and `clash`→422. Because validation happens inside the
     transaction, a resolution can never be applied half-way or make the
     schedule worse.

## Exports, audit views and dashboard

- **Exports** (`lib/services/export.ts`) are pure, testable writers:
  - `timetableRows(sessions, dayNames)` projects sessions into a lossless,
    one-row-per-period shape (ordered by day → slot → id). No block merging is
    applied, so a file matches the database exactly.
  - `toCsv` (RFC-4180 escaping + CRLF), `rowsToXlsx` (`write-excel-file`, a real
    OOXML workbook) and `buildTimetablePdf` (`pdf-lib`; landscape grid with
    days as rows and periods as columns, blank cells = no class).
  - `GET /api/export/timetable?batch=<id>|teacher=<id>&format=csv|xlsx|pdf` and
    `GET /api/export/conflicts[?term=<id>]&format=csv|xlsx` reuse `getSessions` /
    `detectClashes`; they set the right content type and an attachment
    `Content-Disposition` (via `fileResponse`), return 404 for unknown entities,
    and headers-only files for entities with no sessions.
- **Audit views** (`lib/services/audit.ts`): `listAuditEntries` reads newest-first
  with an `id`-descending cursor (a stable cursor because ids are serial) and a
  bounded page size; `countAuditEntries` gives the total. `GET /api/admin/audit`
  is admin-guarded because it exposes actor identities and change payloads. The
  admin **Audit log** tab paginates through the `loadAuditAction` server action.
- **Dashboard** (`lib/services/dashboard.ts`): `getDashboardStats` assembles only
  live counts — catalogue sizes, the active-term session count, clash totals from
  the same detector used everywhere else, and recent import jobs. `GET
  /api/dashboard` is read-only. The admin **Dashboard** tab renders these as stat
  cards; the tab bar is an explicit key list (Dashboard, entity schemas, Batch
  subjects, Audit log, Appearance).

## Directory layout

```
app/
  api/                 route handlers (health, meta, free, timetable, conflicts,
                       conflicts/[sessionId]/candidates, resolutions,
                       export/timetable, export/conflicts, dashboard,
                       import/batchwise, import/catalog, admin/[entity], admin/audit)
  layout.tsx page.tsx globals.css
components/
  uni-slot-app.tsx     client UI (the four public views)
  site-header.tsx      top bar client component (nav + Admin Panel / Sign out)
  site-header-server.tsx  server wrapper that reads the admin session
  admin/               dashboard.tsx (tab shell + CRUD UI), dashboard-tab.tsx
                       (stats cards), audit-log.tsx (audit tab),
                       login.tsx (sign-in form), theme-picker.tsx (Appearance tab)
lib/
  api.ts               JSON helpers
  time.ts              interval math
  domain.ts            shared helpers (labels, room kinds, defaults)
  theme.ts             preset theme registry (ids, labels, previews)
  admin/               entities.ts, auth.ts, session.ts (admin API + UI)
  import/              batchwise.ts, course-catalog.ts, pdf-text.ts, pdfjs.d.ts
  db/                  schema.ts, index.ts (driver facade), seed.ts
  services/            timetable.ts, import.ts, catalog-import.ts, admin.ts,
                       batch-subjects.ts, clashes.ts (clash detection),
                       solver.ts (resolution solver + candidates),
                       resolution.ts (atomic resolution commit),
                       export.ts (CSV/XLSX/PDF writers),
                       audit.ts (audit-log read model),
                       dashboard.ts (dashboard stats),
                       settings.ts (theme get/set),
                       theme.ts (cached active-theme getter)
drizzle/               generated SQL migrations + meta

scripts/
  db/                  seed.ts
  import/              parse-batchwise.ts, parse-catalog.ts, import-catalog.ts
  recon/               extract-cui-space.mjs, inspect-batchwise.mjs
docs/                  PROJECT_PLAN.md, ARCHITECTURE.md, DATABASE_SPEC.md, TESTING.md
reference/             original CUISlot page and extracted assets
tests/                 vitest unit + integration tests
```

## Honesty constraints

- No fabricated data, metrics, or buttons. Every number shown is queried from
  the database.
- The seed reflects the extracted source dataset exactly; unknowns (such as the
  `AS` marker in the PDF) are surfaced for human resolution rather than guessed.
