"""Ingest write semantics against a real Postgres (skipped when none is reachable).

Uses a throwaway database `radar_test` on the compose Postgres (TEST_DATABASE_URL to override).
"""

import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Literal

import asyncpg
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.api.state import read_sources
from app.db.tables import metadata, opportunities
from app.ingest.store import IngestResult, SourceRun, write_ingest
from app.models import Opportunity, SourceHealth
from app.sources.base import score_raw
from app.sources.rsc import RSC_PROGRAMMES, to_raw

URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://radar:radar@localhost:5440/radar_test")


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    admin_dsn = URL.replace("postgresql+asyncpg", "postgresql").rsplit("/", 1)[0] + "/radar"
    try:
        admin = await asyncpg.connect(admin_dsn, timeout=3)
    except (OSError, asyncpg.PostgresError) as e:
        pytest.skip(f"no Postgres for store tests: {e}")
    await admin.execute("drop database if exists radar_test with (force)")
    await admin.execute("create database radar_test")
    await admin.close()
    eng = create_async_engine(URL)
    async with eng.begin() as conn:
        await conn.run_sync(metadata.create_all)
    yield eng
    await eng.dispose()


def _items(n: int, titulo_suffix: str = "") -> list[Opportunity]:
    out = []
    for r in RSC_PROGRAMMES[:n]:
        o = score_raw(to_raw(r))
        out.append(o.model_copy(update={"titulo": o.titulo + titulo_suffix}))
    return out


def _run(status: Literal["ok", "partial", "error"], items: list[Opportunity]) -> SourceRun:
    now = datetime.now(UTC)
    health = SourceHealth(
        id="rsc", name="RSC", category="RSC Privado", status=status, count=len(items), url="", note="n"
    )
    return SourceRun(health, items, now, now, "boom" if status == "error" else None)


async def _ingest(engine: AsyncEngine, run: SourceRun) -> IngestResult:
    return await write_ingest(
        engine, started_at=datetime.now(UTC), trigger="test", scoring_version=10, runs=[run], memo=[], dry_run=False
    )


async def _live(engine: AsyncEngine) -> set[str]:
    async with engine.connect() as conn:
        rows = await conn.execute(select(opportunities.c.id).where(opportunities.c.gone_at.is_(None)))
        return {r.id for r in rows}


async def test_failed_or_partial_source_never_deletes_rows(engine: AsyncEngine) -> None:
    res = await _ingest(engine, _run("ok", _items(3)))
    assert vars(res.per_source["rsc"]) == {"new": 3, "changed": 0, "unchanged": 0, "gone": 0}

    res = await _ingest(engine, _run("error", []))
    assert res.status == "error"
    assert len(await _live(engine)) == 3

    res = await _ingest(engine, _run("partial", _items(1)))
    assert vars(res.per_source["rsc"]) == {"new": 0, "changed": 0, "unchanged": 1, "gone": 0}
    assert len(await _live(engine)) == 3

    # last run before this one failed but rows are live: health says "partial" with the live count
    await _ingest(engine, _run("error", []))
    async with engine.connect() as conn:
        (h,) = await read_sources(conn)
    assert (h.status, h.count) == ("partial", 3) and "la última falló (boom)" in h.note

    res = await _ingest(engine, _run("ok", _items(1, " (2027)")))
    assert vars(res.per_source["rsc"]) == {"new": 0, "changed": 1, "unchanged": 0, "gone": 2}
    assert res.changed_fields == {"titulo": 1}
    assert await _live(engine) == {f"rsc:{RSC_PROGRAMMES[0].id}"}
