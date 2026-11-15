"""Read-time adjustments and ranking (port of geographicFit / kindFit in scoring.ts and rank / cleanItems in
aggregate.ts), plus the BDNS history signal (app/scoring/history.py). Pure: stored items keep their BASE fit; these
run on every response, so a change to the tables applies without re-ingesting.
"""

import re

from app.models import FitAnalysis, Opportunity
from app.scoring.history import history_adjust
from app.scoring.profile import KEYWORD_RULES, GeoFit, KindFit
from app.scoring.score import FitAdjust, apply_adjust, tier_for
from app.scoring.text import has_term, normalize_text

LOCAL_PREFIX = re.compile(r"^(ayuntamiento|ajuntament|concello|udala|ayto\.?)\s+(de\s+|del\s+|d'\s*)?", re.IGNORECASE)
SUPRAMUNICIPAL = re.compile(r"^(diputaci|cabildo|consell insular|consell comarcal|comarca|mancomunidad|junta general)")
MINOR_WORDS = frozenset({"de", "del", "la", "las", "los", "el", "y", "i", "en"})
CALL_IN_TITLE = re.compile(r"(convoca|extracto|bases reguladoras)")
GRANT_IN_TITLE = re.compile(r"(subvenc|ayuda|premio)")
UNIVERSITY = re.compile(r"^(universidad|universitat|universidade)")


def _title_case(s: str) -> str:
    words = s.lower().split(" ")
    return " ".join(w if i > 0 and w in MINOR_WORDS else w[:1].upper() + w[1:] for i, w in enumerate(words))


def geographic_fit(o: Opportunity) -> FitAnalysis:
    """Can Reforesta (Madrid) realistically apply from where it is? Always pass the stored base fit."""
    base = o.fit
    region = "Asturias" if o.region == "Principado de Asturias" else o.region
    entity = o.organismo.split(" · ")[0].strip()
    entity_norm = normalize_text(entity)
    is_municipal = o.nivel_admin == "Local" and not SUPRAMUNICIPAL.search(entity_norm)
    known = region not in ("Sin determinar", "")

    delta = 0
    reason: str | None = None
    warning: str | None = None
    cap = 100
    g = GeoFit.regions.get(region)
    if o.kind == "empresa" or (o.nivel_admin == "Privada" and (region == "Estatal" or not known)):
        # nationwide private programme; a company programme limited to a territory already has that as one of its
        # curated limits (app/sources/rsc.py), so its region (the territory) is not penalised twice
        pass
    elif region == "Comunidad de Madrid":
        g = GeoFit.madrid_municipal if is_municipal else GeoFit.regions[region]
        delta, reason = g.delta, g.reason
    elif is_municipal:
        name = _title_case(LOCAL_PREFIX.sub("", entity, count=1))
        delta = GeoFit.other_municipal
        where = f" ({region})" if known and region != "Estatal" else ""
        warning = f"Convocatoria municipal de {name}{where}: normalmente exige sede en el municipio."
    elif g and (o.nivel_admin != "Estatal" or region == "Estatal"):
        delta, reason, cap = g.delta, g.reason, g.cap
    elif known and region != "Estatal" and o.nivel_admin not in ("Estatal", "UE"):
        delta = GeoFit.other_region
        warning = f"Convocatoria de {region}: suele exigir sede o actuación allí."
    if delta == 0:
        return base

    score = max(0, min(cap, base.score + delta))
    if delta < 0:
        score = min(score, GeoFit.out_of_territory_cap)
    # closed competitive grants for non-profits keep their fit (timing is shown by deadlineState, not the tier)
    recurring_grant = o.kind == "subvencion" and base.is_competitive and base.is_ong_eligible is not False
    if base.deadline_state == "cerrada" and not recurring_grant:
        score = min(score, max(base.score, GeoFit.closed_cap))
    return base.model_copy(
        update={
            "score": score,
            "tier": tier_for(score),
            "reasons": [reason, *base.reasons] if reason else base.reasons,
            "warnings": [warning, *base.warnings] if warning else base.warnings,
        }
    )


