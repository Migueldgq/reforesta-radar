"""Base fit of one opportunity (port of scoreConvocatoria / scoreRsc / tierFor in src/lib/scoring.ts).

Same numbers and the same Spanish reason strings as the TypeScript. Dates are counted from local midnight
in settings.timezone, like the TS (`today.setHours(0, 0, 0, 0)` on a Madrid machine).
"""

import re
from datetime import date, datetime

from app.config import local_today, settings
from app.models import Contract, DeadlineState, FitAnalysis, OpportunityKind, Tier, WorkLine
from app.scoring.profile import DEALBREAKER_TERMS, KEYWORD_RULES, MANUAL_SOURCES, ONG_POSITIVE_TERMS
from app.scoring.text import has_term, js_round, normalize_text

DAY_S = 86400.0

LOCAL_ONLY_TERMS = (
    "ayuntamientos",
    "entidades locales",
    "municipios",
    "diputaciones",
    "corporaciones locales",
    "concellos",
    "ajuntaments",
    "entitats locals",
    "mancomunidades",
)

ENV_ORGANISM_TERMS = (
    "medio ambiente",
    "medi ambient",
    "medio natural",
    "transicion ecologica",
    "sostenibilidad",
    "biodiversidad",
    "forestal",
    "montes",
    "ingurumen",
    "accion climatica",
    "cambio climatico",
)

# "interés general/social" and "IRPF" also appear in bases of unrelated aid: only trust them in the title
_TITLE_ONLY_ONG_TERMS = frozenset({"interes general", "interes social", "irpf"})
_PERSONAS_FISICAS = re.compile("personas fisicas que desarrollan")


class ScoreInput(Contract):
    """What a connector hands to scoring. Field names match the TS ScoreInput (camelCase in JSON)."""

    titulo: str
    organismo: str
    tipo_convocatoria: str | None = None
    beneficiarios: list[str] | None = None
    regiones: list[str] | None = None
    region: str | None = None  # CCAA name, used only to detect the "Comunidad de Madrid" manual source
    presupuesto_total: float | None = None
    fecha_inicio_solicitud: str | None = None
    fecha_fin_solicitud: str | None = None
    abierto: bool | None = None
    extra_text: str | None = None  # purpose / description text, used for topic matching
    kind: OpportunityKind | None = None


def tier_for(score: int) -> Tier:
    return "alto" if score >= 60 else "medio" if score >= 40 else "bajo"


def _midnight(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=settings.tz)


def _parse_date(s: str | None) -> datetime | None:
    """Like the TS parseDate: "YYYY-MM-DD" is local midnight; other ISO strings parse as given."""
    if not s:
        return None
    try:
        if len(s) == 10:
            return _midnight(date.fromisoformat(s))
        d = datetime.fromisoformat(s)
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=settings.tz)


