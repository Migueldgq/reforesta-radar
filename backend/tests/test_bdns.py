"""BDNS connector on recorded fixtures (BDNS API as of 2026-11-15), checked against the TS output in the golden."""

import json
import time
from datetime import datetime
from pathlib import Path

import httpx
import pytest

from app.config import settings
from app.http import Http
from app.scoring.rank import adjusted_fit
from app.sources import bdns
from app.sources.base import SourceContext, score_raw
from app.sources.memo import Memo

FIXTURES = Path(__file__).parent / "fixtures" / "bdns"
GOLDEN = {
    i["id"]: i for i in json.loads((Path(__file__).parent / "golden" / "oportunidades.json").read_text())["items"]
}
NOW = datetime(2026, 11, 15, 12, 0, tzinfo=settings.tz)
DETAILS = ("904719", "923290", "907977", "923042")  # 931651 has no detail fixture: its fetch fails (404)
FIELDS = ("titulo", "organismo", "region", "nivelAdmin", "kind", "sourceLabel", "publishedAt", "opensAt",
          "deadline", "deadlineText", "budget", "amountText", "tipo", "beneficiarios", "url", "basesUrl", "documents",
          "summary")  # fmt: skip


def _fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


def bdns_transport(seen: list[httpx.URL]) -> httpx.MockTransport:
    """Two searches answer ("medio ambiente", 2 pages; "entidades sin ánimo de lucro" + NGO only), 4 details."""

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        p = request.url.params
        if request.url.path.endswith("/convocatorias/busqueda"):
            assert p["fechaDesde"] == "15/11/2025" and p["pageSize"] == "50" and p["vpd"] == "GE"
            if p.get("descripcion") == "medio ambiente" and "tiposBeneficiario" not in p:
                return httpx.Response(200, text=_fixture(f"search-medio-ambiente-p{p['page']}.json"))
            if p.get("descripcion") == "entidades sin ánimo de lucro" and p.get("tiposBeneficiario") == "2":
                return httpx.Response(200, text=_fixture("search-entidades-sin-animo.json"))
        elif request.url.path.endswith("/convocatorias") and p.get("numConv") in DETAILS:
            return httpx.Response(200, text=_fixture(f"detail-{p['numConv']}.json"))
        return httpx.Response(404)

    return httpx.MockTransport(handler)


async def test_bdns_fetch_maps_and_scores_like_ts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bdns, "local_now", lambda: NOW)
    seen: list[httpx.URL] = []
    memo = Memo()
    source = bdns.BdnsSource()
    async with Http(transport=bdns_transport(seen)) as http:
        result = await source.fetch(SourceContext(http=http, memo=memo))

    # the search URL is built like the TS (encodeURIComponent) and the second page is read
    assert any("fechaDesde=15%2F11%2F2025&descripcion=medio%20ambiente&page=1" in str(u) for u in seen)
    assert result.health.status == "partial"  # 2 of 68 searches answered
    assert result.health.note == (
        "68 búsquedas (2 OK; temáticas, tercer sector e interés general, y por organismo MITECO/F. Biodiversidad/"
        "OAPN/confederaciones) desde 15/11/2025: 6 convocatorias únicas, 1 descartadas (nominativas, convenios, "
        "concesión directa), 5 con ficha completa (1 fallidas), 0 solo con datos de búsqueda; {count} relevantes."
    )
    by_id = {r.id: r for r in result.items}
    assert "bdns:941816" not in by_id  # "CONVENIO ...": dropped by the pre-score
    assert set(by_id) == {f"bdns:{n}" for n in (*DETAILS, "931651")}

    # 931651 (detail failed) becomes a search-only item; the TS golden has it as one too
    for n in (*DETAILS, "931651"):
        o = score_raw(by_id[f"bdns:{n}"], NOW.date())
        want, got = GOLDEN[o.id], o.to_json()
        for field in FIELDS:
            assert got[field] == want[field], (n, field)
        assert adjusted_fit(o).to_json() == want["fit"], n
        assert source.keep(o), n
    assert any(w.startswith("BDNS la marca abierta") for w in GOLDEN["bdns:907977"]["fit"]["warnings"])  # conflict

    # 923042 has no work line: kept only because a priority query found it and it is open to NGOs
    o = score_raw(by_id["bdns:923042"], NOW.date())
    assert not o.fit.work_lines and o.fit.is_ong_eligible is True
    assert not bdns.BdnsSource().keep(o)

    # details are memoised with the TS keys (fetch_cache shared by both backends): 24 h with an end date, else 3 h
    persisted = {m.key: m for m in memo.persisted_since(0)}
    assert set(persisted) == {f"bdns:detail:{n}" for n in DETAILS}
    ttl_h = {k: round((m.expires_at - time.time()) / 3600) for k, m in persisted.items()}
    assert ttl_h["bdns:detail:904719"] == 24  # fechaFinSolicitud 2026-06-08
    assert ttl_h["bdns:detail:907977"] == 3  # no fechaFinSolicitud
    assert persisted["bdns:detail:904719"].value == json.loads(_fixture("detail-904719.json"))  # raw detail JSON


async def test_bdns_beyond_max_enrich_are_search_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bdns, "local_now", lambda: NOW)
    monkeypatch.setattr(bdns, "MAX_ENRICH", 0)
    seen: list[httpx.URL] = []
    async with Http(transport=bdns_transport(seen)) as http:
        result = await bdns.BdnsSource().fetch(SourceContext(http=http, memo=Memo()))
    assert not any("numConv" in str(u) for u in seen)
    assert all(any(w.startswith("Ficha BDNS no cargada") for w in score_raw(r, NOW.date()).fit.warnings)
               for r in result.items)  # fmt: skip
    assert "0 con ficha completa, " in result.health.note


def test_bdns_nivel_and_pre_drop() -> None:
    assert bdns.bdns_nivel("ESTADO") == "Estatal"
    assert bdns.bdns_nivel("AUTONOMICA") == "Autonómica"
    assert bdns.bdns_nivel("LOCAL") == "Local"
    assert bdns.bdns_nivel(None) == "Otros"
    row = {"descripcion": "Subvención nominativa a la asociación X", "fechaRecepcion": "2026-11-01", "nivel1": "ESTADO"}
    assert bdns.pre_score(row, NOW) == -1
