"""Base fit of one opportunity (port of scoreConvocatoria / scoreRsc / tierFor in src/lib/scoring.ts).

Same numbers and the same Spanish reason strings as the TypeScript. Dates are counted from local midnight
in settings.timezone, like the TS (`today.setHours(0, 0, 0, 0)` on a Madrid machine).
"""

import re
from datetime import date, datetime, timedelta

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
# Terms that name non-profits as such. The rest of ONG_POSITIVE_TERMS ("asociaciones", "entitats"...) and the BDNS
# beneficiary category "personas jurídicas que no desarrollan actividad económica" also cover sector associations.
_EXPLICIT_NON_PROFIT = frozenset({
    "sin animo de lucro", "sin fines de lucro", "sense anim de lucre", "sen animo de lucro", "sen fins de lucro", "ong",
    "ongs", "organizaciones no gubernamentales", "entidades no lucrativas", "entidades sin animo", "tercer sector",
    "entidades de custodia",
})  # fmt: skip
# Dealbreakers that name an economic sector (livestock, farming, hunting, fishing): when one fires, an association or
# a non-economic legal person among the beneficiaries is that sector's (livestock health groups, hunters' clubs).
SECTOR_WARNINGS = frozenset({
    "Relacionada con actividad cinegética.", "Orientada al sector pesquero.", "Orientada a acuicultura.",
    "Orientada a regadíos/explotaciones agrarias.", "Orientada a explotaciones ganaderas.",
    "Orientada a explotaciones agrarias.",
})  # fmt: skip
SECTOR_ASSOCIATIONS_WARNING = (
    "Las asociaciones a las que se dirige son del propio sector (ganadero, agrario, de caza o pesca), no ONG "
    "ambientales."
)
# Running costs of the LEADER local action groups: only those groups can apply (not "solicitantes que no son grupos").
_LEADER_GROUPS = re.compile(r"grupos? de (desarrollo rural|accion local)")
_LEADER_RUNNING = re.compile(r"funcionamiento|animacion|apoyo a los grupos|gestores de la estrategia")
LEADER_GROUPS_WARNING = "Para los Grupos de Desarrollo Rural (LEADER) de la zona: solo ellos pueden pedirla."
LEADER_GROUPS_PENALTY = 30
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
    # Only for calls without an end date (BDNS): the official publication date and the term as written
    # ("Dos meses desde el día siguiente a la publicación"), to estimate whether the window is over (step 6).
    fecha_publicacion: str | None = None
    texto_plazo: str | None = None
    # fecha_fin_solicitud is an estimate (the source gives a term, not a date): reasons say so (ADR 0029).
    deadline_estimated: bool = False


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


# ---------- undated calls: is the window over? ----------

# An undated call published this long ago is probably closed: 98% of the dated competitive BDNS calls (271 of 277 in
# the Nov 2026 data) close within 270 days of their publication.
STALE_UNDATED_DAYS = 270
_NUM_WORDS = {"un": 1, "una": 1, "uno": 1, "dos": 2, "dues": 2, "dous": 2, "tres": 3, "cuatro": 4, "quatre": 4,
              "catro": 4, "cinco": 5, "cinc": 5, "seis": 6, "sis": 6, "diez": 10, "deu": 10, "quince": 15,
              "quinze": 15, "veinte": 20, "vint": 20, "treinta": 30, "trenta": 30}  # fmt: skip
