"""Scoring rules added after the TS port (ADR 0032), on the real titles that showed each problem."""

from datetime import date

from app.api.board import TeamProfile
from app.models import Opportunity
from app.scoring.rank import FACILITY_WARNING, adjusted_fit, kind_ceiling
from app.scoring.score import (
    LEADER_GROUPS_WARNING,
    SECTOR_ASSOCIATIONS_WARNING,
    ScoreInput,
    score_convocatoria,
)
from app.scoring.team_profile import apply_profile_all

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
