"""Fit signal from who won the previous editions of a BDNS call (`Opportunity.history`, app/sources/bdns_history.py).

Returned as a FitAdjust and applied at read time by rank.adjusted_fit: the delta goes on the base fit (so the
territorial and kind caps still bound it), the cap last (it is a ceiling on the displayed score), the reasons first.
"""

from app.models import AwardsSummary, History
from app.scoring.score import FitAdjust

MIN_AWARDS = 5  # fewer past awards say nothing about who usually wins
WON_BY_REFORESTA = 8
PEERS_WON = 3
NON_PROFIT_SHARE_HIGH = 0.7
NON_PROFIT_HIGH = 6
NON_PROFIT_SHARE_LOW = 0.2
NON_PROFIT_LOW = -10
NO_NON_PROFIT_CAP = 45

# Plural Spanish names of the beneficiary classes (bdns_history.nif_class), for the warnings.
CLASS_LABELS = {
    "empresa": "empresas",
    "ayuntamiento": "ayuntamientos",
    "publico": "universidades y otros organismos públicos",
    "persona": "particulares",
    "cooperativa": "cooperativas",
    "sociedadCivil": "sociedades civiles",
    "religiosa": "entidades religiosas",
    "otra": "otro tipo de entidades",
}


def _join(words: list[str]) -> str:
    return words[0] if len(words) == 1 else f"{', '.join(words[:-1])} y {words[-1]}"


def _eur(x: float) -> str:
    return f"{round(x):,}".replace(",", ".") + " €"


def _dominant(a: AwardsSummary) -> tuple[str, int]:
    """Largest class other than non-profits (by_class is sorted by count)."""
    return next(((k, n) for k, n in a.by_class.items() if k != "sinAnimo"), ("otra", 0))


def history_adjust(history: History | None) -> FitAdjust | None:
    a = history.awards if history else None
    if a is None:
        return None
    delta = 0
    cap: int | None = None
    reasons: list[str] = []
    warnings: list[str] = []
    if a.won_by_reforesta:
        delta += WON_BY_REFORESTA
        last, *older = a.won_by_reforesta  # newest first
        years = [f"{last.year} ({_eur(last.importe)})" if last.importe else str(last.year)]
        reasons.append(f"Reforesta ya la ganó en {_join(years + [str(w.year) for w in older])}.")
    if a.peers:
        delta += PEERS_WON
        reasons.append(f"La han ganado entidades como {_join(a.peers[:3])}.")
    if a.total >= MIN_AWARDS:
        share = a.non_profit / a.total
        if share >= NON_PROFIT_SHARE_HIGH:
            delta += NON_PROFIT_HIGH
            verb = "fue" if a.non_profit == 1 else "fueron"
            reasons.append(
                f"En las últimas ediciones, {a.non_profit} de {a.total} ayudas {verb} a entidades sin ánimo de lucro."
            )
        elif share < NON_PROFIT_SHARE_LOW:
            delta += NON_PROFIT_LOW
            cls, n = _dominant(a)
            label = CLASS_LABELS.get(cls, CLASS_LABELS["otra"])
            if a.non_profit == 0:
                cap = NO_NON_PROFIT_CAP
                most = "" if n == a.total else "sobre todo "
                warnings.append(
                    f"Ninguna de las {a.total} ayudas anteriores fue a una entidad sin ánimo de lucro "
                    f"(fueron {most}a {label})."
                )
            else:
                verb = "fue" if a.non_profit == 1 else "fueron"
                most = "la mayoría fue" if n * 2 > a.total else "fueron sobre todo"
                warnings.append(
                    f"Solo {a.non_profit} de {a.total} ayudas anteriores {verb} a entidades sin ánimo de lucro: "
                    f"{most} a {label}."
                )
    if not (delta or cap is not None or reasons or warnings):
        return None
    return FitAdjust(delta=delta, cap=cap, prepend_reasons=reasons, append_warnings=warnings)