def _title_topic(titulo: str) -> int:
    t = normalize_text(titulo)
    return sum(kw.weight for group in KEYWORD_RULES for kw in group.keywords if has_term(t, kw.term))


def kind_fit(o: Opportunity) -> FitAnalysis:
    """Actionability by kind: a grant Reforesta can apply to outranks tenders, bulletin notices and research."""
    fit = o.fit
    title_norm = normalize_text(o.titulo)
    score = fit.score
    warnings: list[str] = []
    weak_topic = o.kind != "europa" and _title_topic(o.titulo) < KindFit.min_title_topic

    if o.kind == "licitacion":
        score = min(score - KindFit.tender_penalty, KindFit.tender_cap)
        warnings.append("Licitación: es un contrato de servicios; exige solvencia técnica y oferta económica.")
        if weak_topic:
            score = min(score, KindFit.off_topic_cap)
    elif o.kind == "boletin" and not (CALL_IN_TITLE.search(title_norm) and GRANT_IN_TITLE.search(title_norm)):
        score = min(score, KindFit.bulletin_cap)
        warnings.append("Publicación informativa: no es una convocatoria a la que presentarse.")
        if weak_topic:
            score = min(score, KindFit.off_topic_cap)
    elif o.kind == "europa" and "Horizon Europe" in o.organismo:
        score = min(score, KindFit.horizon_cap)
    if UNIVERSITY.search(normalize_text(o.organismo)):
        score = min(score, KindFit.university_cap)
        warnings.append("Convocatoria de una universidad: suele dirigirse a su propia comunidad universitaria.")
    if score == fit.score and not warnings:
        return fit
    score = max(0, score)
    return fit.model_copy(
        update={
            "score": score,
            "tier": tier_for(score),
            "warnings": [*warnings, *(w for w in fit.warnings if w not in warnings)],
        }
    )


def adjusted_fit(o: Opportunity) -> FitAnalysis:
    """Geographic fit, then actionability by kind, on top of the stored base fit; then the history of a BDNS call.

    The history delta goes on the base fit, so the territorial and kind caps still bound it; its cap is applied last
    (a ceiling on the displayed score, which geographic bonuses must not lift) and its reasons go first.
    """
    adj = history_adjust(o.history)
    if adj is None:
        return kind_fit(o.model_copy(update={"fit": geographic_fit(o)}))
    base = apply_adjust(o.fit, FitAdjust(delta=adj.delta, append_warnings=adj.append_warnings))
    based = o.model_copy(update={"fit": base})
    fit = kind_fit(based.model_copy(update={"fit": geographic_fit(based)}))
    score = max(0, min(100, fit.score, 100 if adj.cap is None else adj.cap))
    return fit.model_copy(
        update={"score": score, "tier": tier_for(score), "reasons": [*adj.prepend_reasons, *fit.reasons]}
    )


def rank(items: list[Opportunity]) -> list[Opportunity]:
    """Apply read-time fit and sort: score desc, then earliest deadline (no deadline last). Never mutates input."""
    ranked = [o.model_copy(update={"fit": adjusted_fit(o)}) for o in items]
    ranked.sort(key=lambda o: "9999" if o.deadline is None else o.deadline)
    ranked.sort(key=lambda o: o.fit.score, reverse=True)
    return ranked


def clean_items(items: list[Opportunity]) -> list[Opportunity]:
    """Dedupe by id (keep the higher score; first wins a tie) and drop items without title or url."""
    by_id: dict[str, Opportunity] = {}
    for o in items:
        if not o.titulo.strip() or not o.url.strip():
            continue
        prev = by_id.get(o.id)
        if prev is None or o.fit.score > prev.fit.score:
            by_id[o.id] = o
    return list(by_id.values())
