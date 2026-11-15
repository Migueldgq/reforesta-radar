"""/api/auth/*: login, logout, session info, invitation and password-reset links. No session required here.

Tokens travel in JSON bodies, never in API paths, so access logs never hold them. Every invalid, expired, used or
revoked link gets the same 404, and login failures the same 401, whatever the reason.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from pydantic import Field
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.auth import mail, throttle
from app.auth.accounts import create_reset, create_user, normalize_email, reset_link, valid_email
from app.auth.deps import (
    COOKIE,
    Db,
    Role,
    clear_session_cookie,
    client_ip,
    now,
    revoke_sessions,
    session_user,
    start_session,
)
from app.auth.passwords import (
    hash_password_async,
    needs_rehash,
    password_problem,
    verify_password_async,
)
from app.auth.tokens import hash_token
from app.config import settings
from app.db.tables import invitations, password_resets, sessions, users
from app.models import Contract

log = logging.getLogger("auth")
router = APIRouter(tags=["auth"])

BAD_LOGIN = "Correo o contraseña incorrectos."
TOO_MANY = "Demasiados intentos. Espera unos minutos y vuelve a probar."
BAD_LINK = "El enlace no es válido o ha caducado. Pide uno nuevo a un administrador."
ACCOUNT_EXISTS = "Ya existe una cuenta con ese correo. Inicia sesión."

Token = Annotated[str, Field(min_length=1, max_length=200)]
Password = Annotated[str, Field(max_length=1024)]  # length rule checked by hand for a Spanish message


class Me(Contract):
    id: int
    email: str
    name: str
    role: Role


class SessionInfo(Contract):
    user: Me | None
    forgot_password: bool  # self-service "forgot password" available (only when e-mail is configured)


class LoginIn(Contract):
    email: Annotated[str, Field(max_length=320)]
    password: Password


class TokenIn(Contract):
    token: Token


class InvitationInfo(Contract):
    email: str
    name: str
    role: Role
    expires_at: str


class AcceptInvitationIn(Contract):
    token: Token
    name: Annotated[str, Field(max_length=100)] = ""
    password: Password


class ResetInfo(Contract):
    email: str
    expires_at: str


class AcceptResetIn(Contract):
    token: Token
    password: Password


class ForgotIn(Contract):
    email: Annotated[str, Field(max_length=320)]


def check_password(password: str) -> None:
    if problem := password_problem(password):
        raise HTTPException(400, detail=problem)


def _session_info(user: Me | None) -> SessionInfo:
    return SessionInfo(user=user, forgot_password=settings.email_enabled)


@router.get("/api/auth/session", response_model=SessionInfo)
async def session(conn: Db, request: Request, response: Response) -> SessionInfo:
    """The logged-in user, or `user: null`. Always 200."""
    u = await session_user(conn, request, response)
    return _session_info(Me(id=u.id, email=u.email, name=u.name, role=u.role) if u else None)


@router.post("/api/auth/login", response_model=SessionInfo, responses={401: {"description": BAD_LOGIN}, 429: {}})
async def login(body: LoginIn, conn: Db, request: Request, response: Response) -> SessionInfo:
    email, ip = normalize_email(body.email), client_ip(request)
    wait = throttle.by_account.retry_after(email) or throttle.by_ip.retry_after(ip)
    if wait:
        log.warning("login throttled ip=%s", ip)
        raise HTTPException(429, detail=TOO_MANY, headers={"Retry-After": str(wait)})
    row = (await conn.execute(select(users).where(func.lower(users.c.email) == email))).first()
    stored = row.password_hash if row is not None and row.active else None
    if not await verify_password_async(stored, body.password):  # dummy hash when there is no usable account
        throttle.by_account.hit(email)
        throttle.by_ip.hit(ip)
        log.info("login failed user=%s ip=%s", row.id if row is not None else "unknown", ip)
        raise HTTPException(401, detail=BAD_LOGIN)
    assert row is not None
    throttle.by_account.reset(email)
    values: dict[str, object] = {"last_login_at": now()}
    if needs_rehash(row.password_hash):
        values["password_hash"] = await hash_password_async(body.password)
    await conn.execute(update(users).where(users.c.id == row.id).values(**values))
    await start_session(conn, response, row.id)
    log.info("login ok user=%d ip=%s", row.id, ip)
    return _session_info(Me(id=row.id, email=row.email, name=row.name, role=row.role))


@router.post("/api/auth/logout", status_code=204)
async def logout(conn: Db, request: Request) -> Response:
    """Ends this session (server side too) and clears the cookie. 204 even without a session."""
    if token := request.cookies.get(COOKIE):
        await conn.execute(sessions.delete().where(sessions.c.token_hash == hash_token(token)))
    res = Response(status_code=204)
    clear_session_cookie(res)
    return res


async def _invitation(conn: Db, token: str, lock: bool = False):  # noqa: ANN202 - a Row
    q = select(invitations).where(
        invitations.c.token_hash == hash_token(token),
        invitations.c.accepted_at.is_(None),
        invitations.c.revoked_at.is_(None),
        invitations.c.expires_at > now(),
    )
    row = (await conn.execute(q.with_for_update() if lock else q)).first()
    if row is None:
        raise HTTPException(404, detail=BAD_LINK)
    return row


@router.post("/api/auth/invitation", response_model=InvitationInfo, responses={404: {"description": BAD_LINK}})
async def invitation_info(body: TokenIn, conn: Db) -> InvitationInfo:
    """What an invitation link is for (the e-mail is fixed; the page shows it read-only)."""
    inv = await _invitation(conn, body.token)
    return InvitationInfo(email=inv.email, name=inv.name, role=inv.role, expires_at=inv.expires_at.isoformat())


@router.post(
    "/api/auth/invitation/accept",
    response_model=SessionInfo,
    status_code=201,
    responses={400: {}, 404: {"description": BAD_LINK}, 409: {"description": ACCOUNT_EXISTS}},
)
async def accept_invitation(body: AcceptInvitationIn, conn: Db, response: Response) -> SessionInfo:
    """Creates the account with the invitation's e-mail and role, uses up the link and logs in."""
    inv = await _invitation(conn, body.token, lock=True)
    check_password(body.password)
    name = body.name.strip() or inv.name
    try:
        async with conn.begin_nested():
            user_id = await create_user(conn, inv.email, name, inv.role, body.password)
    except IntegrityError:
        raise HTTPException(409, detail=ACCOUNT_EXISTS) from None
    await conn.execute(update(invitations).where(invitations.c.id == inv.id).values(accepted_at=now()))
    await start_session(conn, response, user_id)
    log.info("invitation %d accepted: user %d (%s)", inv.id, user_id, inv.role)
    return _session_info(Me(id=user_id, email=inv.email, name=name, role=inv.role))


