# Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `port is already allocated` for 5432, 8000 or 5173 | Another Postgres, API or dev server is running | Stop it, or change the left-hand port in `docker-compose.yml` |
| API logs `JWT_SECRET ... at least 32 characters` | `.env` missing or not generated | `python3 scripts/gen_secrets.py`, then `docker compose up` |
| API logs `Seeding skipped` | Seed passwords missing from `.env` | `make secrets && make seed` |
| `/health/ready` returns 503 | Database down or migrations not applied | `docker compose logs db`, then `docker compose exec api alembic upgrade head` |
| Signed out on every reload | Browser blocked the refresh cookie (page not opened via `http://localhost:5173`, or API called directly on :8000) | Always use the web app URL; the Vite proxy keeps the API on the same origin |
| `make check-migrations` fails | A model changed without a migration | `make migration m="describe the change"`, review the generated file, commit it |
| Permission errors writing files from the api container (Linux) | Host user id is not 1000 | `UID=$(id -u) GID=$(id -g) docker compose up` |
| Slow file watching on Windows | Project on the Windows filesystem | Clone inside WSL 2 (e.g. `~/payani`) and run Docker from there |
| Search returns nothing | Synthetic network has no route with ≤ 2 changes between those stations | Try another pair; the network covers 35 stations |
| Reminders don't appear | The worker is not running, or the reminder time hasn't come | `docker compose logs worker`; reminders fire at their scheduled time |
| No emails in Mailpit | Reminder not due yet | Emails are sent when reminders fire; check http://localhost:8025 later |
| Browser notifications button says not configured | No VAPID keys | See docs/deployment.md, "Optional channels" |
| First forecast is slow | The model trains on first use (a few seconds) | Expected; later forecasts are instant |
| Deployed site is slow to respond | Free Render service was asleep | Wait about a minute; see docs/deployment.md |
| `docker compose up` fails on Windows with WSL errors | WSL 2 not enabled | Open Docker Desktop and accept the WSL prompt, then restart |
| Start completely fresh | — | `docker compose down -v` (deletes local data), then `docker compose up --build` |