# "N días hábiles / naturales" (es, ca, gl), "N meses / mesos", also "VEINTE (20) DÍAS HÁBILES" and "Diez días (10)
# naturales". A bare "N días" counts as working days: Ley 39/2015, art. 30.2 ("cuando los plazos se señalen por días,
# se entiende que éstos son hábiles").
_TERM_RE = re.compile(
    r"(?<![a-z0-9])(" + "|".join(_NUM_WORDS) + r"|[0-9]{1,3})(?:\s*\([0-9]{1,3}\))?\s+"
    r"(?:(dias?|dies)(?![a-z])\s*(?:\([0-9]{1,3}\)\s*)?)?(habiles|habils|naturales|naturals|meses|mesos|mes)?(?![a-z])"
)
_SAME_DAY_NEXT_MONTH = re.compile(r"\b(mismo|mesmo) ordinal\b")  # Galicia: "mismo ordinal del mes siguiente"
_FROM_PUBLICATION = re.compile(r"publicac|publicidad|publicacio|\bpublic\b|endema|extract")
_NO_FIXED_END = ("todo el ano", "tot l any", "todo o ano", "permanent", "hasta agotar", "fins a esgotar",
                 "ata esgotar", "mientras exista", "pendiente de", "no es necesario", "convocatoria abierta",
                 "de forma continua")  # fmt: skip


