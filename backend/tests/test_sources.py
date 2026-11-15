"""Connector tests on recorded fixtures (no network), plus the shared HTTP / memo / notice helpers."""

import json
from datetime import date, datetime
from pathlib import Path

import httpx
import pytest

from app.config import settings
from app.http import Http
from app.scoring.rank import adjusted_fit
from app.sources import boe
from app.sources.base import SourceContext, score_raw
from app.sources.memo import Memo
from app.sources.notices import deadline_from_days, extract_notice_details, parse_deadline
from app.sources.rsc import RscSource

FIXTURES = Path(__file__).parent / "fixtures"
_GOLDEN_ITEMS = json.loads((Path(__file__).parent / "golden" / "oportunidades.json").read_text())["items"]
GOLDEN = {i["id"]: i for i in _GOLDEN_ITEMS}
NOW = datetime(2026, 11, 15, 12, 0, tzinfo=settings.tz)


def boe_transport() -> httpx.MockTransport:
    """BOE as recorded on 2026-11-15: one daily summary and one notice; anything else is a 404."""
    summary = (FIXTURES / "boe" / "sumario-20261026.json").read_text()
    notice = (FIXTURES / "boe" / "BOE-B-2026-34894.html").read_text()

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.endswith("/sumario/20261026"):
            return httpx.Response(200, text=summary)
        if url.endswith("txt.php?id=BOE-B-2026-34894"):
            return httpx.Response(200, text=notice)
        return httpx.Response(404)

    return httpx.MockTransport(handler)


async def test_boe_fetch_maps_and_scores_like_ts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(boe, "local_now", lambda: NOW)
    memo = Memo()
    async with Http(transport=boe_transport()) as http:
        result = await boe.BoeSource().fetch(SourceContext(http=http, memo=memo))

    assert result.health.status == "partial"  # 1 of the 25 Monday-Saturday days is in the fixture
    assert "1 leídos, 24 con error" in result.health.note
    raw = next(r for r in result.items if r.id == "boe:BOE-B-2026-34894")
    want = GOLDEN["boe:BOE-B-2026-34894"]
    o = score_raw(raw, NOW.date())
    got = o.to_json()
    for field in ("titulo", "organismo", "kind", "sourceLabel", "publishedAt", "deadline", "deadlineText", "url",
                  "documents", "summary", "tipo"):  # fmt: skip
        assert got[field] == want[field], field
    assert adjusted_fit(o).to_json() == want["fit"]
    assert boe.BoeSource().keep(o)
    # the past day and the notice are memoised for the next run (fetch_cache)
    assert {m.key for m in memo.persisted_since(0)} == {"boe:day:20261026", "boe:notice:BOE-B-2026-34894"}


async def test_rsc_items_match_ts_output() -> None:
    result = await RscSource().fetch(SourceContext(http=None, memo=Memo()))  # type: ignore[arg-type]
    assert len(result.items) == 6
    for raw in result.items:
        o = score_raw(raw, NOW.date())
        assert o.model_copy(update={"fit": adjusted_fit(o)}).to_json() == GOLDEN[raw.id]


async def test_http_retries_5xx_then_succeeds() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.headers["user-agent"])
        return httpx.Response(503) if len(calls) == 1 else httpx.Response(200, json={"ok": True})

    async with Http(transport=httpx.MockTransport(handler)) as http:
        assert await http.json("https://example.test/x") == {"ok": True}
    assert len(calls) == 2
    assert calls[0] == settings.user_agent and "@" not in calls[0]


async def test_http_gives_up_on_404_without_retry() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(404)

    async with Http(transport=httpx.MockTransport(handler)) as http:
        assert await http.text("https://example.test/x") is None
    assert len(calls) == 1


async def test_memo_falls_back_to_expired_value() -> None:
    from app.sources.memo import PersistedMemo

    memo = Memo([PersistedMemo("k", {"v": 1}, expires_at=0)])  # expired

    async def fails() -> None:
        return None

    assert await memo.get("k", 60, fails) == {"v": 1}


def test_notice_deadline_helpers() -> None:
    assert parse_deadline("Hasta las 14:00 horas del 20 de noviembre de 2026") == "2026-11-20"
    assert parse_deadline("plazo hasta el 5/3/26") == "2026-03-05"
    assert deadline_from_days("2026-11-13", "15 días hábiles") == "2026-12-04"
    assert deadline_from_days("2026-11-13", "10 días naturales") == "2026-11-23"
    # TS quirk kept for parity: "un mes" prints local midnight in UTC (one day earlier in Madrid)
    assert deadline_from_days("2026-03-10", "plazo de 1 mes") == "2026-04-09"
    text, summary = extract_notice_details("Objeto: Servicio de conservación del parque natural. Más texto")
    assert summary == "Servicio de conservación del parque natural."
    assert text is None
    assert date.fromisoformat(deadline_from_days("2026-01-31", "1 mes") or "") == date(2026, 3, 2)
