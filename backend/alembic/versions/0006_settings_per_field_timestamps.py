"""Who saved the team's Perfil and organism filter, and when, separately (org_settings).

Before, one updated_by/updated_at pair covered both, so changing the organism filter made Perfil say "Guardado por…".
The existing pair is copied to each field the team had saved. updated_by/updated_at stay: the latest of the two.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import TIMESTAMP

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TSTZ = TIMESTAMP(timezone=True)


def upgrade() -> None:
    for field in ("profile", "organisms"):
        op.add_column(
            "org_settings",
            sa.Column(f"{field}_updated_by", sa.BigInteger, sa.ForeignKey("users.id", ondelete="SET NULL")),
        )
        op.add_column("org_settings", sa.Column(f"{field}_updated_at", TSTZ))
        op.execute(
            f"update org_settings set {field}_updated_by = updated_by, {field}_updated_at = updated_at "
            f"where {field} is not null"
        )


def downgrade() -> None:
    for field in ("profile", "organisms"):
        op.drop_column("org_settings", f"{field}_updated_at")
        op.drop_column("org_settings", f"{field}_updated_by")
