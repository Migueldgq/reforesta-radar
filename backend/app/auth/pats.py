"""Personal access tokens (PAT) for the read-only MCP server at /mcp (docs/mcp.md, ADR 0027).

- A signed-in person creates one in "Mi cuenta" (cookie session + CSRF, /api/me/tokens). It is shown once:
  `rr_pat_` + 43 URL-safe characters (32 random bytes). The database keeps only its sha256 (app/auth/tokens.py).
- Every token expires (1-365 days, 90 by default) and can be revoked by its owner. It stops working at once when
  the account is deactivated, and it is revoked whenever all the person's sessions are ended (password change or
  reset, role change, deactivation: `revoke_sessions`).
- It only opens /mcp (read-only tools). It never opens /api/*: those routes read the session cookie only.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from app.auth.tokens import hash_token, new_token
from app.db.tables import personal_tokens, users

PREFIX = "rr_pat_"
TOKEN_LENGTH = len(PREFIX) + 43
DEFAULT_DAYS = 90
MAX_DAYS = 365
MAX_ACTIVE = 20  # per person
USED_EVERY = timedelta(minutes=5)  # last_used_at is written at most this often


@dataclass(frozen=True)
class TokenUser:
    user_id: int
    name: str
    token_id: int


def _now() -> datetime:
    return datetime.now(UTC)


def looks_like_token(token: str) -> bool:
    return len(token) == TOKEN_LENGTH and token.startswith(PREFIX)


def _active(t: datetime):  # noqa: ANN202 - SQL expression
    return (personal_tokens.c.revoked_at.is_(None)) & (personal_tokens.c.expires_at > t)


async def count_active(conn: AsyncConnection, user_id: int) -> int:
    q = select(func.count()).select_from(personal_tokens).where(personal_tokens.c.user_id == user_id, _active(_now()))
    return (await conn.execute(q)).scalar_one()


async def create_token(conn: AsyncConnection, user_id: int, name: str, days: int) -> tuple[int, str]:
    """(token id, the token itself: shown once, never stored)."""
    secret, _ = new_token()
    token = PREFIX + secret
    t = _now()
    token_id = (
        await conn.execute(
            insert(personal_tokens)
            .values(
                user_id=user_id,
                name=name.strip(),
                token_hash=hash_token(token),
                created_at=t,
                expires_at=t + timedelta(days=days),
            )  # fmt: skip
            .returning(personal_tokens.c.id)
        )
    ).scalar_one()
    return token_id, token


async def list_tokens(conn: AsyncConnection, user_id: int):  # noqa: ANN201 - rows
    """The person's usable tokens (not revoked, not expired), newest first."""
    q = (
        select(
            personal_tokens.c.id,
            personal_tokens.c.name,
            personal_tokens.c.created_at,
            personal_tokens.c.expires_at,
            personal_tokens.c.last_used_at,
        )  # fmt: skip
        .where(personal_tokens.c.user_id == user_id, _active(_now()))
        .order_by(personal_tokens.c.created_at.desc(), personal_tokens.c.id.desc())
    )
    return list(await conn.execute(q))


async def revoke_token(conn: AsyncConnection, user_id: int, token_id: int) -> bool:
    res = await conn.execute(
        update(personal_tokens)
        .where(personal_tokens.c.id == token_id, personal_tokens.c.user_id == user_id, _active(_now()))
        .values(revoked_at=_now())
    )
    return res.rowcount > 0


async def revoke_all(conn: AsyncConnection, user_id: int) -> None:
    await conn.execute(
        update(personal_tokens)
        .where(personal_tokens.c.user_id == user_id, personal_tokens.c.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


async def token_user(conn: AsyncConnection, token: str) -> TokenUser | None:
    """The active person a token belongs to, or None (malformed, unknown, revoked, expired, deactivated account).
    Records the use (at most every USED_EVERY)."""
    if not looks_like_token(token):
        return None
    t = _now()
    row = (
        await conn.execute(
            select(personal_tokens.c.id, personal_tokens.c.last_used_at, users.c.id.label("user_id"), users.c.name)
            .join(users, users.c.id == personal_tokens.c.user_id)
            .where(personal_tokens.c.token_hash == hash_token(token), _active(t), users.c.active)
        )
    ).first()
    if row is None:
        return None
    if row.last_used_at is None or t - row.last_used_at > USED_EVERY:
        await conn.execute(update(personal_tokens).where(personal_tokens.c.id == row.id).values(last_used_at=t))
    return TokenUser(user_id=row.user_id, name=row.name, token_id=row.id)