def _add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    y, m = d.year + y, m + 1
    last = (date(y + m // 12, m % 12 + 1, 1) - date.resolution).day
    return date(y, m, min(d.day, last))


def estimated_end(term: str | None, published: str | None, opens: str | None) -> tuple[date, str] | None:
    """(estimated last day, how it was counted) from a relative term counted from the publication, or None when the
    term is missing, ambiguous (two different terms, "N días" without hábiles/naturales) or not tied to the
    publication. The term runs from the day after `published`, or from `opens` when BDNS gives the start date.
    Working days skip weekends only (no holidays), so the result is an estimate, never an exact date."""
    if not term or not (published or opens):
        return None
    text = normalize_text(term)
    found = {
        (_NUM_WORDS.get(n) or int(n), "mes" if u.startswith("mes") else u[:5] if u else "habil")
        for n, d, u in _TERM_RE.findall(text)
        if d or u
    }
    if _SAME_DAY_NEXT_MONTH.search(text):
        found.add((1, "mes"))
    if len(found) != 1 or not _FROM_PUBLICATION.search(text):
        return None
    [(n, unit)] = found
    try:  # the day before the first day of the window
        base = date.fromisoformat(opens[:10]) - date.resolution if opens else date.fromisoformat(published or "")
    except ValueError:
        return None
    if unit == "mes":
        end, label = _add_months(base, n), f"{n} {'mes' if n == 1 else 'meses'}"
    elif unit == "natur":
        end, label = base + timedelta(days=n), f"{n} días naturales"
    else:
        end, left = base, n
        while left:
            end += date.resolution
            left -= end.weekday() < 5
        label = f"{n} días hábiles"
    return end, f"{label} desde {'la apertura del plazo' if opens else 'la publicación'}"


def short_date(d: date) -> str:
    """ "11 feb 2026"."""
    return f"{d.day} {_MONTHS_SHORT[d.month - 1]} {d.year}"


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
    ong_text_terms = {
        t for t in ONG_POSITIVE_TERMS if has_term(title_norm if t in _TITLE_ONLY_ONG_TERMS else topic_text, t)
    }
    ong_in_text = bool(ong_text_terms)
    sector = not ong_text_terms & _EXPLICIT_NON_PROFIT and any(w in SECTOR_WARNINGS for w in warnings)
    leader_groups = (
        _LEADER_GROUPS.search(title_norm) is not None
        and _LEADER_RUNNING.search(title_norm) is not None
        and "no son grupos" not in title_norm
    )
    if inp.kind == "empresa":
        is_ong_eligible = True
    elif leader_groups:
        is_ong_eligible = False
        raw -= LEADER_GROUPS_PENALTY
        warnings.append(LEADER_GROUPS_WARNING)
    elif sector and (ong_in_text or ong_in_benef):
        # the generic signal is the sector's associations: no NGO bonus, eligibility unknown
        warnings.append(SECTOR_ASSOCIATIONS_WARNING)
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
        reasons.append(
            "No es de los organismos que ya revisáis a mano (Fundación Biodiversidad, MITECO, Comunidad de Madrid, "
            "Agenda 2030): fácil que se os pase."
        )

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
    elif inp.abierto is not True and inp.fecha_publicacion:
        # no end date (not even an estimate: the connector estimates from the term) and BDNS does not say open
        try:
            age = (today_dt.date() - date.fromisoformat(inp.fecha_publicacion[:10])).days
        except ValueError:
            age = 0
        open_ended = normalize_text(f"{inp.texto_plazo or ''} {inp.titulo}")
        if age >= STALE_UNDATED_DAYS and not any(t in open_ended for t in _NO_FIXED_END):
            deadline_state = "cerrada"
            warnings.append(
                f"Probablemente cerrada: sin fecha de cierre y publicada hace {age // 30} meses; "
                "confirmar en las bases."
            )

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
            closed_on = "ya cerró"
            if local_end:
                on = f"{local_end.day}/{local_end.month}/{local_end.year}"
                closed_on = f"cerró hacia el {on} (fecha estimada)" if inp.deadline_estimated else f"cerró el {on}"
            reasons.append(f"Convocatoria periódica: la edición actual {closed_on}; prepara la siguiente con tiempo.")
        else:
            warnings.append("Plazo cerrado.")
    elif deadline_state == "abierta":
        raw += 10
        about = "unos " if inp.deadline_estimated else ""
        estimated = " (fecha estimada)" if inp.deadline_estimated else ""
        if days_remaining is not None and days_remaining <= 7:
            plural = "" if days_remaining == 1 else "s"
            warnings.append(f"Cierra en {about}{days_remaining} día{plural}{estimated}: valorar si da tiempo.")
        else:
            reasons.append(
                f"Plazo abierto: quedan {about}{days_remaining} días{estimated}."
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


CLOSED_RSC_PENALTY = 4
_MONTHS_SHORT = ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")


def score_rsc(
    titulo: str,
    focus: list[WorkLine],
    about: str,
    opens_at: str | None,
    deadline: str | None,
    limits: list[tuple[str, int]],
    verified_on: str,
    today: date | None = None,
) -> FitAnalysis:
    """Fit for hand-checked private (RSC) programmes: a curated 52-66 range, minus each limit's penalty, minus
    CLOSED_RSC_PENALTY while the last window is closed (an open one ranks first).

    The deadline state comes from the last published window, like any call; `limits` are (warning, penalty).
    """
    base = score_convocatoria(
        ScoreInput(
            titulo=titulo,
            organismo="",
            extra_text=about,
            kind="empresa",
            fecha_inicio_solicitud=opens_at,
            fecha_fin_solicitud=deadline,
        ),
        today,
    )
    lines = list(dict.fromkeys([*focus, *base.work_lines]))
    score = max(52, min(66, 46 + len(lines) * 4 + js_round(base.score / 10)))
    score -= sum(penalty for _, penalty in limits) + (CLOSED_RSC_PENALTY if base.deadline_state == "cerrada" else 0)
    score = max(0, score)
    checked = date.fromisoformat(verified_on)
    reasons = [r for r in base.reasons if not r.startswith("Coincidencia parcial")]
    return FitAnalysis(
        score=score,
        tier="bajo" if score < 40 else "medio",  # a channel Reforesta does not work yet: never top tier
        work_lines=lines,
        outside_manual_sources=True,
        manual_source_match=None,
        is_competitive=True,
        is_ong_eligible=True,
        reasons=[
            *reasons,
            f"Programa privado comprobado en la web de la entidad el {checked.day} {_MONTHS_SHORT[checked.month - 1]} "
            f"{checked.year}.",
            "Canal RSC: hoy Reforesta no lo trabaja de forma proactiva.",
        ],
        warnings=[*(text for text, _ in limits), *base.warnings],
        days_remaining=base.days_remaining,
        deadline_state=base.deadline_state,
    )
