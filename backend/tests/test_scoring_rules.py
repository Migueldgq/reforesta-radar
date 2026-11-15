"""Scoring rules added after the TS port (ADR 0032, ADR 0040), on the real titles that showed each problem."""

from datetime import date

import pytest

from app.api.board import TeamProfile
from app.http import Http
from app.models import FitAnalysis, Opportunity
from app.scoring import score as score_module
from app.scoring.rank import (
    FACILITY_WARNING,
    SUPPLY_TENDER_WARNING,
    TENDER_WARNING,
    WORKS_TENDER_WARNING,
    adjusted_fit,
    kind_ceiling,
)
from app.scoring.score import (
    LEADER_GROUPS_WARNING,
    NO_TOPIC_WARNING,
    SECTOR_ASSOCIATIONS_WARNING,
    ScoreInput,
    score_convocatoria,
)
from app.scoring.team_profile import apply_profile_all
from app.sources import bocm, boe
from app.sources.base import SourceContext, score_raw
from app.sources.memo import Memo

TODAY = date(2026, 11, 15)
NON_ECONOMIC = ["PERSONAS JURÍDICAS QUE NO DESARROLLAN ACTIVIDAD ECONÓMICA"]


def _score(titulo: str, extra: str = "", benef: list[str] | None = None) -> tuple[int, bool | None, list[str]]:
    inp = ScoreInput(titulo=titulo, organismo="Consejería", tipo_convocatoria="Concurrencia competitiva",
                     beneficiarios=benef, regiones=["ES42 - Castilla-La Mancha"], fecha_fin_solicitud="2026-12-20",
                     abierto=True, extra_text=extra)  # fmt: skip
    fit = score_convocatoria(inp, TODAY)
    return fit.score, fit.is_ong_eligible, fit.warnings


ADS = (
    "Resolución por la que se convocan las ayudas a las agrupaciones de defensa sanitaria ganaderas en CLM",
    "Bases: ayudas a las agrupaciones de defensa sanitaria ganaderas. Finalidad: Agricultura, Pesca y Alimentación.",
)


def test_livestock_health_groups_get_no_ngo_signal() -> None:
    score, eligible, warnings = _score(*ADS, benef=NON_ECONOMIC)
    assert eligible is None
    assert SECTOR_ASSOCIATIONS_WARNING in warnings
    assert not any("ONG" in r for r in score_convocatoria(
        ScoreInput(titulo=ADS[0], organismo="x", beneficiarios=NON_ECONOMIC, extra_text=ADS[1]), TODAY
    ).reasons)  # fmt: skip


def test_sector_call_that_names_ngos_keeps_the_signal() -> None:
    title = "Subvenciones a entidades sin ánimo de lucro para la conservación de razas ganaderas autóctonas"
    _, eligible, warnings = _score(title, benef=NON_ECONOMIC)
    assert eligible is True and SECTOR_ASSOCIATIONS_WARNING not in warnings


def test_leader_groups_running_costs_are_not_for_an_ngo() -> None:
    title = (
        "Convocatoria de subvenciones destinadas a la financiación de gastos de funcionamiento y animación de los "
        "Grupos de Desarrollo Rural de la provincia de Guadalajara"
    )
    score, eligible, warnings = _score(title, benef=NON_ECONOMIC)
    assert eligible is False and LEADER_GROUPS_WARNING in warnings
    assert score < 25  # below the BDNS keep threshold: it leaves the radar (it scored 62 "alto" before)
    # a call that funds projects through a LEADER group is not caught
    _, eligible, warnings = _score("Ayudas LEADER para proyectos de restauración forestal", benef=NON_ECONOMIC)
    assert LEADER_GROUPS_WARNING not in warnings


def _tender(titulo: str, score: int = 70) -> Opportunity:
    return Opportunity.model_validate({
        "id": "boe:x", "source": "boe", "sourceLabel": "BOE", "kind": "licitacion", "titulo": titulo,
        "organismo": "Ministerio para la Transición Ecológica y el Reto Demográfico", "region": "Estatal",
        "nivelAdmin": "Estatal", "url": "https://example.org/x",
        "fit": {"score": score, "tier": "alto", "workLines": ["educacion"], "outsideManualSources": False,
                "manualSourceMatch": None, "isCompetitive": True, "isOngEligible": None,
                "reasons": ["Encaje temático: Educación ambiental."], "warnings": [], "daysRemaining": 15,
                "deadlineState": "abierta"},
    })  # fmt: skip


