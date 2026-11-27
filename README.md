# PAYANI

**பயணி — Traveller.** Group rail journey planning for India.

> **Start here:** [UPLOAD_AND_DEPLOY.md](UPLOAD_AND_DEPLOY.md) explains how to put this project on GitHub and deploy it. [VERIFICATION.md](VERIFICATION.md) lists exactly which checks have been run and which are still pending.

PAYANI is a railway journey platform for groups travelling in India. It finds direct and connecting trains, explains why each option is recommended, splits groups into valid bookings, sends journey reminders, and gives travellers a safe place to coordinate.

> **Honest scope.** PAYANI is not affiliated with Indian Railways or IRCTC and makes **no real bookings**. Trains are synthetic ("PAYANI Sim", numbers 90001–90999) on real station codes; bookings and payments run through clearly labelled sandbox providers; WhatsApp is dry-run only. Every time or status in the UI carries a **Simulated / Scheduled / Estimated / Verified live** label. You can hand any journey off to the official IRCTC site.

## Modules

Features below are implemented. Their verification status is in [VERIFICATION.md](VERIFICATION.md): the database migrations and core logic tests have been run; the API, frontend build and end-to-end tests run for the first time in GitHub Actions after upload.

| Module | What is built |
| --- | --- |
| **BOOK** | Station autocomplete · direct and 1–2-change search with Pareto filtering · comparison · group creation, invitations, family-aware batch plans · booking state machine · sandbox booking + payment with idempotency keys · cancellation and automatic refunds · refund tracker · official IRCTC handoff · calendar (.ics) export with alarm |
| **INTELLIGENCE** | Explained route ranking (verified against a Dijkstra oracle) · exact group batching · demand forecasting on labelled synthetic data with rolling-origin evaluation and a model card |
| **PULSE** | Reminders at 24 h / 6 h / 2 h / 1 h / 30 min / departure + arrival alert · in-app inbox · email (Mailpit locally) · browser push (when VAPID keys are set) · WhatsApp dry run with consent · quiet hours · per-channel opt-out · durable PostgreSQL job queue with retries and dead-lettering · timetable-based train status |
| **CONNECT** | Opt-in journey communities for trains on your confirmed bookings · resale / phone / UPI screening · report and block · contact sharing only when both sides agree · neutral cancellation notices that never promise a berth |
| **ADMIN** | Overview · users (enable/disable, roles) · bookings, payments, refunds · notification outbox and delivery logs · providers and data freshness · analytics · moderation queue · append-only audit log · service-charge history (0 in v1) · settings |

Roles: **Passenger**, **Administrator**, **Super Administrator** (only Super Admin can grant roles or change charges, providers and system settings).

## Run it on Windows (summary)

Full step-by-step instructions, including installing the prerequisites: **[docs/windows-setup.md](docs/windows-setup.md)**.

```powershell
# PowerShell, inside the extracted folder
python scripts\gen_secrets.py      # creates .env with random secrets and prints demo passwords
docker compose up --build          # db, api, worker, web, mailpit
```

Then open:

| What | Where |
| --- | --- |
| PAYANI | http://localhost:5173 |
| API docs (OpenAPI) | http://localhost:8000/docs |
| Emails the app sends | http://localhost:8025 |

### Demo accounts (local only)

`passenger@example.com`, `admin@example.com`, `superadmin@example.com`. Their passwords are random values written to your local `.env` by `gen_secrets.py` and printed when it runs. `example.com` is a reserved domain, so nothing can reach a real person. Demo accounts are never created in production.

## Tests

```powershell
docker compose exec api pytest                # backend unit + integration (real PostgreSQL)
docker compose exec web npm test              # frontend unit/component tests
docker compose exec api ruff check .          # Python lint
docker compose exec web npm run lint          # ESLint
docker compose exec web npm run typecheck     # TypeScript
docker compose exec api alembic check         # models and migrations agree
cd frontend; npx playwright install chromium; $env:E2E_BASE_URL="http://localhost:5173"; npx playwright test
```

## Documentation

| Document | Contents |
| --- | --- |
| [docs/windows-setup.md](docs/windows-setup.md) | Installing prerequisites and running on Windows |
| [docs/architecture.md](docs/architecture.md) | Components, modules, data flow, motion architecture |
| [docs/api.md](docs/api.md) | Endpoint reference (the live OpenAPI docs are authoritative) |
| [docs/adr/0001-phase-1-decisions.md](docs/adr/0001-phase-1-decisions.md) | The 13 approved decisions (palette and motion superseded by ADR 0002) |
| [docs/adr/0002-express-navy-and-launch-path.md](docs/adr/0002-express-navy-and-launch-path.md) | Express Navy identity, motion, maps plan, staging vs production hosting |
| [docs/deployment.md](docs/deployment.md) | Staging on free Render + Netlify, production checklist, rollback |
| [docs/attribution.md](docs/attribution.md) | Data provenance, imagery, fonts, icons and libraries |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common problems and fixes |

## Not built yet

- **Interactive map** (MapLibre GL JS + OpenFreeMap, planned in ADR 0002).
- **Password reset by email** (needs an email sending account in your name).
- **Live train status and seat availability** (needs an authorised data provider; PAYANI shows scheduled times only and never labels them live).
- **Real bookings and payments** (needs an IRCTC authorised-agent agreement and a payment gateway; bookings and payments are sandbox only).

## Licence

Not yet chosen. Add a licence before making the repository public.
