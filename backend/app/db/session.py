"""Async engine (asyncpg)."""

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.config import settings


def async_url(url: str) -> str:
    """Accept plain postgres:// / postgresql:// URLs and use the asyncpg driver."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+asyncpg://" + url[len(prefix) :]
    return url


def make_engine() -> AsyncEngine:
    return create_async_engine(async_url(settings.database_url), pool_size=5, pool_pre_ping=True)
