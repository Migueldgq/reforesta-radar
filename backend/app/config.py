"""Settings from environment variables (see .env.example)."""

import os
from dataclasses import dataclass, field
from datetime import date, datetime
from zoneinfo import ZoneInfo


def _list(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


@dataclass(frozen=True)
class Settings:
    database_url: str = field(
        default_factory=lambda: os.getenv("DATABASE_URL", "postgresql+asyncpg://radar:radar@localhost:5440/radar")
    )
    # Scoring counts days in this zone (the TS app ran on a Madrid machine: local-midnight "today").
    timezone: str = field(default_factory=lambda: os.getenv("RADAR_TZ", "Europe/Madrid"))
    cors_origins: list[str] = field(default_factory=lambda: _list(os.getenv("CORS_ORIGINS", "http://localhost:3000")))
    # Generic client name only: no personal data or e-mail in the User-Agent.
    user_agent: str = field(
        default_factory=lambda: os.getenv("HTTP_USER_AGENT", "Mozilla/5.0 (compatible; ReforestaRadar/1.0)")
    )
    http_concurrency: int = field(default_factory=lambda: int(os.getenv("HTTP_CONCURRENCY", "8")))
    # Whole-source budget in a batch ingest run (TS scripts/ingest.ts: 8 min).
    ingest_source_timeout_s: float = field(default_factory=lambda: float(os.getenv("INGEST_SOURCE_TIMEOUT_S", "480")))
    # Budget of the BDNS history step that runs after the ingest is stored (app.ingest.history); cold start ~10-20 min.
    history_timeout_s: float = field(default_factory=lambda: float(os.getenv("HISTORY_TIMEOUT_S", "1800")))
    # Local time (RADAR_TZ) of the daily scheduled ingest (app.ingest.scheduler).
    ingest_at: str = field(default_factory=lambda: os.getenv("RADAR_INGEST_AT", "09:00"))

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


settings = Settings()


def local_now() -> datetime:
    return datetime.now(settings.tz)


def local_today() -> date:
    return local_now().date()
