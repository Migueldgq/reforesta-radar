"""Fixtures for the API tests that need Postgres (accounts, board): a throwaway database `radar_test_api` on the
compose Postgres (TEST_API_DATABASE_URL to override), built once per session with the real Alembic migrations and
emptied before every test. Skipped when no Postgres is reachable, like tests/test_store.py."""

import asyncio
import dataclasses
import os
import subprocess
import sys
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import asyncpg
import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.auth import throttle
from app.auth.accounts import create_user
from app.config import settings

API_URL = os.getenv("TEST_API_DATABASE_URL", "postgresql+asyncpg://radar:radar@localhost:5440/radar_test_api")
BACKEND = Path(__file__).resolve().parents[1]
PASSWORD = "correct horse battery"
TABLES = (
    "oauth_tokens, oauth_codes, oauth_grants, oauth_requests, oauth_clients, "
    "ingest_requests, votes, org_settings, tracking_notes, tracking, password_resets, invitations, sessions, users, "
    "opportunity_changes, opportunities, source_runs, ingest_runs, fetch_cache, bdns_editions"
)


async def _recreate() -> None:
    admin_dsn = API_URL.replace("postgresql+asyncpg", "postgresql").rsplit("/", 1)[0] + "/radar"
    admin = await asyncpg.connect(admin_dsn, timeout=3)
    try:
        await admin.execute("drop database if exists radar_test_api with (force)")
        await admin.execute("create database radar_test_api")
    finally:
        await admin.close()


@pytest.fixture(scope="session")
def api_database() -> str:
    try:
        asyncio.run(_recreate())
    except (OSError, asyncpg.PostgresError) as e:
        pytest.skip(f"no Postgres for API tests: {e}")
    env = {**os.environ, "DATABASE_URL": API_URL}
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, env=env, check=True,
                   capture_output=True)  # fmt: skip
    return API_URL


@pytest.fixture
async def engine(api_database: str) -> AsyncIterator[AsyncEngine]:
    eng = create_async_engine(api_database)
    async with eng.begin() as conn:
        await conn.execute(text(f"truncate {TABLES} restart identity cascade"))
    throttle.clear_all()
    yield eng
    await eng.dispose()


def make_client(engine: AsyncEngine, ip: str = "127.0.0.1", **headers: str) -> httpx.AsyncClient:
    from app.main import app

    app.state.engine = engine
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, client=(ip, 123)),
        base_url="http://testserver",
        headers={"X-Radar-CSRF": "1", **headers},
    )


@pytest.fixture
async def client(engine: AsyncEngine) -> AsyncIterator[httpx.AsyncClient]:
    async with make_client(engine) as c:
        yield c


async def add_user(
    engine: AsyncEngine, email: str, role: str = "member", password: str = PASSWORD, name: str = ""
) -> int:
    async with engine.begin() as conn:
        return await create_user(conn, email, name or email.split("@")[0].title(), role, password)  # type: ignore[arg-type]


async def login(c: httpx.AsyncClient, email: str, password: str = PASSWORD) -> httpx.Response:
    res = await c.post("/api/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res


@pytest.fixture
async def admin(engine: AsyncEngine) -> AsyncIterator[httpx.AsyncClient]:
    await add_user(engine, "ana@example.org", "admin")
    async with make_client(engine) as c:
        await login(c, "ana@example.org")
        yield c


@pytest.fixture
async def member(engine: AsyncEngine) -> AsyncIterator[httpx.AsyncClient]:
    await add_user(engine, "luis@example.org", "member")
    async with make_client(engine) as c:
        await login(c, "luis@example.org")
        yield c


@pytest.fixture
def patch_settings() -> Iterator[Any]:
    """`patch_settings(smtp_host=...)` on the frozen settings object, restored after the test."""
    saved = dataclasses.asdict(settings)

    def apply(**kw: Any) -> None:
        for k, v in kw.items():
            object.__setattr__(settings, k, v)

    yield apply
    for k, v in saved.items():
        object.__setattr__(settings, k, v)