def score_convocatoria(inp: ScoreInput, today: date | None = None) -> FitAnalysis:
    topic_text = normalize_text(f"{inp.titulo} {inp.extra_text or ''}")
    title_norm = normalize_text(inp.titulo)
    organo_norm = normalize_text(inp.organismo)
    tipo_norm = normalize_text(inp.tipo_convocatoria or "")
    benef_text = normalize_text(" | ".join(inp.beneficiarios or []))

    raw: float = 20
    matched_lines: dict[WorkLine, None] = {}
    reasons: list[str] = []
    warnings: list[str] = []

    # 1. Topic fit (title + purpose text; never the organism name)
    matched_labels: dict[str, None] = {}
    topic: float = 0
    for group in KEYWORD_RULES:
        for kw in group.keywords:
            if has_term(topic_text, kw.term):
                # title hits weigh fully; purpose-only hits weigh half
                topic += kw.weight if has_term(title_norm, kw.term) else kw.weight / 2
                matched_lines[group.line] = None
                matched_labels[kw.label] = None
    raw += min(topic, 42)
    if matched_labels:
        reasons.append(f"Encaje temático: {', '.join(list(matched_labels)[:4])}.")
    if any(t in organo_norm for t in ENV_ORGANISM_TERMS):
        raw += 4

    # 2. Dealbreakers (each warning counted once)
    deal_text = f"{title_norm} {tipo_norm}"
    hard_block = False
    for db in DEALBREAKER_TERMS:
        if has_term(deal_text, db.term) and db.warning not in warnings:
            raw -= db.penalty
            warnings.append(db.warning)
            if db.penalty >= 40:
                hard_block = True

    # 3. Competitive vs direct / nominative
    is_direct = (
        "directa" in tipo_norm
        or "nominativa" in tipo_norm
        or has_term(title_norm, "nominativa")
        or has_term(title_norm, "subv.nom")
        or has_term(title_norm, "concesion directa")
        or has_term(title_norm, "subvencion directa")
    )
    is_competitive = not is_direct and not has_term(title_norm, "convenio")
    if "concurrencia competitiva" in tipo_norm:
        raw += 12
        reasons.append("Concurrencia competitiva: cualquier entidad que cumpla requisitos puede optar.")
    elif is_direct and not any(
        w.startswith("Subvención nominativa") or w.startswith("Concesión directa") for w in warnings
    ):
        raw -= 40
        warnings.append("Concesión directa/nominativa: ya asignada a un beneficiario.")

    # 4. Eligibility for an NGO
    is_ong_eligible: bool | None = None
    ong_in_benef = any(has_term(benef_text, t) for t in ONG_POSITIVE_TERMS)
    ong_in_text = any(has_term(title_norm if t in _TITLE_ONLY_ONG_TERMS else topic_text, t) for t in ONG_POSITIVE_TERMS)
    if inp.kind == "empresa":
        is_ong_eligible = True
    elif ong_in_text:
        is_ong_eligible = True
        raw += 14
        reasons.append("Menciona expresamente entidades sin ánimo de lucro (ONG, asociaciones, fundaciones).")
    elif ong_in_benef:
        is_ong_eligible = True
        raw += 10
        reasons.append("Beneficiarios: personas jurídicas sin actividad económica (categoría donde encajan las ONG).")
    elif benef_text:
        only_business = "personas juridicas que no" not in benef_text and (
            "pyme" in benef_text or "gran empresa" in benef_text or _PERSONAS_FISICAS.search(benef_text) is not None
        )
        if only_business:
            is_ong_eligible = False
            raw -= 22
            benef = ", ".join(inp.beneficiarios or []).lower()
            warnings.append(f"Beneficiarios: {benef} — probablemente excluye ONG.")
    if any(has_term(title_norm, t) for t in LOCAL_ONLY_TERMS) and not ong_in_text:
        raw -= 18
        is_ong_eligible = None if is_ong_eligible is True and ong_in_benef else False
        warnings.append("Dirigida a entidades locales (ayuntamientos): Reforesta solo podría participar como socio.")

    # 5. Manual sources: match the ORGANISM only
    manual_source_match: str | None = None
    for src in MANUAL_SOURCES:
        if any(p in organo_norm for p in src.patterns):
            manual_source_match = src.label
            break
    if (
        manual_source_match is None
        and inp.region == "Comunidad de Madrid"
        and any(t in organo_norm for t in ENV_ORGANISM_TERMS)
        and inp.kind != "licitacion"
    ):
        manual_source_match = "Comunidad de Madrid (ambiental)"
    outside_manual_sources = manual_source_match is None
    if outside_manual_sources and inp.kind != "empresa":
        raw += 4
        reasons.append("Fuera de tus 4 fuentes habituales: no la habrías visto revisando a mano.")

    # 6. Deadline state from real dates
    today_dt = _midnight(today or local_today())
    today_ts = today_dt.timestamp()
    end = _parse_date(inp.fecha_fin_solicitud)
    start = _parse_date(inp.fecha_inicio_solicitud)
    days_remaining: int | None = None
    deadline_state: DeadlineState = "sin_fecha"

    if end:
        days_remaining = js_round((end.timestamp() - today_ts) / DAY_S)
        if days_remaining < 0:
            deadline_state = "cerrada"
        elif start and start.timestamp() > today_ts:
            deadline_state = "proxima"
        else:
            deadline_state = "abierta"
    elif start and start.timestamp() > today_ts:
        deadline_state = "proxima"
    elif inp.abierto is True:
        deadline_state = "abierta"
    elif inp.abierto is False and start and start.timestamp() <= today_ts - 45 * DAY_S:
        # started 45+ days ago, BDNS says not open and no end date: treat as closed
        deadline_state = "cerrada"

    # Closed competitive grant open to non-profits = next year's pipeline: keep its fit, small timing
    # penalty only (an open equivalent gets +10, so it always ranks above). Anything else closed sinks.
    recurring_grant = (
        inp.kind == "subvencion"
        and is_competitive
        and not hard_block
        and not is_direct
        and is_ong_eligible is not False
    )
    if deadline_state == "cerrada":
        raw += 4 if recurring_grant else -15
        if is_competitive and not hard_block:
            local_end = end.astimezone(settings.tz) if end else None
            closed_on = f"cerró el {local_end.day}/{local_end.month}/{local_end.year}" if local_end else "ya cerró"
            reasons.append(f"Convocatoria periódica: la edición actual {closed_on}; prepara la siguiente con tiempo.")
        else:
            warnings.append("Plazo cerrado.")
    elif deadline_state == "abierta":
        raw += 10
        if days_remaining is not None and days_remaining <= 7:
            plural = "" if days_remaining == 1 else "s"
            warnings.append(f"Cierra en {days_remaining} día{plural}: valorar si da tiempo.")
        else:
            reasons.append(
                f"Plazo abierto: quedan {days_remaining} días."
                if days_remaining is not None
                else "Plazo de solicitud abierto."
            )
    elif deadline_state == "proxima":
        raw += 8
        reasons.append("Abre próximamente: margen para preparar la memoria.")

    # 7. Budget
    if inp.presupuesto_total and inp.presupuesto_total >= 50000:
        raw += 3

    # 8. Caps so non-applicable items never float to the top
    score = js_round(raw)
    if not matched_labels:
        score = min(score, 35)
    if hard_block or is_direct:
        score = min(score, 25)
    if deadline_state == "cerrada" and not recurring_grant:
        score = min(score, 50)
    if is_ong_eligible is False:
        score = min(score, 45)
    score = max(0, min(100, score))

    if not reasons:
        reasons.append("Coincidencia parcial con el ámbito ambiental.")

    return FitAnalysis(
        score=score,
        tier=tier_for(score),
        work_lines=list(matched_lines),
        outside_manual_sources=outside_manual_sources,
        manual_source_match=manual_source_match,
        is_competitive=is_competitive,
        is_ong_eligible=is_ong_eligible,
        reasons=reasons,
        warnings=warnings,
        days_remaining=days_remaining,
        deadline_state=deadline_state,
    )


