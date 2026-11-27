"""FastAPI application factory."""

import os
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from payani.core.config import get_settings
from payani.core.errors import register_error_handlers
from payani.core.logging import RequestIdMiddleware, configure_logging
from payani.modules import health
from payani.modules.admin.router import router as admin_router
from payani.modules.book.router import router as book_router
from payani.modules.connect.router import router as connect_router
from payani.modules.identity.router import router as identity_router
from payani.modules.pulse.router import router as pulse_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    stop = None
    if os.environ.get("RUN_WORKER_IN_API", "").lower() == "true":
        from payani.worker.main import start_in_thread
        stop = start_in_thread()
    yield
    if stop is not None:
        stop.set()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="PAYANI API",
        version="1.0.0",
        description=(
            "PAYANI API: BOOK, INTELLIGENCE, PULSE, CONNECT and ADMIN. All railway, booking and "
            "payment data is synthetic or sandbox and is labelled as such in every response."
        ),
        lifespan=lifespan,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-CSRF-Token", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(RequestIdMiddleware)

    @app.middleware("http")
    async def security_headers(request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("X-Frame-Options", "DENY")
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    register_error_handlers(app)

    api = APIRouter(prefix="/api/v1")
    api.include_router(identity_router)
    api.include_router(admin_router)
    api.include_router(book_router)
    api.include_router(pulse_router)
    api.include_router(connect_router)
    app.include_router(api)
    app.include_router(health.router)
    return app


app = create_app()
