# Upload PAYANI to GitHub and deploy it (Windows)

Repository: `https://github.com/Deepthi-M03/PAYANI-`

## 1. Unzip

Right-click `PAYANI.zip` → **Extract All** → choose `C:\` as the destination. You get `C:\PAYANI`.
Check that `C:\PAYANI` contains `backend`, `frontend`, `docs`, `.github` and `README.md`.
(`.github` and `.gitignore` start with a dot; Windows shows them normally.)

### Updating an existing copy (you already have `C:\PAYANI\PAYANI` with a `.git` folder)

Use these steps to update a copy you already have:

1. Extract the new ZIP somewhere else, for example `C:\PAYANI-new`.
2. Copy the files over your project. This replaces and adds files, and leaves `.git`, `.env`, `node_modules` and `.venv` alone:

   ```powershell
   robocopy C:\PAYANI-new\PAYANI C:\PAYANI\PAYANI /E /XD node_modules .venv .git
   ```

3. One file was deleted in this update. Remove it yourself, because robocopy only adds and replaces files:

   ```powershell
   Remove-Item C:\PAYANI\PAYANI\frontend\public\icon.svg -ErrorAction SilentlyContinue
   ```

4. In GitHub Desktop, check the list of changed files, then **Commit** and **Push**. Make sure `.env` is **not** in the list.
5. Apply the new migration (`0004`) before starting the backend:

   ```powershell
   cd C:\PAYANI\PAYANI\backend; .\.venv\Scripts\Activate.ps1; alembic upgrade head
   ```

   With Docker, the API container applies it on start.

## 2. Upload to GitHub with GitHub Desktop (recommended)

The GitHub website accepts at most 100 files per upload and can skip folders whose names start
with a dot, so `.github` (the automated checks) may be lost. GitHub Desktop avoids both problems.

1. Install GitHub Desktop: open PowerShell and run `winget install --id GitHub.GitHubDesktop -e`,
   or download it from desktop.github.com.
2. Open GitHub Desktop → **File → Options → Accounts → Sign in** with the **Deepthi-M03** account.
3. **File → Clone repository → URL** → paste `https://github.com/Deepthi-M03/PAYANI-.git`
   → choose a local path such as `C:\repos\PAYANI-` → **Clone**.
4. Copy **everything inside** `C:\PAYANI` (including `.github` and `.gitignore`) into
   `C:\repos\PAYANI-`.
5. Back in GitHub Desktop, check the changed-files list. It must **not** contain `.env`,
   `node_modules` or `.venv` (the ZIP has none, and `.gitignore` blocks them).
6. Summary: `Initial import of PAYANI` → **Commit to main** → **Publish branch** / **Push origin**.

Alternative with Git in PowerShell:

```powershell
cd C:\repos
git clone https://github.com/Deepthi-M03/PAYANI-.git
Copy-Item -Recurse -Force C:\PAYANI\* C:\repos\PAYANI-\
Copy-Item -Force C:\PAYANI\.gitignore C:\repos\PAYANI-\
Copy-Item -Recurse -Force C:\PAYANI\.github C:\repos\PAYANI-\
cd C:\repos\PAYANI-
git add .
git status          # confirm no .env, node_modules or .venv
git commit -m "Initial import of PAYANI"
git push origin main
```

## 3. Watch the automated checks

On github.com open the repository → **Actions** → **CI**. Three jobs run on every push to `main`:

| Job | What it does |
| --- | --- |
| backend | Installs Python packages, lints, applies all migrations to a real PostgreSQL 16, downgrades and re-applies them, runs every backend test |
| frontend | Installs npm packages, type-checks, lints, runs unit tests, builds for production |
| e2e | Starts the API and the site and runs the browser tests (register, search, sandbox booking, payment, reminders, cancellation, refund) |

This is the **first time the full project is built and tested**, so some failures are expected.
If a job is red: open it, click the failed step, copy the error text (or take a screenshot) and
send it to me. I'll fix it and give you an updated ZIP or the changed files.

Both lock files (`backend/uv.lock`, `frontend/package-lock.json`) and the pinned
`backend/requirements.txt` are committed, so CI and the deployed API use the tested versions.
CI fails if `requirements.txt` drifts from `uv.lock`; regenerate it with
`uv export --no-dev --no-hashes --no-emit-project -o requirements.txt`.

GitHub Actions is free for public repositories and includes a monthly allowance for private ones;
one CI run takes roughly 10–15 minutes of it.

## 4. Deploy a staging site (free)

Do this only after CI is green. Full detail: [docs/deployment.md](docs/deployment.md).

1. **Render** (render.com, sign in with GitHub) → **New → Blueprint** → choose `PAYANI-`.
   Render reads `render.yaml` and shows a free web service. Create a free Neon project first (neon.com, no card) and set:
   - `DATABASE_URL` = Neon's **direct** (non-pooled) connection string,
   - `BOOTSTRAP_SUPER_ADMIN_EMAIL` = the email you will register with,
   - `CORS_ORIGINS` = leave empty for now.
   Click **Apply**. Wait until `https://<service>.onrender.com/health/ready` shows `"status": "ok"`.
2. If Render's URL is not `payani-api.onrender.com`, edit both URLs in `netlify.toml`, commit and push.
3. **Netlify** (netlify.com, sign in with GitHub) → **Add new site → Import an existing project**
   → GitHub → `PAYANI-` → **Deploy**. `netlify.toml` supplies all build settings.
4. In Render → `payani-api` → **Environment**, set `CORS_ORIGINS` to `["https://<your-site>.netlify.app"]`
   and save (Render redeploys).
5. Open the Netlify URL, register with the bootstrap email, then in Render click
   **Manual Deploy → Deploy latest commit** once. That account becomes Super Administrator.

Staging limits: the free API sleeps after 15 minutes idle (the site waits for it and shows a
starting-up banner; the first load can take about a minute) and reminders only fire while it is awake. Do not invite real users to staging.

## 5. Production

Production needs paid, always-on hosting (about USD 13–20 a month) and a domain. It is **not**
configured until you approve the cost. The checklist is in [docs/deployment.md](docs/deployment.md#production-checklist-after-budget-approval).

## Never commit

`.env`, passwords, API keys, database URLs with passwords, or any file from `node_modules`,
`.venv` or `dist`. Secrets for Render are generated by Render itself.
