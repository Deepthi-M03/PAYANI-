.PHONY: help secrets up down logs seed test test-backend test-frontend lint e2e migration check-migrations reset-db

help:  ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

secrets:  ## Create .env with random secrets and demo passwords
	python3 scripts/gen_secrets.py

up:  ## Build and start db, api and web
	docker compose up --build

down:  ## Stop the stack (data is kept)
	docker compose down

logs:  ## Follow api logs
	docker compose logs -f api

seed:  ## Load demo accounts
	docker compose exec api python -m payani.seeds.load

test: test-backend test-frontend  ## Run backend and frontend tests

test-backend:  ## Pytest against the compose Postgres (uses the payani_test database)
	docker compose exec api pytest

test-frontend:  ## Vitest unit and component tests
	docker compose exec web npm test

lint:  ## Ruff, ESLint and TypeScript checks
	docker compose exec api ruff check .
	docker compose exec web npm run lint
	docker compose exec web npm run typecheck

e2e:  ## Playwright against the running stack (run on the host: needs browsers installed)
	cd frontend && npx playwright install chromium && E2E_BASE_URL=http://localhost:5173 npx playwright test

migration:  ## Create a migration: make migration m="describe change"
	docker compose exec api alembic revision --autogenerate -m "$(m)"

check-migrations:  ## Fail if models and migrations have drifted
	docker compose exec api alembic check

reset-db:  ## Delete all local data and start fresh
	docker compose down -v
