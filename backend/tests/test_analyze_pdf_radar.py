"""POST /api/analyze-pdf for a PDF of a call that is in the radar: the fit is the list's own (real Postgres)."""

import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
from sqlalchemy.ext.asyncio import AsyncEngine

from app.ingest.store import SourceRun, write_ingest
from app.models import Opportunity, SourceHealth
from app.pdf.analyzer import read_pdf
from app.pdf.download import BlockedUrl

GOLDEN = Path(__file__).parent / "golden"
SAMPLES = Path(__file__).parents[2] / "data" / "samples"


async def _store_923290(engine: AsyncEngine) -> None:
    data = json.loads((GOLDEN / "oportunidades.json").read_text())
    item = Opportunity.model_validate(next(i for i in data["items"] if i["id"] == "bdns:923290"))
    now = datetime.now(UTC)
    health = SourceHealth(id="bdns", name="BDNS", category="x", status="ok", count=1, url="", note="")
    await write_ingest(engine, started_at=now, trigger="test", scoring_version=17, dry_run=False, memo=[],
                       runs=[SourceRun(health, [item], now, now, None)])  # fmt: skip


async def _list_fit(member: httpx.AsyncClient) -> dict:
    items = (await member.get("/api/oportunidades")).json()["items"]
    return next(o["fit"] for o in items if o["id"] == "bdns:923290")


async def test_sample_of_a_radar_call_scores_like_the_list(engine: AsyncEngine, member: httpx.AsyncClient) -> None:
    await _store_923290(engine)
    got = (await member.post("/api/analyze-pdf", json={"sample": "miteco"})).json()
    assert (got["scoreSource"], got["callId"], got["notice"]) == ("radar", "bdns:923290", None)
    assert got["fit"] == await _list_fit(member)
    assert got["title"].startswith("AYUDAS CONCURRENCIA COMPETITIVA")
    assert got["organism"].startswith("DIRECCIÓN GENERAL DE SERVICIOS")


async def test_doc_id_finds_the_call(engine: AsyncEngine, member: httpx.AsyncClient, monkeypatch) -> None:  # noqa: ANN001
    from app.api import analyze_pdf as route

    await _store_923290(engine)
    # a PDF with no BDNS number in it: only the document id ties it to the call
    madrid = (SAMPLES / "comunidad-madrid-orden-1689-2026.pdf").read_bytes()

    async def download(url: str) -> bytes:
        if "idDocumento=1505061" not in url:
            raise BlockedUrl(url)
        return madrid

    monkeypatch.setattr(route, "download_pdf", download)
    route._cache.clear()
    got = (await member.post("/api/analyze-pdf", json={"docId": 1505061, "fileName": "convocatoria.pdf"})).json()
    assert got["scoreSource"] == "radar" and got["callId"] == "bdns:923290"
    assert got["fit"] == await _list_fit(member)
    assert read_pdf(madrid)[1][:40] in got["excerpt"]  # highlights still come from the PDF
