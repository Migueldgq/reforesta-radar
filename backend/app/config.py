"""Settings from environment variables (see .env.example)."""

import os
from dataclasses import dataclass, field
from datetime import date, datetime
from zoneinfo import ZoneInfo


def _list(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


def _bool(value: str) -> bool:
    return value.strip().lower() in ("1", "true", "yes", "on")


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

    # --- accounts (app/auth) ---
    # Public base URL of the web app: invitation and reset links are `<public_url>/invitacion/<token>` etc.
    public_url: str = field(default_factory=lambda: os.getenv("RADAR_PUBLIC_URL", "http://localhost:3010").rstrip("/"))
    # Secure flag on the session cookie. Off by default because local runs are plain http; on behind https.
    cookie_secure: bool = field(default_factory=lambda: _bool(os.getenv("RADAR_COOKIE_SECURE", "")))
    session_days: int = field(default_factory=lambda: int(os.getenv("RADAR_SESSION_DAYS", "30")))
    # First admin on a fresh install (used only while the users table is empty); prefer `python -m app.users`.
    bootstrap_admin_email: str = field(default_factory=lambda: os.getenv("RADAR_BOOTSTRAP_ADMIN_EMAIL", ""))
    bootstrap_admin_password: str = field(default_factory=lambda: os.getenv("RADAR_BOOTSTRAP_ADMIN_PASSWORD", ""))
    # Optional e-mail (app/auth/mail.py): with SMTP_HOST set, links are e-mailed and "forgot password" is enabled.
    smtp_host: str = field(default_factory=lambda: os.getenv("SMTP_HOST", ""))
    smtp_port: int = field(default_factory=lambda: int(os.getenv("SMTP_PORT", "587")))
    smtp_user: str = field(default_factory=lambda: os.getenv("SMTP_USER", ""))
    smtp_password: str = field(default_factory=lambda: os.getenv("SMTP_PASSWORD", ""))
    smtp_from: str = field(default_factory=lambda: os.getenv("SMTP_FROM", ""))
    smtp_starttls: bool = field(default_factory=lambda: _bool(os.getenv("SMTP_STARTTLS", "true")))

    @property
    def email_enabled(self) -> bool:
        return bool(self.smtp_host and self.smtp_from)

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


settings = Settings()


def local_now() -> datetime:
    return datetime.now(settings.tz)


def local_today() -> date:
    return local_now().date()
