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


class Opportunity(OpportunityBase):
    fit: FitAnalysis
    first_seen_at: str | None = Field(default=None, exclude_if=_absent_if_none)  # ISO; Postgres store only


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
