# TESTING.md

Run the suite with `npm test` (Vitest). Tests never touch a real database: the
setup file clears `DATABASE_URL` so every test uses the in-memory PGlite
driver, and `next/server` is stubbed (`tests/stubs/next-server.ts`) so route
handlers run outside a Next render context.

## Current coverage

`tests/time.test.ts`
- Half-open overlap semantics: genuine overlap, boundary-touching (no overlap),
  disjoint, containment, equality.
- Time formatting matches the source UI (`510 → 8:30`, `795 → 1:15`).

`tests/timetable-service.test.ts`
- Room grouping by prefix.
- `computeFree` partitions rooms and teachers into free/busy with the correct
  batch/teacher/room detail.
- Everyone is free when a slot has no sessions.
- `mergeDayBlocks` merges adjacent identical sessions and does not merge across
  a different room.

`tests/seed.test.ts`
- Driver selection (PGlite when no `DATABASE_URL`).
- Full dataset seed counts (56 batches, 39 rooms, 99 teachers, 200 subjects,
  813 sessions).
- Seeding is idempotent.
- Batch-label parsing (program + roman-numeral semester).

`tests/api.test.ts`
- `/api/health` counts and driver.
- `/api/meta` reference data sizes and active term.
- `/api/free` partitions all rooms / all teachers and rejects bad input.
- `/api/timetable` returns five days and validates the selector.

`tests/batchwise-parser.test.ts`
- Room and lecture-column classification.
- Term/batch-title parsing with page furniture (headers/footers) skipped.
- Multi-line subject joining, teacher/room detection.
- Repeater and lab-group markers.
- Splitting two stacked parallel-lab sessions in one cell.
- The `AS` marker and orphan room/teacher are raised as issues, not sessions.

`tests/course-catalog.test.ts`
- Credit-hour parsing (`3(2, 1)`), heading/category detection and row
  extraction.
- Placeholder codes and conflicting course listings are raised as issues.

`tests/import-service.test.ts`
- `previewBatchwiseImport` counts importable/skipped/new sessions and writes
  nothing.
- `applyBatchwiseImport` creates the term/entities/sessions atomically, is
  idempotent, records errors + an audit entry, and creates missing programs.

`tests/catalog-import.test.ts`
- `previewCatalogImport` counts unique codes/matched/new/skipped and writes
  nothing.
- `applyCatalogImport` creates then updates subjects idempotently, matches an
  existing subject by title, and records errors + an audit entry.

`tests/admin-service.test.ts`
- Create/update/delete for every admin entity, with field validation
  (required/typed/enum), unique-conflict (409) and interval checks.
- Delete reference guards (programs with batches, subjects with sessions) and
  audit-log entries per mutation.
- The shared-secret guard: 503 when unset, 401 on a wrong token, pass on the
  correct `x-admin-token` or `Authorization: Bearer` value.

`tests/admin-entities.test.ts`
- The shared entity/field schema covers every admin entity and only references
  valid entities/fields.
- The form parser turns checkboxes into booleans, converts numbers/references,
  omits empty numerics and preserves empty text (clear optional / fail required
  server-side).

`tests/batch-subjects.test.ts`
- `listBatchSubjects` returns the mapping backfilled once from `class_sessions`.
- `assignSubjectsToBatch` assigns, is idempotent (a repeat returns no new rows)
  and writes an audit entry; rejects unknown batches, unknown subjects and empty
  lists.
- `unassignSubjectFromBatch` removes an assignment, returns `false` for one that
  was not assigned, and leaves no row behind.

`tests/settings.test.ts`
- The theme registry exposes six unique presets with a valid default, and
  `normalizeThemeId` falls back to the default for unknown/null values.
- `getTheme` returns the default when no theme is stored.
- `setTheme` persists a valid id, upserts a single `app_settings` row and writes
  an `admin.theme` audit entry; rejects unknown or non-string ids without
  changing the stored value.

The theme switch is also verified end-to-end in a real browser (sign in → open the
**Appearance** tab → pick a preset → reload → confirm the new `data-theme` on
another route → revert).

`tests/clashes.test.ts`
- Half-open entity clashes: teacher clash (same teacher, different rooms),
  room clash (same room, different teachers), repeat-session clash flagged
  `repeats`, course clash (same subject on the same batch), and multiple
  simultaneous clashes all reported together.
- Combined classes (same teacher *and* room across batches) are **not** clashes;
  touching periods and different days are not clashes; missing rooms/teachers
  are ignored.
