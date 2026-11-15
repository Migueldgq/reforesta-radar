"""History of BDNS calls (app/sources/bdns_history.py, app/scoring/history.py, app/ingest/history.py).

Fixtures in tests/fixtures/bdns_history/ were recorded from the BDNS API on 2026-11-15 and trimmed: organ trees cut
to a few branches, organ call lists to the related titles, details to the fields used. Award rows keep NIF, amount
and date only: every beneficiary name was replaced (some winners are natural persons).
"""

import json
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine

from app.config import settings
from app.http import Http
from app.ingest import history as ingest_history
from app.models import AwardsSummary, EditionAwards, History, HistoryEdition, Opportunity, ReforestaWin
from app.scoring.rank import adjusted_fit
from app.sources import bdns
from app.sources import bdns_history as h
from app.sources.base import SourceContext, score_raw
from app.sources.memo import Memo
from tests.test_store import engine  # noqa: F401 - pytest fixture (throwaway Postgres database, skipped if none)

FX = Path(__file__).parent / "fixtures" / "bdns_history"
FX_BDNS = Path(__file__).parent / "fixtures" / "bdns"
TODAY = date(2026, 11, 15)
NOW = datetime(2026, 11, 15, 12, 0, tzinfo=settings.tz)


def history_transport(seen: list[httpx.URL] | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request.url)
        path, q = request.url.path, request.url.params
        f: Path | None = None
        if path.endswith("/organos"):
            f = FX / f"organos-{q['idAdmon']}.json"
        elif path.endswith("/convocatorias/busqueda"):
            assert q["fechaDesde"] == "01/01/2018" and q["pageSize"] == "2000"
            f = FX / f"organ-calls-{q['organos']}.json"
        elif path.endswith("/convocatorias"):
            f = FX / f"detail-{q['numConv']}.json"
            f = f if f.exists() else FX_BDNS / f"detail-{q['numConv']}.json"
        elif path.endswith("/concesiones/busqueda"):
            f = FX / f"awards-{q['numeroConvocatoria']}.json"
        return httpx.Response(200, text=f.read_text()) if f and f.exists() else httpx.Response(404)

    return httpx.MockTransport(handler)


async def _editions(numero: str, memo: Memo | None = None) -> list[h.EditionRow] | None:
    async with Http(transport=history_transport()) as http:
        ctx = SourceContext(http=http, memo=memo or Memo())
        organs = await h.fetch_organ_index(ctx)
        return await h.call_editions(ctx, numero, organs, lambda ids: h.fetch_organ_calls(ctx, ids), TODAY)


def _listed(name: str) -> list[h.ListedCall]:
    rows = json.loads((FX / name).read_text())["content"]
    return [h.ListedCall(r["numeroConvocatoria"], r["descripcion"], r["fechaRecepcion"]) for r in rows]


# ---------- organs ----------


def test_organ_resolution() -> None:
    triples = [t for a in "CAL" for t in h.flatten_organs(json.loads((FX / f"organos-{a}.json").read_text()))]
    idx = h.organ_index(triples)
    madrid = {"nivel1": "AUTONOMICA", "nivel2": "COMUNIDAD DE MADRID"}
    assert h.resolve_organ(idx, {**madrid, "nivel3": "CONSEJERÍA DE MEDIO AMBIENTE, AGRICULTURA E INTERIOR"}) == [6451]
    # case, accents and spacing do not matter
    assert h.resolve_organ(idx, {**madrid, "nivel3": "Consejeria de familia,  juventud y asuntos sociales"}) == [302]
    # some (parent, name) pairs have 2 ids: both are used
    assert h.resolve_organ(idx, {"nivel2": "ANDALUCÍA", "nivel3": "AGENCIA ANDALUZA DE LA ENERGÍA"}) == [933, 5907]
    # local bodies: province > municipality > organ; the detail gives municipality + organ
    assert h.resolve_organ(idx, {"nivel2": "ALCALÁ DE HENARES", "nivel3": "AYUNTAMIENTO DE ALCALÁ DE HENARES"}) == [
        2433
    ]
    assert h.resolve_organ(idx, {"nivel2": "MINISTERIO PARA LA TRANSICIÓN ECOLÓGICA Y EL RETO DEMOGRÁFICO",
                                 "nivel3": "FUNDACIÓN BIODIVERSIDAD"}) == [466]  # fmt: skip
    # unknown, and OTROS (universities) without nivel3: no history
    assert h.resolve_organ(idx, {**madrid, "nivel3": "CONSEJERÍA QUE NO EXISTE"}) == []
    assert h.resolve_organ(idx, {"nivel1": "OTROS", "nivel2": "UNIVERSIDAD DE ALICANTE", "nivel3": None}) == []


