"""OAuth 2.1 for assistants that connect to /mcp/equipo (app/oauth, ADR 0035): registered clients, pending
authorisation requests, grants, codes and tokens. Every secret is stored only as its sha256.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TSTZ = TIMESTAMP(timezone=True)
NOW = sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "oauth_clients",
        sa.Column("client_id", sa.Text, primary_key=True),
        sa.Column("secret_hash", sa.Text),
        sa.Column("auth_method", sa.Text, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("redirect_uris", JSONB, nullable=False),
        sa.Column("created_at", TSTZ, nullable=False, server_default=NOW),
        sa.Column("last_used_at", TSTZ),
    )
    op.create_table(
        "oauth_requests",
        sa.Column("id_hash", sa.Text, primary_key=True),
        sa.Column("browser_hash", sa.Text, nullable=False),
        sa.Column("client_id", sa.Text, sa.ForeignKey("oauth_clients.client_id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.BigInteger, sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("redirect_uri", sa.Text, nullable=False),
        sa.Column("redirect_explicit", sa.Boolean, nullable=False),
        sa.Column("state", sa.Text),
        sa.Column("code_challenge", sa.Text, nullable=False),
        sa.Column("scopes", sa.Text, nullable=False),
        sa.Column("resource", sa.Text, nullable=False),
        sa.Column("created_at", TSTZ, nullable=False, server_default=NOW),
        sa.Column("expires_at", TSTZ, nullable=False),
    )
    op.create_index("ix_oauth_requests_client_id", "oauth_requests", ["client_id"])
    op.create_index("ix_oauth_requests_expires_at", "oauth_requests", ["expires_at"])
    op.create_table(
        "oauth_grants",
        sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
        sa.Column("user_id", sa.BigInteger, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_id", sa.Text, sa.ForeignKey("oauth_clients.client_id", ondelete="CASCADE"), nullable=False),
        sa.Column("scopes", sa.Text, nullable=False),
        sa.Column("resource", sa.Text, nullable=False),
        sa.Column("created_at", TSTZ, nullable=False, server_default=NOW),
        sa.Column("last_used_at", TSTZ),
        sa.Column("expires_at", TSTZ, nullable=False),
        sa.Column("revoked_at", TSTZ),
    )
    op.create_index("ix_oauth_grants_user_id", "oauth_grants", ["user_id"])
    op.create_index("ix_oauth_grants_client_id", "oauth_grants", ["client_id"])
    op.create_table(
        "oauth_codes",
        sa.Column("code_hash", sa.Text, primary_key=True),
        sa.Column("grant_id", sa.BigInteger, sa.ForeignKey("oauth_grants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("redirect_uri", sa.Text, nullable=False),
        sa.Column("redirect_explicit", sa.Boolean, nullable=False),
        sa.Column("code_challenge", sa.Text, nullable=False),
        sa.Column("expires_at", TSTZ, nullable=False),
        sa.Column("used_at", TSTZ),
    )
    op.create_index("ix_oauth_codes_grant_id", "oauth_codes", ["grant_id"])
    op.create_table(
        "oauth_tokens",
        sa.Column("token_hash", sa.Text, primary_key=True),
        sa.Column("grant_id", sa.BigInteger, sa.ForeignKey("oauth_grants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("created_at", TSTZ, nullable=False, server_default=NOW),
        sa.Column("expires_at", TSTZ, nullable=False),
        sa.Column("used_at", TSTZ),
        sa.CheckConstraint("kind in ('access', 'refresh')", name="oauth_tokens_kind"),
    )
    op.create_index("ix_oauth_tokens_grant_id", "oauth_tokens", ["grant_id"])


def downgrade() -> None:
    for t in ("oauth_tokens", "oauth_codes", "oauth_grants", "oauth_requests", "oauth_clients"):
        op.drop_table(t)
