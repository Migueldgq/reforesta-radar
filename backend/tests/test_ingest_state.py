"""Ingest visibility and switching sources off, against a real Postgres (see conftest.py): `ingest.running` from the
ingest_runs records and RADAR_DISABLED_SOURCES."""

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.ingest import __main__ as ingest_main
from app.ingest.store import INTERRUPTED_RUNS_SQL, SourceRun, start_run, write_ingest
from app.models import SourceHealth
from app.sources.base import FetchResult, Source, SourceContext, score_raw
from app.sources.rsc import RSC_PROGRAMMES, to_raw


async def _ingest(engine: AsyncEngine, run_id: int | None = None) -> None:
    now = datetime.now(UTC)
    items = [score_raw(to_raw(r)) for r in RSC_PROGRAMMES]
    health = SourceHealth(id="rsc", name="RSC", category="RSC Privado", status="ok", count=len(items), url="", note="")
    runs = [SourceRun(health, items, now, now, None)]
    await write_ingest(engine, started_at=now, trigger="test", scoring_version=16, runs=runs, memo=[], dry_run=False,
                       run_id=run_id)  # fmt: skip


async def test_ingest_running_while_a_run_is_open(engine: AsyncEngine, client: httpx.AsyncClient) -> None:
    body = (await client.get("/api/public/oportunidades")).json()
    assert body["ingest"] == {"running": False, "startedAt": None}

    started = datetime.now(UTC)
    run_id = await start_run(engine, started, "test", 16)
    body = (await client.get("/api/public/oportunidades")).json()
    assert body["ingest"]["running"] is True
    assert body["ingest"]["startedAt"].startswith(started.strftime("%Y-%m-%dT%H:%M"))
    assert body["lastIngestAt"] is None  # a running run is not a finished ingest

    await _ingest(engine, run_id)  # completes the same row
    body = (await client.get("/api/public/oportunidades")).json()
    assert body["ingest"] == {"running": False, "startedAt": None}
    assert body["lastIngestAt"] is not None
    async with engine.connect() as conn:
        assert (await conn.execute(text("select count(*), min(status) from ingest_runs"))).one() == (1, "ok")


async def test_a_dead_run_does_not_stay_running(engine: AsyncEngine, client: httpx.AsyncClient) -> None:
    await start_run(engine, datetime.now(UTC) - timedelta(hours=2), "test", 16)  # killed long ago
    assert (await client.get("/api/public/oportunidades")).json()["ingest"]["running"] is False
    await start_run(engine, datetime.now(UTC), "test", 16)
    assert (await client.get("/api/public/oportunidades")).json()["ingest"]["running"] is True
    async with engine.begin() as conn:  # what the scheduler does when it starts
        await conn.execute(INTERRUPTED_RUNS_SQL)
    assert (await client.get("/api/public/oportunidades")).json()["ingest"]["running"] is False


async def test_disabled_source_is_hidden_and_listed_as_disabled(
    engine: AsyncEngine, client: httpx.AsyncClient, member: httpx.AsyncClient, patch_settings: Any
) -> None:
    await _ingest(engine)
    assert {o["source"] for o in (await client.get("/api/public/oportunidades")).json()["items"]} == {"rsc"}

    patch_settings(disabled_sources=["rsc", "dog"])
    body = (await client.get("/api/public/oportunidades")).json()
    assert body["items"] == []
    health = {s["id"]: s for s in body["sources"]}
    assert health["rsc"]["status"] == health["dog"]["status"] == "disabled"
    assert health["rsc"]["count"] == 0 and "Desactivada" in health["rsc"]["note"]
    assert health["dog"]["name"].startswith("DOG")  # never ingested: name from the registry
    fuentes = (await member.get("/api/fuentes")).json()["sources"]
    assert {s["id"] for s in fuentes if s["status"] == "disabled"} == {"rsc", "dog"}

    patch_settings(disabled_sources=[])  # kept, not dropped: back as soon as it is enabled again
    assert len((await client.get("/api/public/oportunidades")).json()["items"]) == len(RSC_PROGRAMMES)


class _Fake(Source):
    def __init__(self, sid: str) -> None:
        self.id = sid  # type: ignore[misc]
        self.name = sid  # type: ignore[misc]
        self.fetched = False

    async def fetch(self, ctx: SourceContext) -> FetchResult:
        self.fetched = True
        return FetchResult([], SourceHealth(id=self.id, name=self.id, category="x", status="ok", count=0, url="",
                                            note=""))  # fmt: skip


async def test_ingest_skips_disabled_sources_and_logs_progress(
    api_database: str, monkeypatch: pytest.MonkeyPatch, patch_settings: Any, capsys: pytest.CaptureFixture[str]
) -> None:
    fakes = {"aaa": _Fake("aaa"), "bbb": _Fake("bbb")}
    monkeypatch.setattr(ingest_main, "SOURCES", fakes)
    patch_settings(disabled_sources=["bbb"], database_url=api_database)
    assert await ingest_main.main(["--dry-run"]) == 0
    assert fakes["aaa"].fetched and not fakes["bbb"].fetched
    out = capsys.readouterr().out
    assert "desactivadas por RADAR_DISABLED_SOURCES: bbb" in out
    assert "leyendo 1 fuente…" in out
    assert "[ingest] aaa: 0 convocatorias en 0 s (ok)" in out
