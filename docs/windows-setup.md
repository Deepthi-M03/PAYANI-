# Windows setup

These steps take a fresh Windows 10 (22H2) or Windows 11 PC to a running PAYANI. Everything used is free.

## 1. Install prerequisites (once)

Open **PowerShell** (Start → type *PowerShell*). Install with `winget`, which is built into current Windows:

```powershell
winget install --id Git.Git -e
winget install --id Python.Python.3.12 -e
winget install --id Docker.DockerDesktop -e
winget install --id OpenJS.NodeJS.LTS -e      # only needed for Playwright end-to-end tests
```

Restart the PC after Docker Desktop installs. Open Docker Desktop once, accept its terms, and wait until it says **Engine running**. If it asks to enable WSL 2, accept: Docker on Windows needs it.

Check everything is available (close and reopen PowerShell first):

```powershell
git --version; python --version; docker --version; docker compose version
```

## 2. Get the code

From GitHub:

```powershell
cd $HOME
git clone https://github.com/<your-account>/payani.git
cd payani
```

Or from the ZIP: right-click `PAYANI_COMPLETE.zip` → **Extract All** → choose `C:\Users\<you>\payani`, then `cd $HOME\payani`.

> Tip: keep the folder somewhere short without spaces (for example `C:\Users\<you>\payani`). Very long paths can break `npm`.

## 3. Create your local secrets

```powershell
python scripts\gen_secrets.py
```

This writes `.env` (never committed) with a random JWT secret and random demo passwords, and prints the three demo accounts.

## 4. Start PAYANI

```powershell
docker compose up --build
```

The first build downloads images and packages and takes several minutes. When you see `Uvicorn running on http://0.0.0.0:8000` and the Vite `Local: http://localhost:5173` line, open **http://localhost:5173**.

The API container applies database migrations, loads the synthetic timetable, and creates the demo accounts automatically.

## 5. Check it works

1. Register a new account → you land on the dashboard.
2. **Search**: From *Chennai*, To *Bengaluru* → **Search** → **Select** → **Continue to review** → **Pay (sandbox)**.
3. The booking shows **Confirmed (sandbox)** with an `SBX-` reference and reminder settings.
4. Sign in as `admin@example.com` (password printed in step 3) → **Admin**.
5. Open **http://localhost:8025** to see emails the app sends (reminders are emailed when due).

## 6. Run the tests

In a second PowerShell window, in the same folder, while the stack is running:

```powershell
docker compose exec api pytest
docker compose exec web npm test
docker compose exec web npm run typecheck
docker compose exec web npm run lint
docker compose exec api ruff check .
docker compose exec api alembic check
```

End-to-end tests run on Windows itself:

```powershell
cd frontend
npm install
npx playwright install chromium
$env:E2E_BASE_URL = "http://localhost:5173"
npx playwright test
cd ..
```

## 7. Stop or reset

```powershell
docker compose down          # stop, keep data
docker compose down -v       # stop and delete all local data
```

## Without `make`

The `Makefile` is a convenience for macOS/Linux. Every command it runs is listed above, so Windows users never need `make`.