# ---------- matching ----------


def test_matching_finds_the_series_and_skips_other_lines_of_the_organ() -> None:
    current = h.ListedCall("904719", "SUBVENCIÓN ENTIDADES SIN ÁNIMO DE LUCRO PROYECTOS AMBIENTALES 2026", "2026-05-11")
    organ = frozenset(h.title_tokens("COMUNIDAD DE MADRID CONSEJERÍA DE MEDIO AMBIENTE, AGRICULTURA E INTERIOR"))
    found = h.match_editions(current, organ, _listed("organ-calls-6451.json"))
    assert [(c.numero, c.published_at[:4]) for c in found] == [
        ("825309", "2025"), ("782630", "2024"), ("703977", "2023"), ("626301", "2022"),
        ("561827", "2021"), ("514232", "2020"), ("459268", "2019"), ("420964", "2018"),
    ]  # fmt: skip
    # same organ, also "entidades sin ánimo de lucro", other topic (animal protection, bullfighting): not a match
    assert not {"867151", "913208", "601080"} & {c.numero for c in found}


def test_matching_one_edition_per_year_picks_the_best_line() -> None:
    """904964 (line F1) has 2 candidates in 2025: its own line F1 (848288, J 0.71) and the sibling F2 (848289, J 0.50,
    above the threshold). One per calendar year: the best one."""
    title = "SUBVENC. 07% IRPF 2026.LÍNEA F.VOLUNTARIADO. F1.IMPULSO VOLUNTARIADO"
    current = h.ListedCall("904964", title, "2026-05-12")
    listed = _listed("organ-calls-302.json")
    mine = h.title_tokens(current.title)
    by_num = {c.numero: c for c in listed}
    assert h.jaccard(mine, h.title_tokens(by_num["848289"].title)) == 0.5
    assert round(h.jaccard(mine, h.title_tokens(by_num["848288"].title)), 2) == 0.71
    found = h.match_editions(current, frozenset(), listed)
    assert [c.numero for c in found if c.published_at.startswith("2025")] == ["848288"]
    assert len({c.published_at[:4] for c in found}) == len(found)
    # the sibling F2 line of the same year (904965) is never a previous edition: not published before
    assert "904965" not in {c.numero for c in found}