async def _reset(conn: Db, token: str, lock: bool = False):  # noqa: ANN202 - a Row
    q = (
        select(
            password_resets.c.id,
            password_resets.c.expires_at,
            users.c.id.label("user_id"),
            users.c.email,
            users.c.name,
            users.c.role,
        )  # fmt: skip
        .join(users, users.c.id == password_resets.c.user_id)
        .where(
            password_resets.c.token_hash == hash_token(token),
            password_resets.c.used_at.is_(None),
            password_resets.c.expires_at > now(),
            users.c.active,
        )
    )
    row = (await conn.execute(q.with_for_update(of=password_resets) if lock else q)).first()
    if row is None:
        raise HTTPException(404, detail=BAD_LINK)
    return row


@router.post("/api/auth/reset", response_model=ResetInfo, responses={404: {"description": BAD_LINK}})
async def reset_info(body: TokenIn, conn: Db) -> ResetInfo:
    r = await _reset(conn, body.token)
    return ResetInfo(email=r.email, expires_at=r.expires_at.isoformat())


@router.post(
    "/api/auth/reset/accept",
    response_model=SessionInfo,
    responses={400: {}, 404: {"description": BAD_LINK}},
)
async def accept_reset(body: AcceptResetIn, conn: Db, response: Response) -> SessionInfo:
    """Sets the new password, uses up the link, ends every other session of the user and logs in."""
    r = await _reset(conn, body.token, lock=True)
    check_password(body.password)
    await conn.execute(
        update(users).where(users.c.id == r.user_id).values(password_hash=await hash_password_async(body.password))
    )
    await conn.execute(update(password_resets).where(password_resets.c.id == r.id).values(used_at=now()))
    await revoke_sessions(conn, r.user_id)
    throttle.by_account.reset(r.email)
    await start_session(conn, response, r.user_id)
    log.info("password reset used: user %d", r.user_id)
    return _session_info(Me(id=r.user_id, email=r.email, name=r.name, role=r.role))


@router.post("/api/auth/forgot", status_code=202, responses={404: {"description": "e-mail not configured"}, 429: {}})
async def forgot(body: ForgotIn, conn: Db, request: Request, tasks: BackgroundTasks) -> dict[str, bool]:
    """Self-service reset, only when SMTP is configured. Always 202: never says whether the address has an account
    (the e-mail goes out in the background, after the response)."""
    if not settings.email_enabled:
        raise HTTPException(404, detail="El restablecimiento por correo no está activado. Pídeselo a un administrador.")
    email, ip = normalize_email(body.email), client_ip(request)
    if throttle.forgot_by_ip.retry_after(ip):
        raise HTTPException(429, detail=TOO_MANY)
    throttle.forgot_by_ip.hit(ip)
    if not valid_email(email) or throttle.forgot_by_account.retry_after(email):
        return {"ok": True}
    throttle.forgot_by_account.hit(email)
    row = (await conn.execute(select(users.c.id).where(func.lower(users.c.email) == email, users.c.active))).first()
    if row is not None:
        token, _ = await create_reset(conn, row.id, None)
        tasks.add_task(mail.reset_mail, email, reset_link(token))
        log.info("self-service reset link e-mailed: user %d", row.id)
    return {"ok": True}