- Integration: the seeded term reports **38 batch clashes** and zero
  teacher/room/course clashes as a regression lock, and
  `GET /api/conflicts` serves the report.

`tests/solver.test.ts`
- Solver statuses are faithful: **B** a valid alternative placement for a
  clashing pair is accepted (`FEASIBLE`), `OPTIMAL` is the proven minimum match
  (fixing a two-session clash in a single move), **F** a batch whose slots are
  all occupied reports `INFEASIBLE`, and **G** a timeout reports `UNKNOWN` and
  never `INFEASIBLE`.
- `findCandidates` never offers a slot already taken by the session's batch,
  every candidate keeps the moved session clash-free, and the ordering is
  deterministic (keep-current excluded; day → period → room).
- **L** non-moveable sessions and existing valid placements are preserved.
- `MODEL_INVALID` for unknown fix ids, bad period intervals and unknown rooms.
- Against the seeded database, `applyResolution`: **M** applies a solver move
  atomically (targeted clash cleared, total clashes drop, audit entry written),
  rejects a stale `expected` placement with a `version` conflict and rolls back,
  and **E** rejects a move that introduces a new batch clash (`code: "clash"`)
  and rolls back.
- `POST /api/resolutions` guard: 503 when `ADMIN_TOKEN` is unset, 401 without a
  correct token, 400 for an empty move list.

`tests/export.test.ts`
- Pure helpers: `parseFormat` (csv default, case/whitespace tolerance, rejects
  unknown or disallowed formats), `safeFilename` (path traversal stripped) and
  `toCsv` (RFC-4180 quoting of commas/quotes/newlines, CRLF termination).
- `timetableRows` orders by day → slot → id and formats the period/time columns.
- `rowsToXlsx` returns a Buffer starting with the ZIP magic `PK\x03\x04` and
  containing `xl/workbook.xml`; `buildTimetablePdf` returns bytes starting with
  `%PDF-`.
- Route behaviour: batch CSV body starts with the header row and contains the
  batch label; teacher CSV contains the teacher name; XLSX/PDF responses carry
  the right content type and magic bytes; exactly-one-selector and bad-format →
  400; unknown batch → 404; the conflicts export defaults to CSV and rejects
  `pdf` with 400.

`tests/audit.test.ts`
- The seed baseline (two entries) is returned newest-first with no cursor.
- After inserting five rows, `listAuditEntries` pages newest-first, exposes a
  `nextId` cursor only while more remain, and walks to the end.
- `GET /api/admin/audit` guard: 503 when `ADMIN_TOKEN` is unset, 401 with a wrong
  token, a valid page with the correct token, and 400 for an invalid `before`.

`tests/dashboard.test.ts`
- `getDashboardStats` reports the seeded catalogue counts (rooms 39, teachers 99,
  batches 56, periods/days 5), the active term (813 sessions), and the clash
  figures straight from the detector (38 batch, 0 course/teacher/room, 4
  repeater-involved).
- `GET /api/dashboard` serves the same shape.

The `/admin` UI itself is verified end-to-end with a runtime smoke check (login
without a token, dashboard with the correct cookie, login again with a wrong
cookie) rather than unit tests; its mutations call the same service covered by
`tests/admin-service.test.ts`.

## Required test matrix (master specification)

These are tracked here so they are implemented as the relevant phases land.
They must be real automated tests, not manual checks.

| ID | Case | Phase |
| --- | --- | --- |
| A | A repeat-session clash is detected | 4 ✅ |
| B | A valid alternative placement is accepted | 5 ✅ |
| C | A change causing a teacher clash is rejected | 4 ✅ |
| D | A change causing a room clash is rejected | 4 ✅ |
| E | A change introducing a new batch clash is rejected | 5 ✅ |
| F | A genuinely infeasible instance reports `INFEASIBLE` | 5 ✅ |
| G | A timeout reports `UNKNOWN` (never `INFEASIBLE`) | 5 ✅ |
| H | Multiple simultaneous clashes are all handled | 4 ✅ |
| I | A concurrent change is detected (version check) | 7 |
| J | A database failure rolls back the transaction | 7 |
| K | An invalid import is rejected with errors recorded | 2 ✅ |
| L | Existing valid placements are preserved | 5 ✅ |
| M | Full-schedule revalidation passes before commit | 5 ✅ |
| N | Exact boundary times are handled correctly | 1 ✅ |
| O | No fake functionality / data exists | ongoing |

Cases marked ✅ are covered now (N by `time.test.ts`; O is enforced by review
and by the absence of hardcoded metrics).
