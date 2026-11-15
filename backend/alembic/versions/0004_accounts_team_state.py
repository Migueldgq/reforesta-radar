"""Accounts (users, sessions, invitations, password resets) and team state (tracking board, notes, organisation
settings, votes, ingest requests).

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TSTZ = TIMESTAMP(timezone=True)
NOW = sa.text("now()")


def _id() -> sa.Column:
    return sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True)


def _user_fk(name: str, ondelete: str = "SET NULL", nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.BigInteger, sa.ForeignKey("users.id", ondelete=ondelete), nullable=nullable)


def upgrade() -> None:
    op.create_table(
        "users",
        _id(),
        sa.Column("email", sa.Text, nullable=False),
        sa.Column("name", sa.Text, nullable=False, server_default=""),
        sa.Column("role", sa.Text, nullable=False),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("created_at", TSTZ, nullable=False, server_default=NOW),
        sa.Column("last_login_at", TSTZ),
        sa.CheckConstraint("role in ('admin', 'member')", name="users_role"),
    )
    op.create_index("users_email_lower", "users", [sa.text("lower(email)")], unique=True)

    op.create_table(
        "sessions",
        _id(),
        sa.Column("token_hash", sa.Text, nullable=False, unique=True),
        _user_fk("user_id", "CASCADE", nullable=False),
        sa.Column("created_at", TSTZ, nullable=False, server_default=NOW),
        sa.Column("last_seen_at", TSTZ, nullable=False, server_default=NOW),
        sa.Column("expires_at", TSTZ, nullable=False),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])

    op.create_table(
        "invitations",
        _id(),
        sa.Column("email", sa.Text, nullable=False),
        sa.Column("name", sa.Text, nullable=False, server_default=""),
        sa.Column("role", sa.Text, nullable=False),
        sa.Column("token_hash", sa.Text, nullable=False, unique=True),
        _user_fk("created_by"),
        sa.Column("created_at", TSTZ, nullable=False, server_default=NOW),
        sa.Column("expires_at", TSTZ, nullable=False),
        sa.Column("accepted_at", TSTZ),
        sa.Column("revoked_at", TSTZ),
        sa.CheckConstraint("role in ('admin', 'member')", name="invitations_role"),
    )

    op.create_table(
        "password_resets",
        _id(),
        _user_fk("user_id", "CASCADE", nullable=False),
        sa.Column("token_hash", sa.Text, nullable=False, unique=True),
        _user_fk("created_by"),
        sa.Column("created_at", TSTZ, nullable=False, server_default=NOW),
        sa.Column("expires_at", TSTZ, nullable=False),
        sa.Column("used_at", TSTZ),
    )

    op.create_table(
        "tracking",
        sa.Column("opportunity_id", sa.Text, primary_key=True),
        sa.Column("status", sa.Text, nullable=False),
        _user_fk("assignee_id"),
        sa.Column("titulo", sa.Text, nullable=False, server_default=""),
        sa.Column("organismo", sa.Text, nullable=False, server_default=""),
        sa.Column("source", sa.Text, nullable=False, server_default=""),
        sa.Column("url", sa.Text, nullable=False, server_default=""),
        sa.Column("deadline", sa.Text),
        sa.Column("created_at", TSTZ, nullable=False, server_default=NOW),
        _user_fk("updated_by"),
        sa.Column("updated_at", TSTZ, nullable=False, server_default=NOW),
        sa.CheckConstraint(
            "status in ('nueva', 'estudio', 'presentar', 'presentada', 'descartada')", name="tracking_status"
        ),
    )

    op.create_table(
        "tracking_notes",
        _id(),
        sa.Column(
            "opportunity_id",
            sa.Text,
            sa.ForeignKey("tracking.opportunity_id", ondelete="CASCADE"),
            nullable=False,
        ),
        _user_fk("author_id"),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("created_at", TSTZ, nullable=False, server_default=NOW),
    )
    op.create_index("ix_tracking_notes_opportunity_id", "tracking_notes", ["opportunity_id"])

    op.create_table(
        "org_settings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("profile", JSONB),
        sa.Column("organisms", JSONB),
        _user_fk("updated_by"),
        sa.Column("updated_at", TSTZ),
        sa.CheckConstraint("id = 1", name="org_settings_single_row"),
    )

    op.create_table(
        "votes",
        _user_fk("user_id", "CASCADE", nullable=False),
        sa.Column("opportunity_id", sa.Text, nullable=False),
        sa.Column("vote", sa.Text, nullable=False),
        sa.Column("reason", sa.Text, nullable=False, server_default=""),
        sa.Column("updated_at", TSTZ, nullable=False, server_default=NOW),
        sa.PrimaryKeyConstraint("user_id", "opportunity_id"),
        sa.CheckConstraint("vote in ('sirve', 'no_sirve')", name="votes_vote"),
    )

    op.create_table(
        "ingest_requests",
        _id(),
        sa.Column("status", sa.Text, nullable=False),
        _user_fk("requested_by"),
        sa.Column("requested_at", TSTZ, nullable=False, server_default=NOW),
        sa.Column("started_at", TSTZ),
        sa.Column("finished_at", TSTZ),
        sa.Column("error", sa.Text),
        sa.CheckConstraint("status in ('requested', 'running', 'done', 'failed')", name="ingest_requests_status"),
    )
    op.create_index(
        "ingest_requests_one_open",
        "ingest_requests",
        [sa.text("(true)")],
        unique=True,
        postgresql_where=sa.text("status in ('requested', 'running')"),
    )


def downgrade() -> None:
    for t in (
        "ingest_requests",
        "votes",
        "org_settings",
        "tracking_notes",
        "tracking",
        "password_resets",
        "invitations",
        "sessions",
        "users",
    ):
        op.drop_table(t)
