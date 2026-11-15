"""The team's own Perfil adjustments on top of the server score: a port of `applyProfileAll` in
src/components/radar/profile.ts, so the MCP server shows the same score and hides the same calls as the web.

The web stays the reference: a change to profile.ts must be mirrored here (tests/test_team_profile.py pins the
behaviour on hand-computed cases). Pure: always starts from the ranked server item.
"""

from typing import TYPE_CHECKING

from app.models import Opportunity
from app.scoring.profile import WORK_LINE_LABELS, GeoFit
from app.scoring.score import tier_for
from app.scoring.text import has_term, js_round, normalize_text

if TYPE_CHECKING:
    from app.api.board import TeamProfile

PREFIX = "Vuestro perfil:"
HIDE_PENALTY = 100


def _num(n: float) -> str:
    return str(int(n)) if n == int(n) else str(n)


def _signed(n: float) -> str:
    return f"+{_num(n)}" if n > 0 else f"−{_num(abs(n))}"  # U+2212, as the web


def territories(p: "TeamProfile") -> set[str]:
    """Regions the team counts as theirs: positive server baseline (not lowered by the team) or own positive bonus."""
    out = {r for r, g in GeoFit.regions.items() if g.delta > 0 and p.region_adjust.get(r, 0) >= 0}
    return out | {r for r, v in p.region_adjust.items() if v > 0}


def _haystack(o: Opportunity) -> str:
    return normalize_text(" | ".join([o.titulo, o.organismo, o.summary or "", *o.beneficiarios]))


def hidden_reason(o: Opportunity, p: "TeamProfile", terr: set[str], hay: str) -> str | None:
    """Why the team's profile removes the call ("tipo", "importe", "municipal", "descartada"), or None."""
    if o.kind not in p.kinds:
        return "tipo"
    if p.min_budget and o.budget is not None and o.budget < p.min_budget:
        return "importe"
    if p.hide_municipal_outside_regions and o.nivel_admin == "Local" and o.region not in terr:
        return "municipal"
    if any(t.penalty >= HIDE_PENALTY and has_term(hay, normalize_text(t.term)) for t in p.excluded_terms):
        return "descartada"
    return None


def apply_profile(o: Opportunity, p: "TeamProfile", hay: str) -> Opportunity:
    delta: float = 0
    reasons: list[str] = []
    warnings: list[str] = []
    lines = list(o.fit.work_lines)
    for k in p.extra_keywords:
        if not has_term(hay, normalize_text(k.term)):
            continue
        delta += k.weight
        if k.line and k.line not in lines:
            lines.append(k.line)
        reasons.append(f"{PREFIX} menciona «{k.term}» ({_signed(k.weight)}).")
    for t in p.excluded_terms:
        if t.penalty >= HIDE_PENALTY or not has_term(hay, normalize_text(t.term)):
            continue
        delta -= t.penalty
        warnings.append(f"{PREFIX} menciona «{t.term}», que descartáis ({_signed(-t.penalty)}).")
    for line, label in WORK_LINE_LABELS.items():
        v = p.line_priority.get(line, 0)
        if not v or line not in o.fit.work_lines:
            continue
        delta += v
        (reasons if v > 0 else warnings).append(
            f"{PREFIX} prioridad {'alta' if v > 0 else 'baja'} a {label} ({_signed(v)})."
        )
    if r := p.region_adjust.get(o.region):
        delta += r
        (reasons if r > 0 else warnings).append(f"{PREFIX} territorio {o.region} ({_signed(r)}).")
    if not reasons and not warnings:
        return o
    score = js_round(min(100, max(0, o.fit.score + delta)))
    # like the server: closed calls (next edition) never climb into "alto" through a bonus
    if o.fit.deadline_state == "cerrada" and score > o.fit.score:
        score = max(o.fit.score, min(score, GeoFit.closed_cap))
    # nor does a bonus lift a call above the cap of its kind (tenders, bulletin notices…: fit.score_cap)
    if o.fit.score_cap is not None and score > o.fit.score:
        score = max(o.fit.score, min(score, o.fit.score_cap))
    fit = o.fit.model_copy(
        update={
            "score": score,
            "tier": tier_for(score),
            "work_lines": lines,
            "reasons": [*o.fit.reasons, *reasons],
            "warnings": [*o.fit.warnings, *warnings],
        }
    )
    return o.model_copy(update={"fit": fit})


def apply_profile_all(items: list[Opportunity], p: "TeamProfile") -> tuple[list[Opportunity], dict[str, str]]:
    """(adjusted items the profile keeps, {id: hidden reason} of the ones it removes). Neutral profile: unchanged."""
    if p.is_neutral():
        return items, {}
    terr = territories(p)
    kept: list[Opportunity] = []
    hidden: dict[str, str] = {}
    for o in items:
        hay = _haystack(o)
        if why := hidden_reason(o, p, terr, hay):
            hidden[o.id] = why
            continue
        kept.append(apply_profile(o, p, hay))
    return kept, hidden