def test_amendments_are_not_editions() -> None:
    # the two doubtful links of the first live run (titles as in BDNS)
    assert h.is_amendment("Acuerdo por el que se aprueba el incremento del crédito de la convocatoria, para el año "
                          "2020, de ayudas al desarrollo rural de la isla de Menorca")  # fmt: skip
    assert h.is_amendment("ORDEN 24/3/2024 modifica orden 30/12/2024 ayudas para silvicultura productiva de coníferas")
    for title in (
        "Orden por la que se modifica la Orden de convocatoria de ayudas a entidades ambientales",
        "Modificación de la convocatoria de subvenciones a asociaciones 2025",
        "Ampliación de crédito de la convocatoria de ayudas a proyectos ambientales",
        "Corrección de errores del extracto de la convocatoria de subvenciones",
        "Rectificación de la Resolución de convocatoria de premios de medio ambiente",
        "Prórroga del plazo de presentación de solicitudes de las ayudas forestales",
        "Ampliación del plazo de solicitud de la convocatoria de voluntariado",
        "Ampliació del termini de la convocatòria de subvencions a entitats",
        "Correcció d'errades de la convocatòria d'ajuts per a la custòdia del territori",
        "Increment de crèdit de la convocatòria de subvencions mediambientals",
        "Corrección de erros da convocatoria de axudas para o voluntariado ambiental",
        "Ampliación do prazo da convocatoria de subvencións",
    ):
        assert h.is_amendment(title), title
    for title in (
        "SUBVENCIÓN ENTIDADES SIN ÁNIMO DE LUCRO PROYECTOS AMBIENTALES 2026",
        "Subvenciones para la modernización de explotaciones forestales",  # "modernización" is not "modific..."
        "Ayudas a la ampliación de espacios naturales protegidos",
    ):
        assert not h.is_amendment(title), title

    current = h.ListedCall("1", "Ayudas para silvicultura productiva de coníferas 2026", "2026-01-10")
    amended = h.ListedCall("2", "ORDEN modifica orden ayudas para silvicultura productiva de coníferas", "2025-03-01")
    real = h.ListedCall("3", "Ayudas para silvicultura productiva de coníferas 2024", "2024-01-10")
    found = h.match_editions(current, frozenset(), [amended, real])
    assert [(c.numero, c.match) for c in found] == [("3", 1.0)]


def test_sibling_calls_for_another_island_or_province_are_not_editions() -> None:
    # live case: Consell Insular de Menorca call linked to the Mallorca one of the same organ (J 0.58)
    current = h.ListedCall(
        "925589",
        "Acuerdo por el cual se aprueban las Bases de la convocatoria de ayudas para el desarrollo rural de la isla de "
        "Menorca por el periodo 2023-2027, vinculadas a proyectos relacionados con los ámbitos agrario y/o ambiental y "
        "enmarcados en la Estrategia de Desarrollo Local Participativo",
        "2026-09-01",
    )
    own = h.ListedCall("793086", "Acuerdo por el que se aprueban las Bases de la convocatoria de ayudas para el "
                       "desarrollo rural de la isla de Menorca para el año 2024, vinculadas a proyectos relacionados "
                       "con los ámbitos agrario y/o ambiental", "2024-05-02")  # fmt: skip
    sibling = h.ListedCall("578434", "Ayudas al desarrollo rural de la isla de Mallorca, vinculadas a proyectos "
                           "relacionados con los ámbitos agrario y / o ambiental y enmarcados en la Estrategia de "
                           "Desarrollo Local Participativo 2014-2020 de Mallorca", "2021-06-01")  # fmt: skip
    assert h.jaccard(h.title_tokens(current.title), h.title_tokens(sibling.title)) >= h.MIN_JACCARD
    assert [c.numero for c in h.match_editions(current, frozenset(), [own, sibling])] == ["793086"]

    assert h.title_places("Ayudas en la provincia de Alacant y en Gran Canaria") == {"alicante", "gran canaria"}
    assert h.title_places("Subvenciones a entidades de Lleida") == h.title_places("Subvencions a entitats de Lérida")
    assert h.title_places("SUBVENCIÓN ENTIDADES SIN ÁNIMO DE LUCRO PROYECTOS AMBIENTALES 2026") == frozenset()
    assert h.title_places("Ayudas a la palmera canaria") == frozenset()  # whole words only
    # a title without a place, or one naming the same place among others, still matches
    plain = h.ListedCall("2", "Ayudas al desarrollo rural, ámbitos agrario y ambiental", "2022-06-01")
    both = h.ListedCall(
        "3", "Ayudas al desarrollo rural de Menorca y Mallorca, ámbitos agrario y ambiental", "2023-06-01"
    )
    found = h.match_editions(h.ListedCall("1", "Ayudas al desarrollo rural de Menorca, ámbitos agrario y ambiental",
                                          "2025-06-01"), frozenset(), [plain, both])  # fmt: skip
    assert [c.numero for c in found] == ["3", "2"]