CENEAM = (
    "Anuncio de licitación de: Organismo Autónomo Parques Nacionales. Objeto: Servicio de vigilancia de las "
    "instalaciones del Centro Nacional de Educación Ambiental (CENEAM). Expediente: 45026019."
)


def test_facility_service_tender_is_capped_off_topic() -> None:
    fit = adjusted_fit(_tender(CENEAM))
    assert (fit.score, fit.tier, fit.score_cap) == (30, "bajo", 30)
    assert FACILITY_WARNING in fit.warnings
    upkeep = CENEAM.replace("vigilancia de", "conservación y mantenimiento de")
    assert adjusted_fit(_tender(upkeep)).score == 30
    # a tender for environmental-education work itself keeps the tender cap
    work = "Objeto: Servicio de diseño y ejecución de programas de educación ambiental en parques nacionales."
    fit = adjusted_fit(_tender(work))
    assert fit.score_cap == 57 and FACILITY_WARNING not in fit.warnings


def test_supply_tender_with_its_own_topic_is_not_a_facility_tender() -> None:
    # ADR 0042: «suministro» alone used to cap any tender at 30 with "el tema sale del nombre del centro"
    plants = "Anuncio de licitación de: Ayuntamiento. Objeto: Suministro de planta forestal para reforestación."
    fit = adjusted_fit(_tender(plants))
    assert (fit.score, fit.score_cap) == (57, 57) and FACILITY_WARNING not in fit.warnings
    # the topic in the object still counts when the contract also names a centre
    nursery = "Objeto: Suministro de planta forestal autóctona para el vivero del Centro de Educación Ambiental."
    assert FACILITY_WARNING not in adjusted_fit(_tender(nursery)).warnings
    # supplies for a centre whose only topic is its name stay capped
    office = "Objeto: Suministro de material de oficina para el Centro Nacional de Educación Ambiental (CENEAM)."
    fit = adjusted_fit(_tender(office))
    assert (fit.score, fit.score_cap) == (30, 30) and FACILITY_WARNING in fit.warnings


def test_profile_bonus_never_lifts_a_call_past_its_kind_cap() -> None:
    profile = TeamProfile.model_validate({"linePriority": {"educacion": 10}})
    o = _tender(CENEAM)
    o = o.model_copy(update={"fit": adjusted_fit(o)})
    (after,), _ = apply_profile_all([o], profile)
    assert after.fit.score == 30 and after.fit.tier == "bajo"
    # a subsidy has no kind cap: the same bonus applies in full
    grant = _tender(CENEAM).model_copy(update={"kind": "subvencion"})
    (after,), _ = apply_profile_all([grant], profile)
    assert after.fit.score == 80
    assert kind_ceiling(grant) is None


# ---- ADR 0040: ambiguous keywords, the organism bonus and tenders without a topic match ----

HOSPITAL = (
    "Resolución de 29 de octubre de 2026, de la Dirección-Gerencia del Hospital General Universitario “Gregorio "
    "Marañón”, por la que se dispone la publicación en el boletín y en el “perfil del contratante” en Internet de la "
    "convocatoria del contrato de: “Suministro de productos alimenticios de aves frescas, congeladas y ovoproductos "
    "para la cocina del Hospital General Universitario “Gregorio Marañón”»"
)
OUTSIDE_REASON = "No es de los organismos que ya revisáis a mano"


def _topic(titulo: str, extra: str = "") -> list[str]:
    return score_convocatoria(ScoreInput(titulo=titulo, organismo="x", extra_text=extra), TODAY).work_lines


async def test_hospital_poultry_tender_is_not_listed(monkeypatch: pytest.MonkeyPatch) -> None:
    """The owner's report, on the recorded BOCM fixture: it is fetched, then dropped with no work line and no
    positive reason (it scored 44 base / 30 shown, «Hábitat de aves», «fácil que se os pase»)."""
    from tests.test_sources_multi import NOW, fixture_transport

    now = NOW["bocm"]
    monkeypatch.setattr(score_module, "local_today", lambda: now.date())
    source = bocm.BocmSource()
    async with Http(transport=fixture_transport("bocm", [])) as http:
        result = await source.fetch(SourceContext(http=http, memo=Memo()))
    raw = next(r for r in result.items if r.id == "bocm:BOCM-20261110-53")
    assert raw.titulo == HOSPITAL
    o = score_raw(raw, now.date())
    assert not source.keep(o)
    assert o.fit.work_lines == []
    assert not any(r.startswith(("Encaje temático", OUTSIDE_REASON)) for r in o.fit.reasons)
    assert NO_TOPIC_WARNING in o.fit.warnings
    shown = adjusted_fit(o)
    assert shown.score <= 30 and shown.work_lines == []
    assert SUPPLY_TENDER_WARNING in shown.warnings and TENDER_WARNING not in shown.warnings


