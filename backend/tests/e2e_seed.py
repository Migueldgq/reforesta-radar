"""Fixed data for the end-to-end tests (e2e/README.md). Never part of the app image; never run against real data.

    RADAR_E2E=1 python -m tests.e2e_seed        # from backend/, with DATABASE_URL of the e2e database

Empties every table (accounts included) and loads, through the same code the ingest uses (connector parsers,
scoring, app/ingest/store.py):
- BDNS calls built from the recorded details in tests/fixtures/bdns/: the four real ones, plus copies with their own
  numbers, titles and dates relative to today (open now), so the list always has open calls whatever the day;
- the previous editions of BDNS 904719 from tests/fixtures/bdns_history/ (Reforesta won 2025, 2024 and 2022);
- the company programmes of app/sources/rsc.py;
- a call the team follows that a later run no longer returns (`gone`), with its board row.
No network access. Accounts are created afterwards by the caller (e2e/global-setup.ts) through the CLI and the API.
Prints one JSON line with the ids the tests use.
"""

import asyncio
import copy
import json
import os
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import insert, text

from app.config import local_today
from app.db.session import make_engine
from app.db.tables import metadata, tracking
from app.http import Http
from app.ingest.store import SourceRun, write_history, write_ingest
from app.models import Opportunity, SourceHealth
from app.scoring import SCORING_VERSION
from app.sources import bdns
from app.sources import bdns_history as h
from app.sources.base import SourceContext, score_raw
from app.sources.memo import Memo
from app.sources.rsc import RSC_PROGRAMMES, to_raw

FX = Path(__file__).parent / "fixtures"
HISTORY_DAY = date(2026, 11, 15)  # the day tests/fixtures/bdns_history/ was recorded

WON = "904719"  # Comunidad de Madrid, proyectos ambientales: Reforesta won past editions
SEARCH = "990001"  # open, unique word «anfibios» (search, drawer, deep link, accessibility)
TRACK = "990002"  # open, changed by the tracking tests only
GONE = "990009"  # on the board, gone from the sources


def _detail(numero: str) -> dict[str, Any]:
    return json.loads((FX / "bdns" / f"detail-{numero}.json").read_text())


def _bdns(numero: str, d: dict[str, Any], now: datetime) -> Opportunity:
    row = {"numeroConvocatoria": numero, "descripcion": d["descripcion"], "fechaRecepcion": d.get("fechaRecepcion")}
    return score_raw(bdns.detail_to_raw(row, d, now), now.date())


def _open_copy(template: str, numero: str, titulo: str, today: date, days_left: int) -> dict[str, Any]:
    d = copy.deepcopy(_detail(template))
    d.update(
        descripcion=titulo,
        fechaInicioSolicitud=(today - timedelta(days=5)).isoformat(),
        fechaFinSolicitud=(today + timedelta(days=days_left)).isoformat(),
        abierto=True,
        documentos=[],
    )
    return d


def _items(now: datetime) -> list[Opportunity]:
    today = now.date()
    real = [_bdns(n, _detail(n), now) for n in (WON, "907977", "923042", "923290")]
    copies = [
        (SEARCH, _open_copy(WON, SEARCH, "Ayudas para restaurar charcas y humedales para anfibios 2027", today, 20)),
        (TRACK, _open_copy(WON, TRACK, "Subvenciones para plantar bosque autóctono en riberas 2027", today, 40)),
        (GONE, _open_copy(WON, GONE, "Convocatoria de reforestación urbana retirada 2027", today, 30)),
    ]
    return real + [_bdns(n, d, now) for n, d in copies]


def _fixture_transport() -> httpx.MockTransport:
    """The BDNS history API, answered from tests/fixtures (same mapping as tests/test_bdns_history.py)."""

    def handler(request: httpx.Request) -> httpx.Response:
        path, q = request.url.path, request.url.params
        f: Path | None = None
        if path.endswith("/organos"):
            f = FX / "bdns_history" / f"organos-{q['idAdmon']}.json"
        elif path.endswith("/convocatorias/busqueda"):
            f = FX / "bdns_history" / f"organ-calls-{q['organos']}.json"
        elif path.endswith("/convocatorias"):
            f = FX / "bdns_history" / f"detail-{q['numConv']}.json"
            f = f if f.exists() else FX / "bdns" / f"detail-{q['numConv']}.json"
        elif path.endswith("/concesiones/busqueda"):
            f = FX / "bdns_history" / f"awards-{q['numeroConvocatoria']}.json"
        return httpx.Response(200, text=f.read_text()) if f and f.exists() else httpx.Response(404)

    return httpx.MockTransport(handler)


async def _history() -> list[dict[str, Any]]:
    async with Http(transport=_fixture_transport()) as http:
        ctx = SourceContext(http=http, memo=Memo())
        organs = await h.fetch_organ_index(ctx)
        rows = await h.call_editions(ctx, WON, organs, lambda ids: h.fetch_organ_calls(ctx, ids), HISTORY_DAY)
    if not rows:
        raise SystemExit("no history rows for BDNS 904719: tests/fixtures/bdns_history changed?")
    return [h.to_db(r) for r in rows]


def _run(source: str, name: str, items: list[Opportunity], now: datetime) -> SourceRun:
    health = SourceHealth(id=source, name=name, category="E2E", status="ok", count=len(items), url="", note="{count}")
    return SourceRun(health, items, now, now, None)


async def seed() -> dict[str, Any]:
    now = datetime.now(UTC)
    items = _items(now)
    rsc = [score_raw(to_raw(r, local_today()), local_today()) for r in RSC_PROGRAMMES]
    engine = make_engine()
    try:
        tables = ", ".join(t.name for t in metadata.sorted_tables)
        async with engine.begin() as conn:
            await conn.execute(text(f"truncate {tables} restart identity cascade"))

        async def ingest(bdns_items: list[Opportunity]) -> None:
            runs = [_run("bdns", "BDNS", bdns_items, now), _run("rsc", "Empresas y fundaciones", rsc, now)]
            await write_ingest(engine, started_at=now, trigger="e2e", scoring_version=SCORING_VERSION, runs=runs,
                               memo=[], dry_run=False)  # fmt: skip

        await ingest(items)
        gone = next(o for o in items if o.id == f"bdns:{GONE}")
        async with engine.begin() as conn:
            await conn.execute(
                insert(tracking).values(
                    opportunity_id=gone.id,
                    status="estudio",
                    titulo=gone.titulo,
                    organismo=gone.organismo,
                    source=gone.source,
                    url=gone.url,
                    deadline=gone.deadline,
                )
            )
        await ingest([o for o in items if o.id != gone.id])  # a later run no longer returns it: gone
        await write_history(engine, {WON: await _history()}, [])
    finally:
        await engine.dispose()
    titles = {o.id: o.titulo for o in items}
    return {
        "won": f"bdns:{WON}",
        "search": f"bdns:{SEARCH}",
        "track": f"bdns:{TRACK}",
        "gone": f"bdns:{GONE}",
        "titles": titles,
        "rsc": [o.titulo for o in rsc],
    }


def main() -> int:
    if os.environ.get("RADAR_E2E") != "1":
        print("Refusing to run: this empties the whole database. Set RADAR_E2E=1 (e2e stack only).", file=sys.stderr)
        return 2
    print(json.dumps(asyncio.run(seed()), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
