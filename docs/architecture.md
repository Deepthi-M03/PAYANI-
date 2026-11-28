# Architecture

The full Phase 1 blueprint (requirements, ERD, security plan, motion plan) is in the shared PAYANI blueprint document; this file describes what the code actually does.

## Runtime

| Component | Code | Role |
| --- | --- | --- |
| Web | `frontend/` (React 19, Vite, TypeScript, Tailwind 4) | Public landing page (lazy-loaded) and the passenger/admin app |
| API | `backend/payani/main.py` (FastAPI) | REST `/api/v1`, auth, RBAC, domain services |
| Worker | `backend/payani/worker/main.py` | Promotes due reminders, delivers the outbox, runs jobs. Separate process locally; a thread in the API on free hosting (`RUN_WORKER_IN_API=true`) |
| Database | PostgreSQL 16 | All state, plus the durable job queue (`SELECT … FOR UPDATE SKIP LOCKED`) |
| Mailpit | dev only | Catches outgoing email |

Redis and Celery are not used. The queue is PostgreSQL-only (ADR 001).

## Backend layout

```text
payani/
  core/        config, db (UUIDv7, naming conventions), security, errors (RFC 9457), logging (redaction), rate limit
  domain/      framework-free core, unit-tested in isolation:
               catalog_synth (synthetic network) · routing (search, Pareto, reasons, Dijkstra oracle)
               group_batching (exact min-PNR / min-split) · booking_state (whitelisted transitions)
               forecasting (synthetic demand, leak-free features, rolling-origin evaluation)
  providers/   booking + payment sandboxes, IRCTC handoff, notification channels (email, web push, WhatsApp dry run)
  modules/     identity · book · pulse · connect · admin · jobs  (router → service → models)
  worker/      worker loop and job handlers
  seeds/       synthetic catalogue load, dev accounts, production Super Admin bootstrap
alembic/versions/  0001 foundation · 0002 book · 0003 pulse, connect, admin (42 tables)
```

## Key flows

**Booking.** `POST /bookings` re-derives the journey from its id on the server (clients cannot alter times), checks the per-PNR cap from `booking_policies`, and records `DRAFT → SEARCHED`. `POST /pay` locks the row, takes a sandbox payment, submits to the sandbox provider and records `PENDING_CONFIRMATION → CONFIRMED` (or `FAILED` with an automatic refund). Only the provider actor can confirm; the state machine refuses anything else. Every transition writes a `booking_events` row in the same transaction.

**Reminders.** Confirmation creates `journey_reminders` and one live `notification_schedules` row per reminder (partial unique index). The worker promotes due schedules into `notification_outbox` rows with a unique `dedupe_key` per channel, so duplicates are impossible even with several workers. Delivery is retried with exponential backoff and dead-lettered after 5 attempts; every attempt is logged. Cancelling a booking cancels its live schedules; changing reminders reconciles them.

**Routing.** All journeys with up to two changes (≥ 30 min per change, ≤ 12 h wait) are enumerated, filtered to the Pareto set on (departure, arrival, changes), ranked by preference, and given reasons computed from real differences. Tests check the earliest arrival against Dijkstra on a NetworkX time-expanded graph.

## Frontend layout

```text
src/
  app/            router, layouts (Marketing vs App), providers
  design-system/  tokens, Button, TextField, Alert, ConfidenceBadge, ui.tsx (states, Select, Toggle, Stat…)
  features/       auth · book · bookings · groups · intelligence · pulse · connect · admin · dashboard
  pages/landing/  public landing page (lazy chunk, no scroll effects)
  i18n/           en (complete for shell/auth), ta and hi scaffolding
```

## Motion ownership

See [brand.md](brand.md#motion-system): Motion for app page transitions, CSS for entrances and micro-interactions, native IntersectionObserver/requestAnimationFrame for scroll reveals and parallax, MapLibre for map camera moves. Nothing hijacks scrolling; all of it is off under `prefers-reduced-motion`.
