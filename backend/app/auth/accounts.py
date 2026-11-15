"""Accounts: users, invitations and password-reset links, shared by the routes, the CLI and the bootstrap."""

import logging
import re
from datetime import timedelta

from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from app.auth.deps import Role, now
from app.auth.passwords import hash_password_async, password_problem
from app.auth.tokens import new_token
from app.config import settings
from app.db.tables import invitations, password_resets, users

log = logging.getLogger("auth")

INVITATION_TTL = timedelta(days=7)
RESET_TTL = timedelta(days=1)
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
INVITATION_PATH = "/invitacion/"
RESET_PATH = "/restablecer/"


def normalize_email(email: str) -> str:
    return email.strip().lower()


def valid_email(email: str) -> bool:
    return len(email) <= 254 and EMAIL_RE.match(email) is not None


def invitation_link(token: str) -> str:
    return f"{settings.public_url}{INVITATION_PATH}{token}"


def reset_link(token: str) -> str:
    return f"{settings.public_url}{RESET_PATH}{token}"


async def find_user_id(conn: AsyncConnection, email: str) -> int | None:
    return (await conn.execute(select(users.c.id).where(func.lower(users.c.email) == normalize_email(email)))).scalar()


async def create_user(conn: AsyncConnection, email: str, name: str, role: Role, password: str) -> int:
    """Inserts a user (the caller checked the password length). Raises IntegrityError on a duplicate e-mail."""
    return (
        await conn.execute(
            insert(users)
            .values(
                email=normalize_email(email),
                name=name.strip(),
                role=role,
                password_hash=await hash_password_async(password),
            )
            .returning(users.c.id)
        )
    ).scalar_one()


async def create_invitation(
    conn: AsyncConnection, email: str, name: str, role: Role, created_by: int
) -> tuple[int, str]:
    """(invitation id, one-time token). Revokes earlier pending invitations to the same address."""
    email, t = normalize_email(email), now()
    await conn.execute(
        update(invitations)
        .where(invitations.c.email == email, invitations.c.accepted_at.is_(None), invitations.c.revoked_at.is_(None))
        .values(revoked_at=t)
    )
    token, token_hash = new_token()
    inv_id = (
        await conn.execute(
            insert(invitations)
            .values(
                email=email,
                name=name.strip(),
                role=role,
                token_hash=token_hash,
                created_by=created_by,
                created_at=t,
                expires_at=t + INVITATION_TTL,
            )
            .returning(invitations.c.id)
        )
    ).scalar_one()
    return inv_id, token


async def create_reset(conn: AsyncConnection, user_id: int, created_by: int | None) -> tuple[str, str]:
    """(one-time token, expiry ISO). Earlier unused reset links of the user stop working."""
    t = now()
    await conn.execute(
        update(password_resets)
        .where(password_resets.c.user_id == user_id, password_resets.c.used_at.is_(None))
        .values(used_at=t)
    )
    token, token_hash = new_token()
    expires = t + RESET_TTL
    await conn.execute(
        insert(password_resets).values(
            user_id=user_id, token_hash=token_hash, created_by=created_by, created_at=t, expires_at=expires
        )
    )
    return token, expires.isoformat()


async def bootstrap_admin(engine: AsyncEngine) -> None:
    """RADAR_BOOTSTRAP_ADMIN_EMAIL/_PASSWORD: create the first admin, only while the users table is empty."""
    email, password = normalize_email(settings.bootstrap_admin_email), settings.bootstrap_admin_password
    if not email or not password:
        return
    if not valid_email(email) or (problem := password_problem(password)):
        log.error("bootstrap admin not created: %s", "invalid e-mail" if not valid_email(email) else problem)
        return
    async with engine.begin() as conn:
        await conn.execute(select(func.pg_advisory_xact_lock(4004)))  # two API starts at once: one creates it
        if (await conn.execute(select(func.count()).select_from(users))).scalar_one():
            return
        user_id = await create_user(conn, email, "", "admin", password)
    log.warning("bootstrap: first admin created (user %d); remove RADAR_BOOTSTRAP_ADMIN_* from the env", user_id)
