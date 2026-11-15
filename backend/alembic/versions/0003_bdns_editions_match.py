"""bdns_editions.match: title Jaccard of a past edition with the current call (basis for the history penalties).

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("bdns_editions", sa.Column("match", sa.Numeric))


def downgrade() -> None:
    op.drop_column("bdns_editions", "match")
