# PAYANI

**பயணி — Traveller.** Group rail journey planning for India.

> **Start here:** [UPLOAD_AND_DEPLOY.md](UPLOAD_AND_DEPLOY.md) explains how to put this project on GitHub and deploy it. [VERIFICATION.md](VERIFICATION.md) lists exactly which checks have been run and which are still pending.

PAYANI is a railway journey platform for groups travelling in India. It finds direct and connecting trains, explains why each option is recommended, splits groups into valid bookings, sends journey reminders, and gives travellers a safe place to coordinate.

> **Honest scope.** PAYANI is not affiliated with Indian Railways or IRCTC and makes **no real bookings**.
>
> - **Trains.** Out of the box, the trains are synthetic ("PAYANI Sim", numbers 90001–90999) on real station codes. A Super Administrator can import a real **historical** timetable instead, from DataMeet (CC0) or data.gov.in. It is labelled **Scheduled**, with its source, publication date and an **outdated** warning. See [docs/timetable-data.md](docs/timetable-data.md).
> - **Bookings and payments** run through clearly labelled sandbox providers. Real tickets are booked on the official IRCTC site.
> - **WhatsApp** is dry-run only.
> - **Labels.** Every time or status in the UI carries a **Simulated / Scheduled / Estimated / Verified live** label.

## Modules

Features below are implemented. Their verification status is in [VERIFICATION.md](VERIFICATION.md): the database migrations and core logic tests have been run; the API, frontend build and end-to-end tests run for the first time in GitHub Actions after upload.

| Module | What is built |
| --- | --- |
| **BOOK** | Search over the synthetic or an imported historical timetable, with source and freshness shown · "Open in Google Maps" links (no key, no cost) · station autocomplete · direct and 1–2-change search with Pareto filtering · comparison · group creation, invitations, family-aware batch plans · booking state machine · sandbox booking + payment with idempotency keys · cancellation and automatic refunds · refund tracker · official IRCTC handoff · calendar (.ics) export with alarm |
| **INTELLIGENCE** | Explained route ranking (verified against a Dijkstra oracle) · exact group batching · demand forecasting on labelled synthetic data with rolling-origin evaluation and a model card |
| **PULSE** | Reminders at 24 h / 6 h / 2 h / 1 h / 30 min / departure + arrival alert · in-app inbox · email (Mailpit locally) · browser push (when VAPID keys are set) · WhatsApp dry run with consent · quiet hours · per-channel opt-out · durable PostgreSQL job queue with retries and dead-lettering · timetable-based train status |
| **CONNECT** | Opt-in journey communities for trains on your confirmed bookings · resale / phone / UPI screening · report and block · contact sharing only when both sides agree · neutral cancellation notices that never promise a berth |
| **ADMIN** | Timetable import (validation report, provenance, history, withdraw) · overview · users (enable/disable, roles) · bookings, payments, refunds · notification outbox and delivery logs · providers and data freshness · analytics · moderation queue · append-only audit log · service-charge history (0 in v1) · settings |

Roles: **Passenger**, **Administrator**, **Super Administrator** (only Super Admin can grant roles or change charges, providers and system settings).

## Run it on Windows (summary)

- **Without Docker:** PostgreSQL, Python and Node installed directly. See **[docs/local-without-docker.md](docs/local-without-docker.md)**.
- **With Docker:** see **[docs/windows-setup.md](docs/windows-setup.md)**, summarised below.

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
# Without Docker: see docs/local-without-docker.md, section 7
cd frontend; npx playwright install chromium; $env:E2E_BASE_URL="http://localhost:5173"; npx playwright test
```

## Documentation

| Document | Contents |
| --- | --- |
| [docs/local-without-docker.md](docs/local-without-docker.md) | Running on Windows with PowerShell, no Docker |
| [docs/windows-setup.md](docs/windows-setup.md) | Running on Windows with Docker |
| [docs/timetable-data.md](docs/timetable-data.md) | Timetable sources, licences, the import process, Google Maps and IRCTC |
| [docs/architecture.md](docs/architecture.md) | Components, modules, data flow, motion architecture |
| [docs/api.md](docs/api.md) | Endpoint reference (the live OpenAPI docs are authoritative) |
| [docs/adr/0001-phase-1-decisions.md](docs/adr/0001-phase-1-decisions.md) | The 13 approved decisions (palette and motion superseded by ADR 0002) |
| [docs/adr/0002-express-navy-and-launch-path.md](docs/adr/0002-express-navy-and-launch-path.md) | Express Navy identity, motion, maps plan, staging vs production hosting |
| [docs/deployment.md](docs/deployment.md) | Staging on free Render + Netlify, production checklist, rollback |
| [docs/brand.md](docs/brand.md) | Logo construction, logo animation and the motion system |
| [docs/attribution.md](docs/attribution.md) | Data provenance, map services, imagery, fonts, icons and libraries |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common problems and fixes |

## Not built yet

- **Real track geometry for journey lines** (lines are schematic and labelled; the public map shows real tracks via OpenRailwayMap).
- **Licensed travel photography** (landscapes are original illustrations until photos are chosen).
- **Password reset by email** (needs an email sending account in your name).
- **A current timetable.** The open datasets PAYANI can import date from 2015–2016, so they are labelled outdated. A current one would need an authorised data provider.
- **A Google-rendered map.** "Open in Google Maps" links work now. An embedded Google map needs your Google Cloud billing account and approval; see docs/timetable-data.md.
- **Live train status and seat availability** (needs an authorised data provider; PAYANI shows scheduled times only and never labels them live).
- **Real bookings and payments** (needs an IRCTC authorised-agent agreement and a payment gateway; bookings and payments are sandbox only).

## Licence

Not yet chosen. Add a licence before making the repository public.
