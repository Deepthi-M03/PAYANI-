# Pre-deployment audit (27 Nov 2026)

Run against real PostgreSQL 16, the real API and a real Chromium; nothing mocked in the app.

- **Fixed:** cancelling any booking returned HTTP 500 (a date string was compared with a `date`
  column in `connect/service.py`), which broke cancellation and refunds.
- **Fixed:** the stale readiness test (now compares with the real Alembic head) and the
  design-token test that could not load its CSS path.
- **Fixed:** after *Sign out* the app could land on the login page instead of home.
- **Added:** wake-up handling for sleeping free hosting (`frontend/src/lib/wake.ts`); the session
  is no longer dropped when the server is slow, with a banner and a *Try again* screen.
- **Added:** the forecast model is trained in the background at start (`WARM_FORECAST_ON_START`).
- **Added:** lock files and a pinned `requirements.txt`; CI installs with `--locked` / `npm ci`.
- **Changed:** `render.yaml` no longer creates Render's 30-day free database; use Neon free.
- **Fixed:** `alembic.ini` now sets `prepend_sys_path`, so migrations run when the package is not
  installed (found by rehearsing Render's clean build).
- **CI:** the e2e API relaxes only the register rate limit (`RATE_LIMIT_REGISTER_PER_MINUTE`).

---

# Verification status

Last updated 27 November 2026 (timetable import and Google Maps handoff). "Run" means the check was actually executed; nothing is listed as
passing that was not run.

## Run before packaging (27 Nov 2026, timetable and Google Maps update)

| Check | Result |
| --- | --- |
| Python lint (`ruff check .` in `backend/`) | All checks passed |
| Backend unit tests that need no database (`tests/unit` except the two below): routing, Dijkstra oracle, batching, state machine, forecasting, **timetable parsing and validation, duplicates, missing and malformed fields, freshness labels, provenance, Google Maps URLs** | **64 passed, 0 failed** |
| Migrations 0001 to 0004 on PostgreSQL 16: upgraded, downgraded to empty, upgraded again | Passed; 43 tables |
| ORM model columns compared with the migrated database | 43 tables, 0 missing columns |
| TypeScript, strict settings, with the **real declaration files** copied from your `node_modules` (React, React DOM, React Router, TanStack Query, i18next, react-i18next, Lucide, MapLibre GL, Vite client) | 0 errors in project code. Two remaining messages come from a stand-in for `react-hook-form`, whose types were not copied (form callbacks typed `any`), in unchanged sign-in and register pages. TypeScript 6 was used here; your project pins 5.9.3. |
| Frontend logic tests `googleMaps.test.ts` and `provider.test.ts`, run with `tsx` and a small Vitest stand-in (Vitest itself could not run here) | 5 passed, 0 failed |
| `package-lock.json` (from your computer) matches `package.json` and includes Linux build binaries for CI | Matches |
| Secret scan of the packaged files | No `.env`, keys or passwords |

Not run here: the **9 timetable integration tests** (`tests/integration/test_timetable_import.py`) and the other 56 integration tests, plus the 12 unit tests in `test_security.py` and `test_permissions_and_utils.py`. They need FastAPI, SQLAlchemy, psycopg and argon2, which could not be installed in this workspace. The timetable integration tests cover:

- unauthorised import attempts;
- provenance recording and the switch of search to imported data;
- idempotent re-import;
- superseding a previous import;
- rejecting an invalid dataset with the catalogue unchanged;
- rollback after a database failure, keeping the previous timetable;
- required metadata for data.gov.in;
- withdrawing back to the simulated catalogue;
- sandbox booking refused for imported trains that have no classes or distance.

These run in GitHub Actions, or locally with `pytest` (see docs/local-without-docker.md). No real dataset was imported here, because this workspace cannot download from GitHub or data.gov.in.

## Visual inspection (run)

The real frontend source was bundled and rendered in headless Chrome with the real Tailwind v4
compiler, using small stand-ins for packages that could not be installed in the build workspace
(router, query, forms, i18n, Motion, icons) and sample API responses generated from PAYANI's own
backend logic (stations, journeys, forecast and model card). IBM Plex was not installed there,
so screenshots use Inter and Liberation Mono instead.

Inspected at 1440 px, 820 px and 390 px: landing (including live search, map station picking and
route drawing), sign-in, register, dashboard, search, booking form, booking detail, bookings,
refunds, groups, group detail, intelligence, pulse, train schedule, connect, community, all seven
admin tabs, 404, error state (API down), empty state and reduced motion. No page errors on any
route at desktop or mobile. The 27 Nov timetable update was checked the same way: Administration → Timetable (simulated and imported states, import report), search and landing with an outdated imported dataset, all at 1440 px and 390 px. A table header that widened the phone layout was found and fixed. Defects found and fixed during inspection: overlapping result-card
details at mid widths, wrapping header buttons and cramped tables on phones, error states shown as
empty states on the dashboard, a drawer badge under the close button, floating viaduct piers.

**Not visually verified:** the MapLibre map with real OpenFreeMap tiles and the OpenRailwayMap
overlay. The build workspace cannot reach those services, so screenshots show the simplified map
that PAYANI uses when tiles or WebGL are unavailable. The MapLibre code path runs for the first
time in a real browser; check it on the deployed staging site.

## Not yet run (runs automatically in GitHub Actions after upload)

| Check | Where it runs |
| --- | --- |
| `tests/unit/test_security.py`, `test_permissions_and_utils.py` (need `argon2-cffi`) | CI `backend` |
| API integration tests, including 9 timetable import tests and the `GET /api/v1/stations/map` test (real PostgreSQL) | CI `backend` |
| TypeScript 5.9 with every package's types, ESLint, Vitest | CI `frontend` |
| Production build with Vite (fonts, MapLibre, Tailwind) | CI `frontend` |
| Browser end-to-end tests: register, landing search without an account, map station picking, sandbox booking, payment, reminders, cancellation, refund, reduced motion, phone viewport | CI `e2e` |

The frontend has not yet been bundled by Vite, or linted with ESLint. If a CI step fails, send its log and it will be fixed.

## Changes in this package (27 Nov 2026, timetable and Google Maps)

- **Timetable import** (`payani/domain/timetable_import.py`, `payani/modules/timetable/`, migration `0004`): DataMeet (CC0, 2016) and data.gov.in CSV parsers, full validation, all-or-nothing activation in one transaction, idempotent re-import, import history with provenance, withdraw, CLI, audit log entries.
- **Labels:** journeys carry `data.confidence` = `scheduled` with source, publication date, import date and an outdated warning; the simulated catalogue stays labelled Simulated.
- **Admin → Timetable:** current dataset, import form (Super Admin), history and validation report.
- **Google Maps handoff:** "Google Maps" links on map station cards, journey cards and booking pages; no key. An optional provider setting is prepared for a Google-rendered map, but stays off.
- **Run without Docker:** `docs/local-without-docker.md`. The backend now also reads `.env` from the project folder.
- **package-lock.json** added, from your `npm install`, so CI uses `npm ci`. `maplibre-gl` is now `^5.24.1`, as your install recorded.

## Changes in the previous package (27 Nov 2026, redesign)

- **Brand:** original PAYANI symbol and wordmark, favicon, app icons, light and dark logo files,
  logo animation, boot screen. See `docs/brand.md`.
- **Maps:** `RailMap` (MapLibre GL JS + OpenFreeMap, OpenRailwayMap overlay on public pages,
  simplified fallback), station picking, route draw-on, a one-pass journey indicator, camera moves,
  legend that labels schematic lines. New endpoint `GET /api/v1/stations/map` (stations with
  approximate positions and schematic network links) with an integration test.
- **Landing:** animated hero with live search and map, results inline, storytelling routes with
  layered landscapes and parallax, group booking, modules, trust and privacy, animated CTA.
- **App:** navy sidebar shell with mobile drawer; every module redesigned (dashboard with
  boarding-pass countdown, search with map, booking steps, ticket view, groups, refunds,
  intelligence with model metrics, Pulse inbox and channels, train schedule, Connect and
  community feed, admin with tabs, charts and tables, sign-in panels, 404).
- **Design system:** panels, stats, tables, skeleton loaders, error and empty states, buttons with
  sizes, link buttons, toggles, key-value lists, motion tokens and reveal utilities.
- **Fixed:** stale health test expected migration 0001 (head is 0003).
- **Removed:** unused trainset drawing.

## Known gaps

Real track geometry for journey lines (lines are schematic and labelled), licensed travel
photography (scenes are original illustrations; see `docs/attribution.md`), password reset by
email, live train status, real booking or payment.
