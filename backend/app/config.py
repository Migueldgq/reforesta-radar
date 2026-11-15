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
    # Source ids switched off without a code change (e.g. "dog,bocm"): the ingest skips them and the API hides their
    # stored calls and lists them as "disabled" (docs/mantenimiento.md). Their rows stay in the database.
    disabled_sources: list[str] = field(default_factory=lambda: _list(os.getenv("RADAR_DISABLED_SOURCES", "")))

    # --- accounts (app/auth) ---
    # Public base URL of the web app: invitation and reset links are `<public_url>/invitacion/<token>` etc.
    public_url: str = field(default_factory=lambda: os.getenv("RADAR_PUBLIC_URL", "http://localhost:3010").rstrip("/"))
    # Secure flag on the session cookie. Off by default because local runs are plain http; on behind https.
    cookie_secure: bool = field(default_factory=lambda: _bool(os.getenv("RADAR_COOKIE_SECURE", "")))
    session_days: int = field(default_factory=lambda: int(os.getenv("RADAR_SESSION_DAYS", "30")))
    # Argon2 hashes/verifications running at once (64 MiB each); the rest wait.
    argon2_concurrency: int = field(default_factory=lambda: int(os.getenv("RADAR_ARGON2_CONCURRENCY", "2")))
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

    # --- read-only MCP server at /mcp (app/mcp, docs/mcp.md) ---
    # Public tools without a token (the same data as /api/public/oportunidades). false: everything needs a token.
    mcp_public: bool = field(default_factory=lambda: _bool(os.getenv("RADAR_MCP_PUBLIC", "true")))
    # Requests per minute per client IP to /mcp without a token (with a token: unlimited, tokens are personal).
    mcp_public_rate: int = field(default_factory=lambda: int(os.getenv("RADAR_MCP_PUBLIC_RATE", "60")))
    # URL people paste into their assistant (shown in "Mi cuenta"). Default: the web origin, which proxies /mcp.
    mcp_url: str = field(default_factory=lambda: os.getenv("RADAR_MCP_URL", ""))
    # DNS-rebinding protection: Host and Origin values /mcp accepts besides the defaults (localhost, the compose
    # service name and the host of RADAR_PUBLIC_URL / RADAR_MCP_URL). Comma-separated; "host:*" = any port.
    mcp_allowed_hosts: list[str] = field(default_factory=lambda: _list(os.getenv("RADAR_MCP_ALLOWED_HOSTS", "")))
    mcp_allowed_origins: list[str] = field(default_factory=lambda: _list(os.getenv("RADAR_MCP_ALLOWED_ORIGINS", "")))
    # stdio mode (`python -m app.mcp`) only: e-mail of the active account whose team view the tools show.
    mcp_user: str = field(default_factory=lambda: os.getenv("RADAR_MCP_USER", ""))
    # Read by uvicorn itself (client IP from X-Forwarded-For); here only to know whether per-IP limits are per client.
    forwarded_allow_ips: str = field(default_factory=lambda: os.getenv("FORWARDED_ALLOW_IPS", "127.0.0.1").strip())
    # Sign-in from the assistant (OAuth 2.1, app/oauth, ADR 0035) for the team address `<RADAR_MCP_URL>/equipo`.
    # Needs an https RADAR_PUBLIC_URL (or a loopback one for local use); off when that is not the case.
    mcp_oauth: bool = field(default_factory=lambda: _bool(os.getenv("RADAR_MCP_OAUTH", "true")))

    @property
    def mcp_public_url(self) -> str:
        return (self.mcp_url or f"{self.public_url}/mcp").rstrip("/")

    @property
    def trusted_proxy(self) -> bool:
        """uvicorn takes the client IP from X-Forwarded-For (a proxy in front overwrites it): per-IP limits then mean
        one client each. With the default (127.0.0.1) every caller through the web shares the web container's IP."""
        return self.forwarded_allow_ips not in ("", "127.0.0.1")

    @property
    def mcp_team_url(self) -> str:
        """The team address: always asks the assistant to sign in (OAuth) or to send a personal token."""
        return f"{self.mcp_public_url}/equipo"

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
