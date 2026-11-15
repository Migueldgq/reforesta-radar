"""Every environment variable the backend reads is passed through docker compose and listed in .env.example, so a
setting never silently does nothing inside the stack (and an operator can find it)."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend" / "app"
COMPOSE = (ROOT / "docker-compose.yml").read_text()
ENV_EXAMPLE = (ROOT / ".env.example").read_text()

# Read by code but deliberately not operator settings in compose.
NOT_IN_COMPOSE = {
    "INGEST_TRIGGER",  # internal: the scheduler passes --trigger itself
    "RADAR_SAMPLES_DIR",  # compose mounts the samples at the default path
}
NOT_IN_ENV_EXAMPLE = {"INGEST_TRIGGER"}


def _read_by_code() -> set[str]:
    names: set[str] = set()
    for f in BACKEND.rglob("*.py"):
        names |= set(re.findall(r"""os\.(?:getenv|environ\.get)\(\s*["']([A-Z0-9_]+)["']""", f.read_text()))
        names |= set(re.findall(r"""os\.environ\[\s*["']([A-Z0-9_]+)["']""", f.read_text()))
    return names


def test_code_reads_some_variables() -> None:
    assert {"DATABASE_URL", "SMTP_STARTTLS", "RADAR_SESSION_DAYS", "HTTP_CONCURRENCY"} <= _read_by_code()


def test_every_variable_is_passed_through_compose() -> None:
    missing = sorted(v for v in _read_by_code() - NOT_IN_COMPOSE if not re.search(rf"^\s+{v}:", COMPOSE, re.M))
    assert not missing, f"read by the backend but not passed by docker-compose.yml: {missing}"


def test_every_variable_is_listed_in_env_example() -> None:
    missing = sorted(v for v in _read_by_code() - NOT_IN_ENV_EXAMPLE if not re.search(rf"^#?\s*{v}=", ENV_EXAMPLE, re.M))
    assert not missing, f"read by the backend but not listed in .env.example: {missing}"


def test_compose_passes_nothing_the_backend_ignores() -> None:
    block = COMPOSE.split("environment: &backend-env", 1)[1].split("depends_on:", 1)[0]
    passed = set(re.findall(r"^\s{4}([A-Z0-9_]+):", block, re.M))
    read_elsewhere = {"FORWARDED_ALLOW_IPS"}  # read by uvicorn itself
    unused = sorted(passed - _read_by_code() - read_elsewhere)
    assert not unused, f"passed by docker-compose.yml but read by nobody: {unused}"
