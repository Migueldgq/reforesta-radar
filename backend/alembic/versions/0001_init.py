"""Initial schema: the same tables as supabase/migrations/0001_init.sql.

Differences from the Supabase SQL: no row-level security statements (they only mattered for Supabase's public
REST roles; this database is reached only by the API and the ingest), and no `if not exists` (Alembic tracks
what is applied).

Revision ID: 0001
Revises:
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, TSVECTOR

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TSTZ = TIMESTAMP(timezone=True)
EMPTY_JSON = sa.text("'{}'::jsonb")
NOW = sa.text("now()")
TSV = (
    "setweight(to_tsvector('spanish', coalesce(titulo, '')), 'A') || "
    "setweight(to_tsvector('spanish', coalesce(organismo, '')), 'B') || "
    "setweight(to_tsvector('spanish', coalesce(data ->> 'summary', '')), 'C')"
)


def upgrade() -> None:
    op.create_table(
        "ingest_runs",
        sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
        sa.Column("started_at", TSTZ, nullable=False),
        sa.Column("finished_at", TSTZ),
        sa.Column("status", sa.Text, nullable=False),
        sa.Column("trigger", sa.Text, nullable=False, server_default="manual"),
        sa.Column("scoring_version", sa.Integer, nullable=False),
        sa.Column("totals", JSONB, nullable=False, server_default=EMPTY_JSON),
        sa.CheckConstraint("status in ('running', 'ok', 'partial', 'error')", name="ingest_runs_status_check"),
    )
    op.create_index(
        "ingest_runs_ok_finished_idx",
        "ingest_runs",
        [sa.text("finished_at desc")],
        postgresql_where=sa.text("status in ('ok', 'partial')"),
    )

    op.create_table(
        "source_runs",
        sa.Column("run_id", sa.BigInteger, sa.ForeignKey("ingest_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.Text, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("category", sa.Text, nullable=False, server_default="Otros"),
        sa.Column("status", sa.Text, nullable=False),
        sa.Column("count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("note", sa.Text, nullable=False, server_default=""),
        sa.Column("url", sa.Text, nullable=False, server_default=""),
        sa.Column("started_at", TSTZ),
        sa.Column("finished_at", TSTZ),
        sa.Column("error", sa.Text),
        sa.PrimaryKeyConstraint("run_id", "source_id"),
        sa.CheckConstraint("status in ('ok', 'partial', 'error')", name="source_runs_status_check"),
    )
    op.create_index("source_runs_source_idx", "source_runs", ["source_id", sa.text("run_id desc")])

    op.create_table(
        "opportunities",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("source", sa.Text, nullable=False),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("titulo", sa.Text, nullable=False),
        sa.Column("organismo", sa.Text, nullable=False, server_default=""),
        sa.Column("region", sa.Text),
        sa.Column("nivel_admin", sa.Text),
        sa.Column("deadline", sa.Date),
        sa.Column("opens_at", sa.Date),
        sa.Column("budget", sa.Numeric),
        sa.Column("url", sa.Text, nullable=False),
        sa.Column("data", JSONB, nullable=False),
        sa.Column("content_hash", sa.Text, nullable=False),
        sa.Column("dedupe_key", sa.Text),
        sa.Column("first_seen_at", TSTZ, nullable=False, server_default=NOW),
        sa.Column("last_seen_at", TSTZ, nullable=False, server_default=NOW),
        sa.Column("last_changed_at", TSTZ, nullable=False, server_default=NOW),
        sa.Column("gone_at", TSTZ),
        sa.Column("tsv", TSVECTOR, sa.Computed(TSV, persisted=True)),
    )
    op.create_index("opportunities_tsv_idx", "opportunities", ["tsv"], postgresql_using="gin")
    op.create_index("opportunities_source_idx", "opportunities", ["source"])
    op.create_index("opportunities_live_idx", "opportunities", ["source"], postgresql_where=sa.text("gone_at is null"))
    op.create_index("opportunities_deadline_idx", "opportunities", ["deadline"])
    op.create_index("opportunities_first_seen_idx", "opportunities", [sa.text("first_seen_at desc")])
    op.create_index("opportunities_dedupe_idx", "opportunities", ["dedupe_key"])

    op.create_table(
        "opportunity_changes",
        sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
        sa.Column(
            "opportunity_id", sa.Text, sa.ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("run_id", sa.BigInteger, sa.ForeignKey("ingest_runs.id", ondelete="SET NULL")),
        sa.Column("changed_at", TSTZ, nullable=False, server_default=NOW),
        sa.Column("previous_hash", sa.Text),
        sa.Column("new_hash", sa.Text, nullable=False),
        sa.Column("diff", JSONB, nullable=False, server_default=EMPTY_JSON),
    )
    op.create_index(
        "opportunity_changes_opp_idx", "opportunity_changes", ["opportunity_id", sa.text("changed_at desc")]
    )
    op.create_index("opportunity_changes_run_idx", "opportunity_changes", ["run_id"])

    op.create_table(
        "fetch_cache",
        sa.Column("key", sa.Text, primary_key=True),
        sa.Column("value", JSONB, nullable=False),
        sa.Column("expires_at", TSTZ, nullable=False),
        sa.Column("updated_at", TSTZ, nullable=False, server_default=NOW),
    )
    op.create_index("fetch_cache_expires_idx", "fetch_cache", ["expires_at"])


def downgrade() -> None:
    for table in ("fetch_cache", "opportunity_changes", "opportunities", "source_runs", "ingest_runs"):
        op.drop_table(table)
