"""History of BDNS calls: previous editions and a count-only summary of who won them.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TSTZ = TIMESTAMP(timezone=True)


def upgrade() -> None:
    op.create_table(
        "bdns_editions",
        sa.Column("call_numero", sa.Text, nullable=False),
        sa.Column("numero", sa.Text, nullable=False),
        sa.Column("organ_ids", sa.Text, nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("published_at", sa.Date, nullable=False),
        sa.Column("opened_at", sa.Date),
        sa.Column("closes_at", sa.Date),
        sa.Column("window_text", sa.Text),
        sa.Column("awards_count", sa.Integer),
        sa.Column("awards_by_class", JSONB),
        sa.Column("awards_importe", sa.Numeric),
        sa.Column("awards_first", sa.Date),
        sa.Column("awards_last", sa.Date),
        sa.Column("reforesta_importe", sa.Numeric),
        sa.Column("peer_hits", JSONB),
        sa.Column("fetched_at", TSTZ, nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("call_numero", "numero"),
    )


def downgrade() -> None:
    op.drop_table("bdns_editions")