class FitAdjust(Contract):
    """Connector-specific tweak on top of the base fit (TS connectors mutate `fit` after scoreConvocatoria).

    Applied in this order: deadline_state, score = max(0, score + delta), score = min(score, cap),
    tier recomputed, reasons prepended, warnings appended.
    """

    deadline_state: DeadlineState | None = None
    delta: int = 0
    cap: int | None = None
    prepend_reasons: list[str] = []
    append_warnings: list[str] = []


def apply_adjust(fit: FitAnalysis, adj: FitAdjust | None) -> FitAnalysis:
    if adj is None:
        return fit
    score = max(0, fit.score + adj.delta)
    if adj.cap is not None:
        score = min(score, adj.cap)
    return fit.model_copy(
        update={
            "deadline_state": adj.deadline_state or fit.deadline_state,
            "score": score,
            "tier": tier_for(score),
            "reasons": [*adj.prepend_reasons, *fit.reasons],
            "warnings": [*fit.warnings, *adj.append_warnings],
        }
    )


def score_rsc(titulo: str, focus: list[WorkLine], why_reforesta: str, today: date | None = None) -> FitAnalysis:
    """Fit for hand-curated private (RSC) programmes."""
    base = score_convocatoria(ScoreInput(titulo=titulo, organismo="", extra_text=why_reforesta, kind="empresa"), today)
    lines = list(dict.fromkeys([*focus, *base.work_lines]))
    score = max(52, min(66, 46 + len(lines) * 4 + js_round(base.score / 10)))
    return FitAnalysis(
        score=score,
        tier="medio",
        work_lines=lines,
        outside_manual_sources=True,
        manual_source_match=None,
        is_competitive=True,
        is_ong_eligible=True,
        reasons=[
            "Programa privado seleccionado a mano: financia proyectos ambientales de ONG en España.",
            "Canal RSC: hoy Reforesta no lo trabaja de forma proactiva.",
        ],
        warnings=["Sin plazo fijo publicado: confirmar calendario en la web de la entidad."],
        days_remaining=None,
        deadline_state="sin_fecha",
    )