@pytest.mark.parametrize(
    ("noise", "genuine"),
    [
        (HOSPITAL, "Ayudas para la conservación de aves esteparias en la ZEPA de la Comunidad de Madrid"),
        (HOSPITAL, "Proyectos de mejora de humedales para las aves"),  # next to a keyword that is not ambiguous
        (
            "Subvenciones a municipios y entidades locales menores para catástrofes naturales 2026",
            "Subvenciones para fomentar actividades en el ámbito de la red de parques naturales de la Diputación",
        ),
        (
            "Misión comercial del mármol y la piedra natural a Vietnam y Tailandia",
            "Mejora de la experiencia educativa en el Aula de la Naturaleza Casa de la Pradera",
        ),
        (
            "Extracto de la resolución por la que se convocan ayudas para el ecosistema de nodos edge en España",
            "Proyectos de mejora de ecosistemas acuáticos en el río Guadarrama",
        ),
        (
            "Concesión de subvención a la Fundación Contorno Urbano para apoyar el proyecto Hábitats de sostenibilidad",
            "Actuaciones de mejora del hábitat del urogallo cantábrico",
        ),
        (
            "Subv Nom a la Plataforma del Tercer Sector campaña de sensibilización para ayudar a personas en pobreza",
            "Campaña de sensibilización sobre el cuidado de la naturaleza en los parques de la ciudad",
        ),
    ],
)
def test_ambiguous_keyword_needs_its_context(noise: str, genuine: str) -> None:
    assert _topic(noise) == []
    assert _topic(genuine) != []


def test_qualifier_in_the_purpose_text_counts() -> None:
    assert _topic("Ayudas para aves", extra="Finalidad: recuperación de rapaces amenazadas.") == ["conservacion"]


def test_organism_bonus_only_with_a_topic_match() -> None:
    def fit(titulo: str) -> FitAnalysis:
        inp = ScoreInput(titulo=titulo, organismo="Ayuntamiento de Ejemplo", fecha_fin_solicitud="2026-12-20")
        return score_convocatoria(inp, TODAY)

    off = fit("Ayudas al sector del taxi 2026")
    assert off.outside_manual_sources  # still a fact the drawer shows, but neither a reason nor points
    assert off.reasons == ["Plazo abierto: quedan 35 días."]
    assert off.warnings == [NO_TOPIC_WARNING] and off.work_lines == []
    on = fit("Ayudas para la reforestación de montes municipales 2026")
    assert any(r.startswith(OUTSIDE_REASON) for r in on.reasons)
    assert NO_TOPIC_WARNING not in on.warnings
    # the same call minus the topic points (22 for "reforest") and minus the 4-point bonus
    assert off.score == on.score - 22 - 4


def test_tender_warning_names_the_contract() -> None:
    def warnings(objeto: str) -> list[str]:
        return adjusted_fit(_tender(f"Anuncio de licitación de: Ayuntamiento. Objeto: {objeto}")).warnings

    assert SUPPLY_TENDER_WARNING in warnings("Suministro de planta forestal autóctona para reforestación.")
    assert WORKS_TENDER_WARNING in warnings("Obras de restauración ecológica del arroyo.")
    assert TENDER_WARNING in warnings("Servicio de mantenimiento y suministro de repuestos del vivero forestal.")
    assert TENDER_WARNING in warnings("Coordinación de seguridad y salud de las obras de restauración forestal.")


def test_boe_keeps_only_calls_with_a_topic_match() -> None:
    o = _tender(CENEAM)
    assert boe.BoeSource().keep(o)
    no_topic = o.fit.model_copy(update={"work_lines": [], "score": 40})
    assert not boe.BoeSource().keep(o.model_copy(update={"fit": no_topic}))
