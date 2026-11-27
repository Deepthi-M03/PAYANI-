# ADR 0001 — Phase 1 decisions

> **Superseded in part (27 Nov 2026):** the palette, the cinematic direction (009) and GSAP/Lenis motion (011) are replaced by [ADR 0002](0002-express-navy-and-launch-path.md).

- **Status:** Accepted, 26 Nov 2026
- **Full blueprint:** the "PAYANI — Phase 1 Architecture & Product Blueprint" document (sections 1–12)

## Standing constraints

- Zero budget. No paid service is introduced without the owner's approval.
- Every external integration sits behind a replaceable provider adapter.
- Information is always labelled **Simulated**, **Scheduled**, **Estimated** or **Verified live**. Synthetic or sandbox data is never presented as live railway information.
- The approved palette (Sage Ivory, Champagne, Deep Charcoal, Muted Forest Sage, Deep Forest, Soft Olive, Warm White) is fixed.
- Security, tests, documentation and accessibility are never skipped.

## Decisions

| # | Decision | Consequences |
| --- | --- | --- |
| 001 | Modular monolith; PostgreSQL is the primary database and the durable notification/job queue | Redis and Celery optional (`--profile queue`), never needed for local development |
| 002 | Synthetic railway data by default; open datasets allowed | Licence and usage rights verified before import; provenance and freshness recorded (`docs/attribution.md`); synthetic never shown as live |
| 003 | Sandbox booking provider + official IRCTC handoff | No live IRCTC integration in v1 |
| 004 | In-house payment sandbox only | `PaymentProvider` abstraction ready for Razorpay later; no paid account |
| 005 | Official WhatsApp Business adapter in dry-run mode only | No real messages, Meta business account or paid messaging until separately approved |
| 006 | Super Administrator is a separate role | Only it grants roles and changes service charges, provider configuration and critical settings; all audit-logged |
| 007 | No service charge in v1 (default 0) | Pricing stays configurable; any future charge shown in full before payment |
| 008 | Free-licence stock imagery (Unsplash, Pexels or similar) | Usage conditions checked per image; credits in `docs/attribution.md` |
| 009 | Approved cinematic direction preserved | Reference-specific items (pinned journey card, loading screen and the rest of the adopt / adapt / skip table) need separate approval before Phase 8. Only the owner's two screen recordings were reviewed; the Instagram post itself could not be opened |
| 010 | Accessible status colours derived from the palette | success #2F6A4A, warning #8A5A14, error #9E3B2C, info #3E5F6B, each with a tint; always with an icon and a word |
| 011 | `motion` (formerly Framer Motion) for app UI, GSAP + ScrollTrigger for marketing scenes | One owner per element; GSAP never loaded in the app bundle |
| 012 | Free-tier deployment: Vercel or Netlify (frontend), Render (API + Postgres) if suitable | Limits and costs presented before deploying; see `docs/deployment.md` |
| 013 | English-only UI in v1 | i18n scaffolding for Tamil and Hindi; notification templates keyed for translation |

## Implementation notes from Phase 2

- Refresh tokens are scoped to `/api/v1/auth` with `SameSite=Strict`, so the frontend and API must share one origin. Development uses the Vite proxy; production will use a hosting rewrite (`docs/deployment.md`).
- Permissions are re-read from the database on every request, so a revoked role takes effect immediately rather than when the access token expires.
- The initial migration is explicit SQL. CI runs `alembic check` so the SQLAlchemy models and migrations cannot drift apart.
- Refresh-token reuse detection is strict: if two browser tabs refresh at the same instant with the same cookie, the second looks like a replay and both are signed out. Within one tab, concurrent refreshes are de-duplicated. A short grace window can be added later if this proves annoying.
- Rate limiting is in-process (correct for one API process). It must move to a shared store before running several API processes.