def test_title_tokens_drop_years_boilerplate_and_organ() -> None:
    organ = frozenset({"fundacion", "biodiversidad"})
    title = (
        "Resolución de 2025 de la Fundación Biodiversidad: convocatoria de ayudas 2025-2026 para proyectos de "
        "Educación Ambiental"
    )
    assert h.title_tokens(title, organ) == {"proyectos", "educacion", "ambiental"}


# ---------- awards ----------


def test_nif_classification() -> None:
    assert h.nif_class("G80428204") == "sinAnimo"
    assert h.nif_class("B12345678") == h.nif_class("A12345678") == "empresa"
    assert h.nif_class("P2800000J") == "ayuntamiento"
    assert h.nif_class("Q2818014I") == "publico"
    assert h.nif_class("F12345678") == "cooperativa"
    assert h.nif_class("J12345678") == "sociedadCivil"
    assert h.nif_class("R2800000A") == "religiosa"
    assert h.nif_class("V12345678") == "otra"
    for person in ("***1234**", "****5640*", "12345678Z", "X1234567L"):  # masked, DNI, NIE
        assert h.nif_class(person) == "persona"
    assert h.nif_class("") == "otra"


def test_reduce_awards_keeps_counts_only() -> None:
    rows = json.loads((FX / "awards-843149.json").read_text())["content"]
    s = h.reduce_awards(rows)
    assert s["count"] == 5 and s["byClass"] == {"persona": 4, "sinAnimo": 1}
    assert s["reforesta"] is None and s["peers"] == []
    assert "RETIRADO" not in json.dumps(s) and not any(r["beneficiario"].split()[0] in json.dumps(s) for r in rows)

    reforesta = h.reduce_awards(json.loads((FX / "awards-825309.json").read_text())["content"])
    assert reforesta["reforesta"] == 29378.15 and reforesta["peers"] == ["G28795961"]  # SEO/BirdLife


def test_awards_ttl() -> None:
    settled = {"count": 19, "last": "2025-10-01"}
    assert h.awards_ttl_days(settled, "2025-04-07", TODAY) == 90  # newest award older than 6 months
    assert h.awards_ttl_days({"count": 0, "last": None}, "2026-05-11", TODAY) == 7  # nothing yet, call < 12 months
    assert h.awards_ttl_days({"count": 0, "last": None}, "2024-05-11", TODAY) == 30
    assert h.awards_ttl_days({"count": 3, "last": "2026-10-01"}, "2026-01-11", TODAY) == 30  # still arriving


# ---------- opening and window phrasing ----------


def _ed(published: str, opened: str | None, window: str | None = None, numero: str = "1") -> h.EditionRow:
    return h.EditionRow("0", numero, "1", "t", published, opened, None, window)


def test_window_phrase() -> None:
    assert h.window_phrase("10 DÍAS HÁBILES DESDE EL INICIO DEL PLAZO DE SOLICITUD", None, None) == "10 días hábiles"
    assert h.window_phrase("QUINCE DÍAS NATURALES DESDE EL SIGUIENTE A LA PUBLICACIÓN", None, None) == (
        "15 días naturales"
    )
    assert h.window_phrase("un mes desde el día siguiente de la publicación en BOP", None, None) == "1 mes"
    assert h.window_phrase("01 Mesos", None, None) == "1 mes"
    assert h.window_phrase("20 dies hàbils", None, None) == "20 días hábiles"
    # no term stated: days between the dates; nothing usable: None
    assert h.window_phrase("18/12/2026 14:00", "2026-05-26", "2026-06-08") == "14 días naturales"
    assert h.window_phrase("NO PROCEDE", None, None) is None


