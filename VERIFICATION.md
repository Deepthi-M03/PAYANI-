# Verification status

Last updated 27 November 2026. "Run" means the check was actually executed; nothing is listed as
passing that was not run.

## Run before packaging (passed)

| Check | Result |
| --- | --- |
| Python lint (`ruff check .` in `backend/`) | All checks passed |
| Python compiles (`compileall` on all backend code) | Passed |
| Core logic tests: routing, Dijkstra oracle, group batching, booking state machine, forecasting (`tests/unit`, 35 tests) | 35 passed |
| All three migrations applied to a real PostgreSQL 16, downgraded to empty, and re-applied | Passed; 42 tables |
| ORM model columns compared with the migrated database | No missing tables or columns |
| Every frontend `.ts`/`.tsx` file parsed by esbuild (syntax) | 41 files parsed |
| `package.json`, `tsconfig.json`, translation files, manifest are valid JSON; CI, Render and Compose files are valid YAML | Passed |
| Frontend API paths compared with backend routes | Every path the frontend calls exists in the backend |
| Secret scan of the packaged files (no `.env`, no keys or passwords in code) | Passed |

## Not yet run (runs automatically in GitHub Actions after upload)

The workspace used to prepare this ZIP could not install packages, so these have **never been run**:

| Check | Where it runs |
| --- | --- |
| `tests/unit/test_security.py`, `tests/unit/test_permissions_and_utils.py` (need `argon2-cffi`) | CI `backend` job |
| API integration tests: auth, RBAC, booking flow, Pulse, Connect, Admin, health (real PostgreSQL) | CI `backend` job |
| `alembic check` (models vs migrations via autogenerate) | CI `backend` job, advisory |
| TypeScript type check, ESLint, Vitest unit tests | CI `frontend` job |
| Production build (`vite build`) | CI `frontend` job |
| Browser end-to-end tests (register, landing search, sandbox booking, payment, reminders, cancellation, refund, reduced motion, Pixel 7 viewport) | CI `e2e` job |
| Deployed staging site | After you deploy (UPLOAD_AND_DEPLOY.md step 4) |

Because the frontend has never been compiled, expect the first CI run to report some type or lint
errors. Send me the failing step's log and I'll fix them.

## Changes in this package

- **Identity:** Express Navy palette and IBM Plex fonts across every screen; navy header with
  saffron rule; smaller radii; form fields with 3:1 borders; design tokens and their test updated.
- **Landing page:** rebuilt as a professional public page with a working station search that
  hands off to the search page after sign-in, a trainset elevation, a labelled schematic route,
  capabilities, group booking steps, data-confidence definitions, privacy and a real footer.
- **Removed:** GSAP, ScrollTrigger, Lenis, DM Serif, Inter, the cinematic landing page and its
  demo journey data.
- **Fixed:** signing in from a deep link now keeps the query string (for example a search).
- **Backend:** lint findings fixed (unused loop variable, import order, documented `noqa` for
  non-security random numbers and the OAuth `token_type`); no behaviour changes.
- **CI:** manual trigger added; `npm ci` once a lock file is committed; the resolved
  `package-lock.json` is uploaded as an artifact; `alembic check` is advisory.
- **Cost safety:** the reminder wake-up workflow no longer runs every 10 minutes by default (it
  would exceed a private repository's free Actions minutes).
- **Docs:** ADR 0002, upload and deployment guide, staging vs production, rollback, this file.

## Known gaps

Interactive map, password reset by email, live train status (needs an authorised provider), and
real booking or payment (needs IRCTC and payment-gateway agreements). See README, "Not built yet".
