"""Connector tests on recorded fixtures (no network), plus the shared HTTP / memo / notice helpers."""

import json
from datetime import date, datetime
from pathlib import Path

import httpx
import pytest

from app.config import settings
from app.http import Http
from app.scoring.rank import FACILITY_WARNING, adjusted_fit
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
    fit = adjusted_fit(o).to_json()
    # the TS scored this CENEAM security tender 57 "medio" on the centre's name; ADR 0032 caps such tenders at 30
    assert {k: v for k, v in fit.items() if k not in ("score", "tier", "warnings", "scoreCap")} == {
        k: v for k, v in want["fit"].items() if k not in ("score", "tier", "warnings")
    }
    assert (fit["score"], fit["tier"], fit["scoreCap"]) == (30, "bajo", 30)
    assert fit["warnings"] == [want["fit"]["warnings"][0], FACILITY_WARNING, *want["fit"]["warnings"][1:]]
    assert boe.BoeSource().keep(o)
    # the past day and the notice are memoised for the next run (fetch_cache)
    assert {m.key for m in memo.persisted_since(0)} == {"boe:day:20261026", "boe:notice:BOE-B-2026-34894"}


async def test_rsc_programmes_carry_checked_facts_and_real_deadlines() -> None:
    result = await RscSource().fetch(SourceContext(http=None, memo=Memo()))  # type: ignore[arg-type]
    assert len(result.items) == 6
    by_id = {}
    for raw in result.items:
        o = score_raw(raw, NOW.date())
        fit = adjusted_fit(o)
        by_id[raw.id] = (o, fit)
        assert o.rsc is not None and o.rsc.verified_on == "2026-11-15" and o.rsc.requirements
        assert o.url.startswith("https://") and o.opens_at and o.deadline
        assert "Programa privado comprobado en la web de la entidad el 15 nov 2026." in fit.reasons
        assert set(o.rsc.limits) <= set(fit.warnings)
        assert 40 <= fit.score <= 66 and fit.tier == "medio"

    unicaja, fit = by_id["rsc:rsc-unicaja-medioambiente"]
    assert (fit.deadline_state, fit.days_remaining) == ("abierta", 19)
    assert unicaja.rsc and unicaja.rsc.territory == unicaja.region == "Andalucía o provincia de Ciudad Real"
    assert fit == unicaja.fit  # its territory is one curated limit: no second, geographic penalty
    assert sum("Andalucía" in w for w in fit.warnings) == 1
    assert {o.region for i, (o, _) in by_id.items() if i != unicaja.id} == {"Estatal"}  # the rest: all of Spain
    assert {(o.kind, o.source_label, o.nivel_admin) for o, _ in by_id.values()} == {
        ("empresa", "Programa de empresa/fundación", "Privada")
    }
    closed = [f for i, (_, f) in by_id.items() if i != "rsc:rsc-unicaja-medioambiente"]
    assert all(f.deadline_state == "cerrada" for f in closed)
    assert all(fit.score > f.score for f in closed)  # the open call ranks first

    endesa = by_id["rsc:rsc-endesa-biodiversidad"][1]
    assert endesa.score == min(f.score for _, f in by_id.values())
    assert any("auditadas" in w for w in endesa.warnings) and any("amenazadas" in w for w in endesa.warnings)
    bbva = by_id["rsc:rsc-bbva-futuro"][0]
    assert bbva.rsc and bbva.rsc.unverified and bbva.bases_url is None
    assert by_id["rsc:rsc-fbbva-premio-biodiversidad"][0].rsc.kind == "premio"  # type: ignore[union-attr]
    from app.sources.rsc import rsc_health

    health = rsc_health(NOW.date())
    assert health.status == "ok" and health.note.endswith("comprobada en la web de cada entidad el 15 nov 2026.")


def test_rsc_list_goes_stale_after_180_days() -> None:
    from datetime import date

    from app.sources.rsc import RSC_PROGRAMMES, rsc_health, to_raw

    assert rsc_health(date(2027, 5, 14)).status == "ok"  # 180 days after the check
    stale = rsc_health(date(2027, 6, 20))  # 217 days: 7 months
    assert stale.status == "partial"
    assert stale.note.startswith("Lista comprobada hace 7 meses: toca revisarla. ")
    fit = score_raw(to_raw(RSC_PROGRAMMES[0], date(2027, 6, 20)), date(2027, 6, 20)).fit
    assert fit.warnings[-1] == "Datos comprobados hace 7 meses: pueden haber cambiado; revisa la web de la entidad."
    assert fit.score == score_raw(to_raw(RSC_PROGRAMMES[0]), date(2027, 6, 20)).fit.score  # a warning, no penalty


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
