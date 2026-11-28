# PAYANI API image. Used for local compose (with --reload) and production (without).
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir uv \
    && useradd --create-home --uid 10001 payani

WORKDIR /app
# uv.lock is committed after the first `uv lock`; copied when present for reproducible builds.
COPY pyproject.toml uv.lock* ./
RUN uv sync --locked --no-install-project --group dev

COPY . .
RUN uv sync --locked --group dev && chown -R payani:payani /app

USER payani
EXPOSE 8000
CMD ["uvicorn", "payani.main:app", "--host", "0.0.0.0", "--port", "8000"]
