"""Personal access tokens for the read-only MCP server (/mcp). Only the sha256 of each token is stored.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import TIMESTAMP

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TSTZ = TIMESTAMP(timezone=True)


def upgrade() -> None:
    op.create_table(
        "personal_tokens",
        sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
        sa.Column("user_id", sa.BigInteger, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("token_hash", sa.Text, nullable=False, unique=True),
        sa.Column("created_at", TSTZ, nullable=False, server_default=sa.text("now()")),
        sa.Column("expires_at", TSTZ, nullable=False),
        sa.Column("last_used_at", TSTZ),
        sa.Column("revoked_at", TSTZ),
    )
    op.create_index("ix_personal_tokens_user_id", "personal_tokens", ["user_id"])


def downgrade() -> None:
    op.drop_table("personal_tokens")
