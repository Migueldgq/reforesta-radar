"""Sessions and the authorisation dependencies every protected route goes through.

- Session = opaque random token in an HttpOnly, SameSite=Lax cookie (`radar_session`); the database keeps only its
  sha256. Server-side expiry: `RADAR_SESSION_DAYS` (30) after the last use (sliding; pushed forward at most once an
  hour, so a busy page does not write on every request).
- `current_user` answers 401 without a valid session (missing, unknown, expired, revoked or inactive user);
  `require_admin` answers 403 for members.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from app.auth import pats
from app.auth.tokens import hash_token, new_token
from app.config import settings
from app.db.tables import sessions, users

COOKIE = "radar_session"
SLIDE_EVERY = timedelta(hours=1)
NOT_LOGGED_IN = "No has iniciado sesión o la sesión ha caducado."
ADMINS_ONLY = "Solo un administrador puede hacer esto."

Role = Literal["admin", "member"]


async def db(request: Request) -> AsyncIterator[AsyncConnection]:
    """One transaction per request: committed when the handler returns, rolled back when it raises."""
    async with request.app.state.engine.begin() as conn:
        yield conn


# scope="function": the transaction commits before the response is sent (a client that logs in and immediately
# calls another route must see the new session).
Db = Annotated[AsyncConnection, Depends(db, scope="function")]


@dataclass(frozen=True)
class CurrentUser:
    id: int
    email: str
    name: str
    role: Role
    session_id: int

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def now() -> datetime:
    return datetime.now(UTC)


def client_ip(request: Request) -> str:
    # uvicorn rewrites request.client from X-Forwarded-For for FORWARDED_ALLOW_IPS (see docs/api-auth.md)
    return request.client.host if request.client else "unknown"


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE,
        token,
        max_age=settings.session_days * 86400,
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/", httponly=True, samesite="lax", secure=settings.cookie_secure)


async def start_session(conn: AsyncConnection, response: Response, user_id: int) -> None:
    token, token_hash = new_token()
    t = now()
    await conn.execute(
        insert(sessions).values(
            token_hash=token_hash,
            user_id=user_id,
            created_at=t,
            last_seen_at=t,
            expires_at=t + timedelta(days=settings.session_days),
        )
    )
    set_session_cookie(response, token)


async def revoke_sessions(conn: AsyncConnection, user_id: int) -> None:
    """Ends every session of the user (logout everywhere) and revokes their personal access tokens (MCP)."""
    await conn.execute(delete(sessions).where(sessions.c.user_id == user_id))
    await pats.revoke_all(conn, user_id)


async def session_user(conn: AsyncConnection, request: Request, response: Response) -> CurrentUser | None:
    token = request.cookies.get(COOKIE)
    if not token or len(token) > 200:
        return None
    t = now()
    row = (
        await conn.execute(
            select(
                sessions.c.id.label("session_id"),
                sessions.c.last_seen_at,
                users.c.id,
                users.c.email,
                users.c.name,
                users.c.role,
            )
            .join(users, users.c.id == sessions.c.user_id)
            .where(sessions.c.token_hash == hash_token(token), sessions.c.expires_at > t, users.c.active)
        )
    ).first()
    if row is None:
        return None
    if t - row.last_seen_at > SLIDE_EVERY:
        await conn.execute(
            update(sessions)
            .where(sessions.c.id == row.session_id)
            .values(last_seen_at=t, expires_at=t + timedelta(days=settings.session_days))
        )
        set_session_cookie(response, token)
    return CurrentUser(id=row.id, email=row.email, name=row.name, role=row.role, session_id=row.session_id)


async def current_user(conn: Db, request: Request, response: Response) -> CurrentUser:
    user = await session_user(conn, request, response)
    if user is None:
        raise HTTPException(401, detail=NOT_LOGGED_IN)
    return user


async def require_admin(user: Annotated[CurrentUser, Depends(current_user)]) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(403, detail=ADMINS_ONLY)
    return user


User = Annotated[CurrentUser, Depends(current_user)]
Admin = Annotated[CurrentUser, Depends(require_admin)]
