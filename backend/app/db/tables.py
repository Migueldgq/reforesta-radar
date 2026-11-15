"""Table definitions (SQLAlchemy Core). Schema owner: alembic/versions/ (0001_init.py, 0002_bdns_editions.py).

Same tables and columns as supabase/migrations/0001_init.sql, so data and semantics carry over:
rows hold the BASE opportunity (connector output + base fit); geographic and kind fit are applied at read time.
"""

from sqlalchemy import (
    BigInteger,
    Column,
    Computed,
    Date,
    ForeignKey,
    Identity,
    Integer,
    MetaData,
    Numeric,
    PrimaryKeyConstraint,
    Table,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, TSVECTOR

TSTZ = TIMESTAMP(timezone=True)
metadata = MetaData()

ingest_runs = Table(
    "ingest_runs",
    metadata,
    Column("id", BigInteger, Identity(always=True), primary_key=True),
    Column("started_at", TSTZ, nullable=False),
    Column("finished_at", TSTZ),
    Column("status", Text, nullable=False),  # running | ok | partial | error
    Column("trigger", Text, nullable=False, server_default="manual"),
    Column("scoring_version", Integer, nullable=False),
    Column("totals", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
)

source_runs = Table(
    "source_runs",
    metadata,
    Column("run_id", BigInteger, ForeignKey("ingest_runs.id", ondelete="CASCADE"), nullable=False),
    Column("source_id", Text, nullable=False),
    Column("name", Text, nullable=False),
    Column("category", Text, nullable=False, server_default="Otros"),
    Column("status", Text, nullable=False),  # ok | partial | error
    Column("count", Integer, nullable=False, server_default="0"),
    Column("note", Text, nullable=False, server_default=""),
    Column("url", Text, nullable=False, server_default=""),
    Column("started_at", TSTZ),
    Column("finished_at", TSTZ),
    Column("error", Text),
    PrimaryKeyConstraint("run_id", "source_id"),
)

TSV_EXPR = (
    "setweight(to_tsvector('spanish', coalesce(titulo, '')), 'A') || "
    "setweight(to_tsvector('spanish', coalesce(organismo, '')), 'B') || "
    "setweight(to_tsvector('spanish', coalesce(data ->> 'summary', '')), 'C')"
)

opportunities = Table(
    "opportunities",
    metadata,
    Column("id", Text, primary_key=True),  # f"{source}:{native_id}"
    Column("source", Text, nullable=False),
    Column("kind", Text, nullable=False),
    Column("titulo", Text, nullable=False),
    Column("organismo", Text, nullable=False, server_default=""),
    Column("region", Text),
    Column("nivel_admin", Text),
    Column("deadline", Date),
    Column("opens_at", Date),
    Column("budget", Numeric),
    Column("url", Text, nullable=False),
    Column("data", JSONB, nullable=False),  # full BASE Opportunity (camelCase contract JSON)
    Column("content_hash", Text, nullable=False),  # sha256 of stable JSON (excludes fit)
    Column("dedupe_key", Text),  # BDNS number or normalised title|org|deadline
    Column("first_seen_at", TSTZ, nullable=False, server_default=text("now()")),
    Column("last_seen_at", TSTZ, nullable=False, server_default=text("now()")),
    Column("last_changed_at", TSTZ, nullable=False, server_default=text("now()")),
    Column("gone_at", TSTZ),  # set when a healthy run of its source no longer returns it
    Column("tsv", TSVECTOR, Computed(TSV_EXPR, persisted=True)),
)

opportunity_changes = Table(
    "opportunity_changes",
    metadata,
    Column("id", BigInteger, Identity(always=True), primary_key=True),
    Column("opportunity_id", Text, ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False),
    Column("run_id", BigInteger, ForeignKey("ingest_runs.id", ondelete="SET NULL")),
    Column("changed_at", TSTZ, nullable=False, server_default=text("now()")),
    Column("previous_hash", Text),
    Column("new_hash", Text, nullable=False),
    Column("diff", JSONB, nullable=False, server_default=text("'{}'::jsonb")),  # {field: {from, to}}
)

fetch_cache = Table(
    "fetch_cache",
    metadata,
    Column("key", Text, primary_key=True),
    Column("value", JSONB, nullable=False),
    Column("expires_at", TSTZ, nullable=False),
    Column("updated_at", TSTZ, nullable=False, server_default=text("now()")),
)

# Previous editions of current BDNS calls (app/sources/bdns_history.py), one row per (call, edition); the current
# edition itself is a row too (numero == call_numero). Past editions are never opportunities. Award columns hold
# counts only: never beneficiary names (some winners are natural persons).
bdns_editions = Table(
    "bdns_editions",
    metadata,
    Column("call_numero", Text, nullable=False),  # the current call (opportunity id "bdns:<call_numero>")
    Column("numero", Text, nullable=False),
    Column("organ_ids", Text, nullable=False),  # resolved BDNS organ id(s), comma-separated
    Column("title", Text, nullable=False),
    Column("published_at", Date, nullable=False),  # BDNS registration (fechaRecepcion)
    Column("opened_at", Date),
    Column("closes_at", Date),
    Column("window_text", Text),
    Column("awards_count", Integer),  # null: awards not checked
    Column("awards_by_class", JSONB),  # {"sinAnimo": 19, "empresa": 2, ...}
    Column("awards_importe", Numeric),
    Column("awards_first", Date),
    Column("awards_last", Date),
    Column("reforesta_importe", Numeric),  # set when Reforesta (G80428204) won this edition
    Column("peer_hits", JSONB),  # NIFs of curated environmental NGOs among the winners
    Column("fetched_at", TSTZ, nullable=False, server_default=text("now()")),
    PrimaryKeyConstraint("call_numero", "numero"),
)
