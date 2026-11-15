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
    # every candidate that survives the pre-score gets its detail requested (no TS 230 cap); only the failed one
    # (931651) stays search-only
    assert sorted(u.params["numConv"] for u in seen if "numConv" in u.params) == sorted((*DETAILS, "931651"))
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
        assert source.keep(o) == (n != "923042"), n  # the TS kept 923042 too; see below
    assert any(w.startswith("BDNS la marca abierta") for w in GOLDEN["bdns:907977"]["fit"]["warnings"])  # conflict

    # 923042 (a social "Tándem" programme) has no work line. A priority query found it and it is open to NGOs, which
    # was enough for the TS; now every call needs a topic match, so it is dropped like any off-topic call.
    o = score_raw(by_id["bdns:923042"], NOW.date())
    assert not o.fit.work_lines and o.fit.is_ong_eligible is True and o.fit.score >= 25 and o.fit.is_competitive
    assert not source.keep(o)

    # details are memoised with the TS keys (fetch_cache shared by both backends): 24 h with an end date, else 3 h
    persisted = {m.key: m for m in memo.persisted_since(0)}
    assert set(persisted) == {f"bdns:detail:{n}" for n in DETAILS}
    ttl_h = {k: round((m.expires_at - time.time()) / 3600) for k, m in persisted.items()}
    assert ttl_h["bdns:detail:904719"] == 24  # fechaFinSolicitud 2026-06-08
    assert ttl_h["bdns:detail:907977"] == 3  # no fechaFinSolicitud
    assert persisted["bdns:detail:904719"].value == json.loads(_fixture("detail-904719.json"))  # raw detail JSON


async def test_bdns_past_safety_bound_are_search_only(monkeypatch: pytest.MonkeyPatch) -> None:
    """MAX_ENRICH is only a safety bound now (~1 000 candidates today, bound 2 000): past it, items are lite."""
    monkeypatch.setattr(bdns, "local_now", lambda: NOW)
    monkeypatch.setattr(bdns, "MAX_ENRICH", 2)
    seen: list[httpx.URL] = []
    async with Http(transport=bdns_transport(seen)) as http:
        result = await bdns.BdnsSource().fetch(SourceContext(http=http, memo=Memo()))
    assert len([u for u in seen if "numConv" in u.params]) == 2  # the 2 best by pre-score
    lite = [r for r in result.items
            if any(w.startswith("Ficha BDNS no cargada") for w in score_raw(r, NOW.date()).fit.warnings)]  # fmt: skip
    assert len(result.items) == 5 and len(lite) == 3
    assert "2 con ficha completa, " in result.health.note


def test_bdns_nivel_and_pre_drop() -> None:
    assert bdns.bdns_nivel("ESTADO") == "Estatal"
    assert bdns.bdns_nivel("AUTONOMICA") == "Autonómica"
    assert bdns.bdns_nivel("LOCAL") == "Local"
    assert bdns.bdns_nivel(None) == "Otros"
    row = {"descripcion": "Subvención nominativa a la asociación X", "fechaRecepcion": "2026-11-01", "nivel1": "ESTADO"}
    assert bdns.pre_score(row, NOW) == -1


# ---------- undated calls: estimated end ----------


def _undated(numero: str, titulo: str, published: str, text_inicio: str | None, text_fin: str | None,
             anuncios: list[str] = ()) -> bdns.RawOpportunity:  # fmt: skip
    row = {"numeroConvocatoria": numero, "descripcion": titulo, "fechaRecepcion": published, "nivel1": "LOCAL"}
    detail = {
        "descripcion": titulo,
        "organo": {"nivel1": "LOCAL", "nivel2": "PALENCIA", "nivel3": "DIPUTACIÓN PROVINCIAL DE PALENCIA"},
        "tipoConvocatoria": "Concurrencia competitiva - canónica",
        "tiposBeneficiarios": [{"descripcion": "PERSONAS JURÍDICAS QUE NO DESARROLLAN ACTIVIDAD ECONÓMICA"}],
        "fechaRecepcion": published,
        "textInicio": text_inicio,
        "textFin": text_fin,
        "abierto": False,
        "anuncios": [{"datPublicacion": a} for a in anuncios],
    }
    return bdns.detail_to_raw(row, detail, NOW)


