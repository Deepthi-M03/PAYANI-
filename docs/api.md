# API reference

Base path `/api/v1`. The interactive OpenAPI documentation at `http://localhost:8000/docs` is generated from the code and is authoritative; this page is a map.

**Conventions**
- Auth: `Authorization: Bearer <access token>` (15 minutes). The refresh token is an httpOnly cookie scoped to `/api/v1/auth`; `/auth/refresh` and `/auth/logout` also need the `X-CSRF-Token` header (value of the `payani_csrf` cookie).
- Errors: RFC 9457 problem details (`application/problem+json`) with `code`, `title`, `detail`, `request_id`, and `errors[]` for field validation.
- Idempotency: `POST /bookings` and `POST /bookings/{id}/pay` require an `Idempotency-Key` header. Replays return the first response; a different body with the same key returns 422.
- Data labels: railway data carries `data.confidence` (`simulated`, `scheduled`, `estimated`, `verified`).

| Area | Method and path | Who | Purpose |
| --- | --- | --- | --- |
| Auth | POST `/auth/register`, `/auth/login` | public (rate-limited) | Create account / sign in; sets refresh cookie |
| Auth | POST `/auth/refresh`, `/auth/logout` | cookie + CSRF | Rotate session / end session |
| Me | GET `/me` | passenger | Profile, roles, permissions |
| Catalogue | GET `/stations?q=` | public | Autocomplete |
| Catalogue | GET `/catalog/freshness` | public | Source, snapshot date, licence |
| Catalogue | GET `/timetable/status` | public | Label (simulated/scheduled), source, licence, publication and import dates, age, outdated warning |
| Catalogue | GET `/stations/map` | public | Stations with positions plus schematic links (not track geometry) |
| Catalogue | GET `/booking-policies` | public | Per-PNR caps with source and check date |
| Journeys | POST `/journeys/search` | public | `{from_code,to_code,date,preference,max_transfers}` → ranked, explained options |
| Journeys | GET `/journeys/{id}?date=` | public | Re-derive one option (server-side, tamper-proof) |
| Groups | POST/GET `/groups`; GET/DELETE `/groups/{id}` | owner / member | Group lifecycle |
| Groups | POST `/groups/{id}/members`; DELETE `/groups/{id}/members/{mid}` | owner | Travellers |
| Groups | POST `/groups/{id}/invitations`; POST `/invitations/{token}/accept` | owner / invitee | 7-day single-use invitations |
| Groups | GET `/groups/{id}/batch-plan?quota=` | member | Fewest bookings, families kept together |
| Bookings | POST `/bookings` | passenger | Create (state SEARCHED) |
| Bookings | GET `/bookings`, `/bookings/{id}` | owner | List / detail with events, payments, refunds, allowed actions |
| Bookings | POST `/bookings/{id}/pay` | owner | Sandbox payment + provider confirmation (`simulate`: `fail`, `waitlist`, `payment_fail`) |
| Bookings | POST `/bookings/{id}/cancel` | owner | Cancel; full sandbox refund starts |
| Timetable | GET `/admin/timetable/sources` | admin | Supported datasets with their known licence and date |
| Timetable | GET `/admin/timetable/imports`, `/admin/timetable/imports/{id}` | admin | Current status, import history, full validation report |
| Timetable | POST `/admin/timetable/imports?source=&file_name=&published_on=&licence=&licence_confirmed=true&retrieved_on=` | super admin (`provider.manage`) | Upload the dataset as the raw body (.zip or .csv, up to 200 MB); validate, then switch in one transaction |
| Timetable | POST `/admin/timetable/withdraw` | super admin | Stop using the import; search returns to the simulated catalogue |
| Bookings | GET `/bookings/{id}/handoff`, `/bookings/{id}/calendar.ics` | owner | IRCTC handoff steps; calendar with alarm |
| Refunds | GET `/refunds` | passenger | Refund tracker |
| Intelligence | GET `/intelligence/routes`, `/intelligence/forecast?route=&date=`, `/intelligence/model-card` | passenger | Synthetic-data forecasting |
| Pulse | GET/PUT `/notification-preferences` | passenger | Channels, language, quiet hours |
| Pulse | POST `/consents` | passenger | `whatsapp`, `community_discovery`, `contact_share` |
| Pulse | GET `/push/public-key`; POST `/devices/webpush` | passenger | Browser push subscription |
| Pulse | GET `/notifications`; POST `/notifications/{id}/read`, `/notifications/read-all` | passenger | In-app inbox |
| Pulse | GET/PUT `/bookings/{id}/reminders` | owner | Reminder offsets and arrival alert |
| Pulse | GET `/trains/{number}/status?date=` | public | Scheduled timeline; estimated position if on time; live = unavailable |
| Pulse | POST `/internal/tick` | `X-Worker-Token` | One worker pass (external wake-up on free hosting) |
| Connect | GET `/connect/overview` | passenger | Consents, joined and joinable communities |
| Connect | POST `/connect/communities`; DELETE `/connect/communities/{id}/membership` | passenger with booking + consent | Join / leave |
| Connect | GET/POST `/connect/communities/{id}/posts` | member | Read / post (screened) |
| Connect | POST `/connect/reports`, `/connect/blocks/{user_id}` | member | Safety |
| Connect | POST/GET `/connect/contact-requests`; POST `/connect/contact-requests/{id}/respond` | member + consent | Two-sided contact sharing |
| Admin | GET `/admin/overview`, `/admin/analytics`, `/admin/notifications` | admin (`analytics.read`) | Monitoring |
| Admin | GET `/admin/users`; PUT `/admin/users/{id}/status` | admin (`user.read_all`, `user.manage`) | Accounts |
| Admin | PUT `/admin/users/{id}/roles` | super admin (`role.grant`) | Roles (audited) |
| Admin | GET `/admin/bookings`, `/admin/payments` | admin (`booking.read_all`) | Bookings, payments, refunds |
| Admin | GET `/admin/moderation`; POST `/admin/moderation/posts/{id}`, `/admin/moderation/reports/{id}` | admin (`moderation.manage`) | Moderation (audited) |
| Admin | GET `/admin/audit-logs` | admin (`audit.read`) | Append-only audit log |
| Admin | GET `/admin/providers`; POST `/admin/providers/catalog/resync` | admin / super admin (`provider.manage`) | Providers |
| Admin | GET/POST `/admin/service-charges` | admin / super admin (`service_charge.manage`) | History; new values are recorded, not applied in v1 |
| Admin | GET `/admin/settings`; PUT `/admin/settings/{key}` | admin / super admin (`system_settings.manage`) | Settings; WhatsApp cannot be switched to live |
| Ops | GET `/health/live`, `/health/ready` | public | Liveness; readiness (DB + migration) |
