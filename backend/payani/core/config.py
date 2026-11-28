"""Application settings, loaded from environment variables (and .env in development).

Secrets never have usable defaults: the app refuses to start without a JWT secret of
at least 32 characters.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), env_file_encoding="utf-8", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    database_url: str = Field(
        default="postgresql+psycopg://payani:payani@localhost:5432/payani",
        description="SQLAlchemy URL. Local default only; production must set it explicitly.",
    )

    jwt_secret: str = Field(min_length=32)
    jwt_algorithm: Literal["HS256"] = "HS256"
    access_token_ttl_minutes: int = Field(default=15, ge=1, le=60)
    refresh_token_ttl_days: int = Field(default=14, ge=1, le=90)

    # Cookies: Secure must be on in production; dev over http://localhost may turn it off.
    cookie_secure: bool = True
    refresh_cookie_name: str = "payani_refresh"
    csrf_cookie_name: str = "payani_csrf"

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    # Rate limits (requests per minute) for unauthenticated, abuse-prone endpoints.
    rate_limit_login_per_minute: int = 10
    rate_limit_register_per_minute: int = 5

    log_level: str = "INFO"

    @field_validator("cors_origins")
    @classmethod
    def no_wildcard(cls, v: list[str]) -> list[str]:
        if "*" in v:
            raise ValueError("Wildcard CORS is not allowed: requests carry credentials.")
        return v

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


def normalize_db_url(url: str) -> str:
    """Hosting platforms hand out postgres:// or postgresql:// URLs; SQLAlchemy needs the
    psycopg (v3) driver named explicitly."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


@lru_cache
def get_settings() -> Settings:
    settings = Settings()  # type: ignore[call-arg]  # values come from the environment
    if settings.is_production and not settings.cookie_secure:
        raise RuntimeError("COOKIE_SECURE must be true in production.")
    return settings