def test_typical_opening_phrases() -> None:
    def text(*eds: h.EditionRow) -> str:
        t = h.typical_opening([_ed(eds[0].published_at, eds[0].opened_at, numero="0"), *eds[1:]])  # first: current
        assert t is not None
        return t.text

    assert text(_ed("2026-03-01", "2026-03-10"), _ed("2025-03-01", "2025-04-02"), _ed("2024-02-20", "2024-03-05")) == (
        "Suele abrir entre marzo y abril"
    )
    assert text(_ed("2026-07-01", "2026-07-10"), _ed("2025-07-01", "2025-07-02"), _ed("2024-07-01", "2024-07-09")) == (
        "Suele abrir en julio"
    )
    # spread over 2 months: said honestly
    assert text(_ed("2026-04-01", "2026-04-10"), _ed("2025-10-01", "2025-10-02"), _ed("2024-06-01", "2024-06-02")) == (
        "Ha abierto entre abril y octubre"
    )
    # around the year end: December to January is a 1-month spread
    t = h.typical_opening([_ed("2026-01-01", "2026-01-10", numero="0"), _ed("2025-12-20", "2025-12-22"),
                           _ed("2025-01-03", "2025-01-08")])  # fmt: skip
    assert t is not None and (t.from_, t.to, t.text) == (12, 1, "Suele abrir entre diciembre y enero")
    # >= 3 editions with a gap of >= 2 years: irregular
    t = h.typical_opening([_ed("2026-08-03", "2026-08-03", numero="0"), _ed("2025-06-30", "2025-07-02"),
                           _ed("2022-09-08", "2022-09-09")])  # fmt: skip
    assert t is not None and t.irregular and t.text == "Convocatoria irregular: no sale todos los años"
    # one previous edition: only when it opened, nothing about regularity (even 3 years apart)
    for prev in ("2025-05-02", "2023-05-02"):
        t = h.typical_opening([_ed("2026-08-03", "2026-08-03", numero="0"), _ed(prev, prev)])
        assert t is not None and not t.irregular and t.text == f"La edición anterior abrió en mayo de {prev[:4]}"
    assert h.typical_opening([_ed("2026-08-03", "2026-08-03", numero="0")]) is None


def test_typical_window_most_common_newest_on_tie() -> None:
    assert h.typical_window([_ed("2026-01-01", None, "10 días hábiles"), _ed("2025-01-01", None, "1 mes"),
                             _ed("2024-01-01", None, "1 mes")]) == "1 mes"  # fmt: skip
    assert h.typical_window([_ed("2026-01-01", None, "10 días hábiles"), _ed("2025-01-01", None, "1 mes")]) == (
        "10 días hábiles"
    )
    assert h.typical_window([_ed("2026-01-01", None)]) is None


# ---------- end to end on fixtures ----------


async def test_history_of_904719_from_fixtures() -> None:
    memo = Memo()
    rows = await _editions("904719", memo)
    assert rows is not None
    assert [(r.numero, r.opened_at, r.window) for r in rows] == [
        ("904719", "2026-05-26", "10 días hábiles"),  # current: fechaInicioSolicitud
        ("825309", "2025-04-15", "10 días hábiles"),  # past editions: journal extract date (no start date)
        ("782630", "2024-09-04", "10 días hábiles"),
        ("703977", "2023-06-27", "10 días hábiles"),
        ("626301", "2022-05-20", "10 días hábiles"),
    ]  # MAX_PREVIOUS = 4: 2021 and older are not read
    hist = h.build_history(rows)
    assert hist is not None
    assert [e.year for e in hist.editions] == [2025, 2024, 2023, 2022]
    assert hist.editions[0].url == "https://www.infosubvenciones.es/bdnstrans/GE/es/convocatoria/825309"
    assert hist.typical_window == "10 días hábiles"
    assert hist.typical_opening is not None and hist.typical_opening.text == "Ha abierto entre abril y septiembre"
    a = hist.awards
    assert a is not None
    assert (a.editions, a.total, a.non_profit, a.non_profit_share) == ([2025, 2024], 38, 38, 1.0)
    assert [(w.year, w.importe) for w in a.won_by_reforesta] == [(2025, 29378.15), (2024, 29076.85), (2022, 50532.31)]
    assert a.peers == ["SEO/BirdLife", "GREFA", "Fundación Global Nature"]

    # memoised for the next runs, with the reduced award summary only (never the raw rows)
    persisted = {m.key: m for m in memo.persisted_since(0)}
    assert {"bdns:organos:A", "bdns:organ-calls:6451", "bdns:edition:825309", "bdns:awards:825309"} <= set(persisted)
    assert "RETIRADO" not in json.dumps([m.value for m in persisted.values()], ensure_ascii=False)
    ttl_d = {k: round((m.expires_at - time.time()) / 86400) for k, m in persisted.items()}
    assert ttl_d["bdns:organos:A"] == 7 and ttl_d["bdns:organ-calls:6451"] == 7 and ttl_d["bdns:edition:825309"] == 90
    assert ttl_d["bdns:awards:782630"] == 90  # settled


