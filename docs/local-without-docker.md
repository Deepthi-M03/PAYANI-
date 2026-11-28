# Run PAYANI on Windows without Docker

Everything here is free. Run the commands in **PowerShell**. The steps assume the project is at `C:\PAYANI\PAYANI`; if yours is somewhere else, change that path in the `cd` commands.

## 1. Install the tools (once)

```powershell
winget install --id Python.Python.3.12 -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id PostgreSQL.PostgreSQL.16 -e
```

The PostgreSQL installer asks you to choose a password for the `postgres` superuser. Remember it.

Close PowerShell and open it again, then check the tools:

```powershell
python --version      # 3.12 or newer
node --version
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" --version
```

## 2. Create the databases (once)

```powershell
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
& $psql -U postgres -h localhost -c "CREATE ROLE payani LOGIN PASSWORD 'payani';"
& $psql -U postgres -h localhost -c "CREATE DATABASE payani OWNER payani;"
& $psql -U postgres -h localhost -c "CREATE DATABASE payani_test OWNER payani;"
```

Each command asks for the `postgres` password. The `payani` / `payani` login is for your computer only. Never use it on a server.

## 3. Create your local `.env` (once)

```powershell
cd C:\PAYANI\PAYANI
python scripts\gen_secrets.py
```

This writes `.env` next to `README.md`, with random secrets and demo passwords, and prints the demo accounts. Its database settings already point at `localhost:5432`. The backend reads this file from the project folder.

**`.env` is listed in `.gitignore`. Never upload it to GitHub.**

## 4. Backend: install, migrate and start

```powershell
cd C:\PAYANI\PAYANI\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e . pytest httpx ruff
alembic upgrade head                 # applies migrations 0001 to 0004
python -m payani.seeds.load          # synthetic timetable and demo accounts
uvicorn payani.main:app --reload --port 8000
```

If `Activate.ps1` is blocked, run this once, then activate again:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Leave this window open. The API is now at http://localhost:8000/docs.

To also run reminders and other background jobs, open a second PowerShell window:

```powershell
cd C:\PAYANI\PAYANI\backend; .\.venv\Scripts\Activate.ps1
python -m payani.worker.main
```

## 5. Frontend

Open another PowerShell window:

```powershell
cd C:\PAYANI\PAYANI\frontend
npm ci            # uses package-lock.json; use "npm install" if the lock file is missing
npm run dev
```

Open **http://localhost:5173**. Vite forwards `/api` calls to the backend on port 8000.

## 6. Import a real (historical) timetable (optional)

1. Download https://github.com/datameet/railways as a ZIP (**Code → Download ZIP**) to `C:\data\railways-master.zip`.
2. With the backend virtual environment active, run:

```powershell
cd C:\PAYANI\PAYANI\backend
python -m payani.modules.timetable.cli validate --source datameet-railways --path C:\data\railways-master.zip
python -m payani.modules.timetable.cli import --source datameet-railways --path C:\data\railways-master.zip --retrieved-on 2026-11-27 --confirm-licence
```

Use the date you actually downloaded the file for `--retrieved-on`.

Search then uses that timetable. It is labelled **Scheduled** and shows an **outdated** warning, because the data is from 2016. You can also import from **Administration → Timetable** while signed in as `superadmin@example.com`.

To go back to the simulated catalogue:

```powershell
python -m payani.modules.timetable.cli withdraw
```

[timetable-data.md](timetable-data.md) explains the sources, the checks and the data.gov.in option.

## 7. Run the checks

Backend (virtual environment active, in `backend`):

```powershell
$env:TEST_DATABASE_URL = "postgresql+psycopg://payani:payani@localhost:5432/payani_test"
pytest -q
ruff check .
alembic check
```

Frontend (in `frontend`):

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```
