"""Organism display names (app/sources/names.py): rewrite the names already stored.

The ingest now stores "Comunidad de Madrid" instead of "COMUNIDAD DE MADRID" and one name per organism across
sources. Rewrites, with the same function: `opportunities.organismo` (column and `data`), the board snapshots
(`tracking.organismo`) and the team's saved organism filter (`org_settings.organisms`), which stores names and would
otherwise stop matching. Content hashes are left alone: the next ingest records the rename once as a change.
Not reversible (the original capitals are not kept); downgrade does nothing.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-15
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.sources.names import organism_name

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("select id, organismo from opportunities")).all()
    for oid, name in rows:
        new = organism_name(name)
        if new != name:
            conn.execute(
                sa.text(
                    "update opportunities set organismo = :n, "
                    "data = jsonb_set(data, '{organismo}', to_jsonb(cast(:j as text))) where id = :id"
                ),
                {"n": new, "j": new, "id": oid},
            )
    for oid, name in conn.execute(sa.text("select opportunity_id, organismo from tracking")).all():
        if (new := organism_name(name)) != name:
            conn.execute(
                sa.text("update tracking set organismo = :n where opportunity_id = :id"), {"n": new, "id": oid}
            )
    saved = conn.execute(sa.text("select organisms from org_settings where id = 1")).scalar()
    if saved:
        renamed = list(dict.fromkeys(organism_name(n) for n in saved))
        if renamed != saved:
            conn.execute(
                sa.text("update org_settings set organisms = cast(:o as jsonb) where id = 1"),
                {"o": json.dumps(renamed, ensure_ascii=False)},
            )


def downgrade() -> None:
    pass
