"""API contract: Pydantic mirrors of src/lib/opportunity.ts and src/lib/types.ts.

Python attributes are snake_case; JSON (by alias) is camelCase exactly as in the TypeScript.
Optional TS properties (`rsc?`, `firstSeenAt?`, `docId?`...) are omitted from JSON when unset.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

WorkLine = Literal["restauracion", "conservacion", "educacion", "agroambiental"]
OpportunityKind = Literal["subvencion", "licitacion", "boletin", "europa", "empresa"]
NivelAdmin = Literal["Estatal", "Autonómica", "Local", "UE", "Privada", "Otros"]
Tier = Literal["alto", "medio", "bajo"]
DeadlineState = Literal["abierta", "proxima", "cerrada", "sin_fecha"]
HealthStatus = Literal["ok", "partial", "error"]


def _absent_if_none(v: Any) -> bool:
    return v is None


class Contract(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, serialize_by_alias=True)

    def to_json(self) -> dict[str, Any]:
        """JSON-ready dict with camelCase keys (the shape the frontend and the `data` column use)."""
        return self.model_dump(mode="json", by_alias=True)


class FitAnalysis(Contract):
    score: int
    tier: Tier
    work_lines: list[WorkLine]
    outside_manual_sources: bool
    manual_source_match: str | None
    is_competitive: bool
    is_ong_eligible: bool | None
    reasons: list[str]
    warnings: list[str]
    days_remaining: int | None
    deadline_state: DeadlineState


class OpportunityDocument(Contract):
    name: str
    description: str
    url: str
    doc_id: int | None = Field(default=None, exclude_if=_absent_if_none)


class RscInfo(Contract):
    why_reforesta: str
    pitch_angle: str
    cadence: str


class OpportunityBase(Contract):
    """Everything a connector knows about an opportunity, before scoring."""

    id: str  # unique + stable: f"{source}:{native_id}"
    source: str
    source_label: str
    kind: OpportunityKind
    titulo: str
    organismo: str
    region: str  # CCAA name, "Estatal" or "Unión Europea"
    nivel_admin: NivelAdmin
    published_at: str | None = None  # YYYY-MM-DD
    opens_at: str | None = None
    deadline: str | None = None
    deadline_text: str | None = None
    budget: float | None = None  # euros
    amount_text: str | None = None
    tipo: str | None = None
    beneficiarios: list[str] = []
    url: str
    bases_url: str | None = None
    documents: list[OpportunityDocument] = []
    summary: str | None = None
    rsc: RscInfo | None = Field(default=None, exclude_if=_absent_if_none)


class EditionAwards(Contract):
    """Who won one past edition, reduced to counts (never beneficiary names: some are natural persons)."""

    count: int
    non_profit: int  # NIF starting with G (associations, foundations)
    importe: float | None


class HistoryEdition(Contract):
    year: int  # year the edition was registered in BDNS
    numero: str
    url: str
    opened_at: str | None  # YYYY-MM-DD: start of applications, else journal extract date, else BDNS registration
    closes_at: str | None
    window: str | None  # "10 días hábiles", "30 días naturales"...
    match: float | None = None  # title similarity (Jaccard) with the current call: 0.5-1.0
    awards: EditionAwards | None  # None: not checked (BDNS has awards only from 2022)


class TypicalOpening(Contract):
    from_: int = Field(alias="from")  # month 1-12
    to: int
    text: str  # ready Spanish phrase: "Suele abrir entre marzo y abril"
    irregular: bool


class ReforestaWin(Contract):
    year: int
    importe: float | None


class AwardsSummary(Contract):
    editions: list[int]  # years of the past editions the counts come from (the last 2 with awards)
    total: int
    non_profit: int
    non_profit_share: float
    by_class: dict[str, int]  # sinAnimo, empresa, ayuntamiento, publico, persona, cooperativa, ...
    won_by_reforesta: list[ReforestaWin]  # every checked past edition
    peers: list[str]  # curated environmental NGOs among the winners of the checked past editions


class History(Contract):
    """Previous editions of a BDNS call (newest first; the current call is not listed) and who won them."""

    editions: list[HistoryEdition]
    typical_opening: TypicalOpening | None
    typical_window: str | None
    awards: AwardsSummary | None


class Opportunity(OpportunityBase):
    fit: FitAnalysis
    first_seen_at: str | None = Field(default=None, exclude_if=_absent_if_none)  # ISO; Postgres store only
    # BDNS only, attached at read time from bdns_editions (never part of the stored item or its content hash)
    history: History | None = Field(default=None, exclude_if=_absent_if_none)


class SourceHealth(Contract):
    id: str
    name: str
    category: str
    status: HealthStatus
    count: int
    url: str
    note: str


class OpportunitiesResponse(Contract):
    items: list[Opportunity]
    sources: list[SourceHealth]
    fetched_at: str
    cached: bool
    stale: bool | None = Field(default=None, exclude_if=_absent_if_none)
    refreshing: bool | None = Field(default=None, exclude_if=_absent_if_none)
    storage: Literal["postgres", "cache"] | None = Field(default=None, exclude_if=_absent_if_none)
    last_ingest_at: str | None = None
    ingest_stale: bool | None = Field(default=None, exclude_if=_absent_if_none)
    storage_error: str | None = Field(default=None, exclude_if=_absent_if_none)


class SourcesResponse(Contract):
    sources: list[SourceHealth]
    last_ingest_at: str | None