async def test_no_previous_edition_or_unknown_organ_gives_no_rows() -> None:
    # 907977's organ is not in the trimmed trees: no history (not a failure)
    assert await _editions("907977") == []
    # a failed detail is a failure: None keeps the rows of an earlier run
    assert await _editions("999999") is None


# ---------- scoring ----------


def _opp(
    awards: AwardsSummary | None,
    region: str = "Comunidad de Madrid",
    nivel: str = "Autonómica",
    editions: list[HistoryEdition] | None = None,
) -> Opportunity:
    """Item with a history whose counted editions default to 2 strong matches splitting the awards."""
    raw = bdns.detail_to_raw(
        {"numeroConvocatoria": "904719", "descripcion": "x", "fechaRecepcion": "2026-05-11"},
        json.loads((FX_BDNS / "detail-904719.json").read_text()),
        NOW,
    )
    o = score_raw(raw, NOW.date()).model_copy(update={"region": region, "nivel_admin": nivel})
    if editions is None and awards is not None:
        n, np = awards.total, awards.non_profit
        editions = [_hed(2025, n - n // 2, np - np // 2, 0.9), _hed(2024, n // 2, np // 2, 0.9)]
    return o.model_copy(update={"history": History(editions=editions or [], typical_opening=None,
                                                   typical_window=None, awards=awards)})  # fmt: skip


def _hed(year: int, count: int, non_profit: int, match: float) -> HistoryEdition:
    awards = EditionAwards(count=count, non_profit=non_profit, importe=1.0)
    return HistoryEdition(year=year, numero=str(year), url="u", opened_at=None, closes_at=None, window=None,
                          match=match, awards=awards)  # fmt: skip


def _awards(total: int, non_profit: int, by_class: dict[str, int] | None = None, **kw: Any) -> AwardsSummary:
    return AwardsSummary(editions=kw.get("years", [2025, 2024]), total=total, non_profit=non_profit,
                         non_profit_share=round(non_profit / total, 2) if total else 0.0,
                         by_class=by_class or {"sinAnimo": non_profit}, won_by_reforesta=kw.get("won", []),
                         peers=kw.get("peers", []))  # fmt: skip


def test_history_signal_rules() -> None:
    base = adjusted_fit(_opp(None))
    assert base == adjusted_fit(_opp(None).model_copy(update={"history": None}))  # no awards: no signal

    won = adjusted_fit(_opp(_awards(3, 3, won=[ReforestaWin(year=2025, importe=29378.15), ReforestaWin(year=2024,
                       importe=29076.85), ReforestaWin(year=2022, importe=None)])))  # fmt: skip
    assert won.score == min(100, base.score + 8)
    assert won.reasons[0] == "Reforesta ya la ganó en 2025 (29.378 €), 2024 y 2022."  # first, before the geo reason

    peers = adjusted_fit(_opp(_awards(3, 3, peers=["SEO/BirdLife", "WWF España"])))
    assert peers.score == min(100, base.score + 3)
    assert peers.reasons[0] == "La han ganado entidades como SEO/BirdLife y WWF España."

    high = adjusted_fit(_opp(_awards(19, 19)))
    assert high.score == min(100, base.score + 6)
    assert high.reasons[0] == "En las últimas ediciones, 19 de 19 ayudas fueron a entidades sin ánimo de lucro."

    few = adjusted_fit(_opp(_awards(4, 0, {"empresa": 4})))  # under 5 awards: no share rule
    assert few.score == base.score and few.warnings == base.warnings

    low = adjusted_fit(_opp(_awards(17, 2, {"ayuntamiento": 14, "sinAnimo": 2, "empresa": 1})))
    assert low.score == base.score - 10
    assert low.warnings[-1] == (
        "Solo 2 de 17 ayudas anteriores fueron a entidades sin ánimo de lucro: la mayoría fue a ayuntamientos."
    )

    none = adjusted_fit(_opp(_awards(108, 0, {"empresa": 108})))
    assert none.score == 45 and none.tier == "medio"  # cap 45 even after the +12 Madrid bonus
    assert none.warnings[-1] == (
        "Ninguna de las 108 ayudas anteriores fue a una entidad sin ánimo de lucro (fueron a empresas)."
    )
    mixed = adjusted_fit(_opp(_awards(10, 0, {"empresa": 6, "publico": 4})))
    assert mixed.warnings[-1].endswith("(fueron sobre todo a empresas).")


def test_penalties_need_a_trustworthy_basis() -> None:
    base = adjusted_fit(_opp(None))
    companies = _awards(20, 0, {"empresa": 20}, years=[2025])
    # one weakly matched edition (Jaccard 0.5): the fact stays in history.awards, the score does not move
    weak = _opp(companies, editions=[_hed(2025, 20, 0, 0.5)])
    assert adjusted_fit(weak) == base and weak.history and weak.history.awards == companies
    # one strongly matched edition (>= 0.6): penalised
    assert adjusted_fit(_opp(companies, editions=[_hed(2025, 20, 0, 0.6)])).score == 45
    # two weak editions that agree (both none / both under 20 %): penalised
    both = _awards(20, 0, {"empresa": 20})
    assert adjusted_fit(_opp(both, editions=[_hed(2025, 10, 0, 0.5), _hed(2024, 10, 0, 0.55)])).score == 45
    low = _awards(20, 2, {"ayuntamiento": 18, "sinAnimo": 2})
    assert adjusted_fit(_opp(low, editions=[_hed(2025, 10, 1, 0.5), _hed(2024, 10, 1, 0.5)])).score == base.score - 10
    # two weak editions that disagree (0 of 10 and 3 of 10 = 15 % overall): no penalty
    mixed = _awards(20, 3, {"ayuntamiento": 17, "sinAnimo": 3})
    assert adjusted_fit(_opp(mixed, editions=[_hed(2025, 10, 0, 0.5), _hed(2024, 10, 3, 0.5)])) == base


def test_history_signal_is_bounded_by_territory_and_applied_once() -> None:
    awards = _awards(19, 19, won=[ReforestaWin(year=2025, importe=1.0)], peers=["GREFA"])
    # another region: the out-of-territory cap (50) still bounds the +17
    far = adjusted_fit(_opp(awards, region="Andalucía"))
    assert far.score <= 50
    # pure: applying it to the same stored item twice gives the same fit (never stacked)
    o = _opp(awards)
    assert adjusted_fit(o) == adjusted_fit(o) and o.fit == _opp(awards).fit


# ---------- ingest step ----------


def test_wants_history() -> None:
    o = _opp(None).model_copy(update={"history": None})
    assert o.fit.deadline_state == "cerrada" and ingest_history.wants_history(o)  # closed recurring
    assert not ingest_history.wants_history(o.model_copy(update={"source": "boe"}))
    low = o.fit.model_copy(update={"deadline_state": "abierta", "score": 10})
    assert not ingest_history.wants_history(o.model_copy(update={"fit": low}))


class _BrokenEngine:
    def begin(self) -> Any:
        raise RuntimeError("database down")


async def test_history_step_failure_never_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    async def boom(*_: Any) -> None:
        raise RuntimeError("BDNS exploded")

    monkeypatch.setattr(ingest_history, "collect", boom)
    await ingest_history.run_history(_BrokenEngine(), Memo(), [_opp(None)], 5)  # type: ignore[arg-type]


async def test_ingest_succeeds_when_history_step_fails(
    engine: AsyncEngine,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The main transaction is committed before the history step; a crash there leaves exit code 0 and the rows."""
    from app.db.tables import bdns_editions, opportunities
    from app.ingest import __main__ as ingest_main
    from app.sources.base import FetchResult, Source

    item = bdns.detail_to_raw(
        {"numeroConvocatoria": "904719", "descripcion": "x", "fechaRecepcion": "2026-05-11"},
        json.loads((FX_BDNS / "detail-904719.json").read_text()),
        NOW,
    )

    class FakeBdns(Source):
        id = "bdns"
        name = "BDNS"

        async def fetch(self, ctx: SourceContext) -> FetchResult:
            health = {"id": "bdns", "name": "BDNS", "category": "API Oficial", "status": "ok", "count": 0, "url": ""}
            return FetchResult(items=[item], health=ingest_main.SourceHealth(**health, note="{count}"))

    async def boom(*_: Any) -> None:
        raise RuntimeError("BDNS exploded")

    monkeypatch.setattr(ingest_main, "SOURCES", {"bdns": FakeBdns()})
    monkeypatch.setattr(ingest_main, "make_engine", lambda: engine)
    monkeypatch.setattr(ingest_history, "collect", boom)
    assert await ingest_main.main(["--source", "bdns"]) == 0

    from sqlalchemy.ext.asyncio import create_async_engine

    from tests.test_store import URL

    check = create_async_engine(URL)  # main() disposed the fixture engine's pool
    async with check.connect() as conn:
        assert [r.id for r in await conn.execute(select(opportunities.c.id))] == ["bdns:904719"]
        assert list(await conn.execute(select(bdns_editions))) == []
    await check.dispose()


async def test_history_rows_round_trip_and_reach_the_api_item(engine: AsyncEngine) -> None:  # noqa: F811
    from app.api.state import read_state
    from app.ingest.store import IngestResult, SourceRun, write_history, write_ingest
    from app.models import SourceHealth

    o = _opp(None).model_copy(update={"history": None})
    health = SourceHealth(id="bdns", name="BDNS", category="API Oficial", status="ok", count=1, url="", note="n")
    run = SourceRun(health, [o], NOW, NOW, None)
    res: IngestResult = await write_ingest(
        engine, started_at=NOW, trigger="test", scoring_version=13, runs=[run], memo=[], dry_run=False
    )
    assert res.status == "ok"
    rows = await _editions("904719")
    assert rows
    await write_history(engine, {"904719": [h.to_db(r) for r in rows]}, [])
    async with engine.connect() as conn:
        (item,) = (await read_state(conn)).items
    assert item.history == h.build_history(rows)
    assert item.to_json()["history"]["typicalOpening"]["from"] == 4  # camelCase JSON, "from" key
    fit = adjusted_fit(item)
    assert fit.reasons[0] == "Reforesta ya la ganó en 2025 (29.378 €), 2024 y 2022."
    assert fit.score == min(100, adjusted_fit(o).score + 8 + 3 + 6)

    # a stored call that is a previous edition of a live one is shown only inside its history
    old = o.model_copy(update={"id": "bdns:825309", "url": "https://x/825309"})
    run = SourceRun(health, [o, old], NOW, NOW, None)
    await write_ingest(engine, started_at=NOW, trigger="test", scoring_version=13, runs=[run], memo=[], dry_run=False)
    async with engine.connect() as conn:
        assert [i.id for i in (await read_state(conn)).items] == ["bdns:904719"]

    # a later run that finds no previous edition clears the rows; past editions are never opportunities
    await write_history(engine, {"904719": []}, [])
    async with engine.connect() as conn:
        state = await read_state(conn)
    assert sorted(i.id for i in state.items) == ["bdns:825309", "bdns:904719"]
    assert all(i.history is None for i in state.items)
