"""«Revisión por IA» (app/review.py, ADR 0041): the cached verdict of each call. `input_hash` covers the text sent,
the prompt version and the model, so a verdict is asked again only when one of them changes.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import TIMESTAMP

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TSTZ = TIMESTAMP(timezone=True)


def upgrade() -> None:
    op.create_table(
        "ai_reviews",
        sa.Column("opportunity_id", sa.Text, primary_key=True),
        sa.Column("input_hash", sa.Text, nullable=False),
        sa.Column("verdict", sa.Text, nullable=False),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("model", sa.Text, nullable=False),
        sa.Column("reviewed_at", TSTZ, nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("verdict in ('si', 'no', 'dudoso')", name="ai_reviews_verdict"),
    )


def downgrade() -> None:
    op.drop_table("ai_reviews")
