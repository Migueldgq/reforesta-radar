"""Connector interface.

A connector fetches and maps; it does not decide the stored fit. It returns `RawOpportunity` items: the contract
fields plus the `score_input` the TS connector passed to scoreConvocatoria (or scoreRsc), and an optional
`adjust` for the few post-scoring tweaks some TS connectors make. The ingest pipeline scores them with
`score_raw()`, drops what `keep()` rejects and stores the BASE fit. Geographic and kind fit are applied at read
time (app.scoring.rank), never here.

A connector MAY call `score_convocatoria` to decide what to fetch (BOE and BDNS pre-score search rows before
fetching details, exactly like the TS); that pre-score is never stored.
"""

from dataclasses import dataclass
from datetime import date
from typing import ClassVar

from pydantic import Field

from app.http import Http
from app.models import Contract, Opportunity, OpportunityBase, SourceHealth, WorkLine
from app.scoring.score import FitAdjust, ScoreInput, apply_adjust, score_convocatoria, score_rsc
from app.sources.memo import Memo


class RscScoreInput(Contract):
    """Input of score_rsc (hand-checked private programmes)."""

    titulo: str
    focus: list[WorkLine]
    about: str  # what the programme funds, from its source (topic matching)
    opens_at: str | None
    deadline: str | None
    limits: list[tuple[str, int]]  # (warning, score penalty)
    verified_on: str


class RawOpportunity(OpportunityBase):
    score_input: ScoreInput | RscScoreInput = Field(exclude=True)
    adjust: FitAdjust | None = Field(default=None, exclude=True)


def score_raw(raw: RawOpportunity, today: date | None = None) -> Opportunity:
    """Base fit for one connector item (what the TS connectors computed inline)."""
    inp = raw.score_input
    if isinstance(inp, RscScoreInput):
        fit = score_rsc(
            inp.titulo, inp.focus, inp.about, inp.opens_at, inp.deadline, inp.limits, inp.verified_on, today
        )
    else:
        fit = apply_adjust(score_convocatoria(inp, today), raw.adjust)
    return Opportunity(**{k: getattr(raw, k) for k in OpportunityBase.model_fields}, fit=fit)


@dataclass
class FetchResult:
    items: list[RawOpportunity]
    # `count` is overwritten with the number of items kept; `note` may contain "{count}" for that number.
    health: SourceHealth


@dataclass
class SourceContext:
    http: Http
    memo: Memo


class Source:
    """Subclass, set `id` and `name`, implement `fetch`, register the instance in app/sources/__init__.py."""

    id: ClassVar[str]
    name: ClassVar[str]

    async def fetch(self, ctx: SourceContext) -> FetchResult:
        raise NotImplementedError

    def keep(self, o: Opportunity) -> bool:
        """Final filter on the scored item (TS connectors filter on fit after scoring). Default: keep all."""
        return True