def test_undated_call_closes_on_its_estimated_term() -> None:
    """Live case (Palencia, "Huebra 2026"): no end date, BDNS says not open, term counted from the publication."""
    raw = _undated("874408", "Bases para subvenciones de proyectos de reforestación y voluntariado ambiental",
                   "2025-12-11", "Dia después de la publicación de las bases en el BOP",
                   "Dos meses desde el día siguiente al de la publicación de la convocatoria en el BOP")  # fmt: skip
    assert raw.deadline is None  # an estimate is never shown as the deadline
    fit = score_raw(raw, NOW.date()).fit
    assert fit.deadline_state == "cerrada"
    assert "Plazo estimado: cerró hacia el 11 feb 2026 (2 meses desde la publicación)." in fit.warnings
    # still a next-edition lead: competitive, open to non-profits
    assert any(r.startswith("Convocatoria periódica: la edición actual ya cerró") for r in fit.reasons)


def test_estimate_counts_from_the_journal_publication_and_keeps_open_windows() -> None:
    # Castilla-La Mancha: BDNS registration 27/01, journal 30/01 (a later announcement only adds credit)
    raw = _undated("883531", "Resolución de 27/01/2026, expresiones de interés cambio climático", "2026-01-27",
                   "Desde el día siguiente de la publicación de la convocatoria en el Diario Oficial de C-LM",
                   "Tres meses desde la publicación de la convocatoria en el Diario Oficial de Castilla-La Mancha.",
                   ["2026-07-24", "2026-01-30"])  # fmt: skip
    assert (
        "Plazo estimado: cerró hacia el 30 abr 2026 (3 meses desde la publicación)."
        in score_raw(raw, NOW.date()).fit.warnings
    )
    recent = _undated("1", "Subvenciones para voluntariado ambiental", "2026-11-02",
                      "Desde el día siguiente a la publicación", "Un mes desde la publicación")  # fmt: skip
    assert score_raw(recent, NOW.date()).fit.deadline_state == "sin_fecha"


def test_estimated_end_reads_only_unambiguous_terms() -> None:
    from datetime import date

    from app.scoring.score import estimated_end

    pub = "2026-05-07"  # a Thursday
    assert estimated_end("VEINTE (20) DÍAS HÁBILES a contar desde el día siguiente al de la publicación", pub, None) \
        == (date(2026, 6, 4), "20 días hábiles desde la publicación")  # fmt: skip
    assert estimated_end("Quince días naturales desde la publicación", pub, None)[0] == date(2026, 5, 22)
    assert estimated_end("El termini serà de dos mesos naturals, a comptar des de l'endemà de la publicació", pub,
                         None)[0] == date(2026, 7, 7)  # fmt: skip
    assert estimated_end("día seguinte á publicación DOG · mesmo ordinal mes seguinte publicación DOG", pub, None)[0] \
        == date(2026, 6, 7)  # fmt: skip
    assert estimated_end("Des de l'endemà de la publicació · 10 Dies Hàbils", pub, "2026-10-03") == (
        date(2026, 10, 16), "10 días hábiles desde la apertura del plazo")  # fmt: skip
    assert estimated_end("Un mes desde la publicación", "2026-01-31", None)[0] == date(2026, 2, 28)
    for unclear in (
        "en un termini màxim de 20 dies des de la publicació",  # días: working or calendar?
        "Línea 1: 20 días hábiles desde la publicación; línea 2: un mes desde la publicación",  # two terms
        "Un mes después",  # from when?
        "Pendiente de definir · Hasta agotar el crédito",
        None,
    ):
        assert estimated_end(unclear, pub, None) is None, unclear


def test_old_undated_call_without_a_readable_term_is_probably_closed() -> None:
    old = _undated("869020", "Resolución de ayudas agroambientales de la PAC", "2025-11-17",
                   "Conforme establece la Orden 7/2025", "Conforme establece la Orden 7/2025")  # fmt: skip
    fit = score_raw(old, NOW.date()).fit
    assert fit.deadline_state == "cerrada"
    assert (
        "Probablemente cerrada: sin fecha de cierre y publicada hace 12 meses; confirmar en las bases." in fit.warnings
    )
    # younger than STALE_UNDATED_DAYS, or open-ended by its own wording: left as they were
    young = _undated("2", "Ayudas agroambientales", "2026-06-01", "Conforme establece la Orden", None)
    assert score_raw(young, NOW.date()).fit.deadline_state == "sin_fecha"
    endless = _undated("3", "Ayudas forestales", "2025-06-11", "Pendiente de definir", "Hasta agotar el crédito")
    assert score_raw(endless, NOW.date()).fit.deadline_state == "sin_fecha"
    yearlong = _undated("4", "Ayudas al voluntariado ambiental", "2025-06-11", "Todo el año", None)
    assert score_raw(yearlong, NOW.date()).fit.deadline_state == "sin_fecha"
