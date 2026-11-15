"""People: the admin's team screen (/api/team/*), the user list everyone needs (/api/users) and self-service
(/api/me/*). The last active admin can never be demoted or deactivated (there is no delete: deactivate instead)."""

import logging
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from pydantic import Field
from sqlalchemy import select, update

from app.api.auth import Me, Password, check_password
from app.auth import mail, throttle
from app.auth.accounts import (
    create_invitation,
    create_reset,
    find_user_id,
    invitation_link,
    normalize_email,
    reset_link,
    valid_email,
)
from app.auth.deps import Admin, Db, Role, User, client_ip, now, revoke_sessions, start_session
from app.auth.passwords import hash_password_async, verify_password_async
from app.config import settings
from app.db.tables import invitations, users
from app.models import Contract

log = logging.getLogger("auth")
router = APIRouter(tags=["team"])

LAST_ADMIN = "Tiene que quedar al menos un administrador activo."
NOT_FOUND = "No existe esa persona."


def _iso(dt) -> str | None:  # noqa: ANN001
    return dt.isoformat() if dt else None


class TeamUser(Contract):
    id: int
    email: str
    name: str
    role: Role
    active: bool
    created_at: str
    last_login_at: str | None


class PendingInvitation(Contract):
    id: int
    email: str
    name: str
    role: Role
    created_at: str
    expires_at: str
    created_by: int | None


class TeamResponse(Contract):
    users: list[TeamUser]
    invitations: list[PendingInvitation]  # pending only: not accepted, not revoked, not expired


class InviteIn(Contract):
    email: Annotated[str, Field(max_length=320)]
    name: Annotated[str, Field(max_length=100)] = ""
    role: Role = "member"


class LinkOut(Contract):
    link: str  # one-time link: shown once, never retrievable again
    expires_at: str
    emailed: bool  # also e-mailed (only when SMTP is configured)


class InviteOut(LinkOut):
    invitation: PendingInvitation


class UserPatch(Contract):
    role: Role | None = None
    active: bool | None = None


class Person(Contract):
    id: int
    name: str
    active: bool


class PeopleResponse(Contract):
    users: list[Person]


class NameIn(Contract):
    name: Annotated[str, Field(min_length=1, max_length=100)]


class PasswordChangeIn(Contract):
    current_password: Password
    new_password: Password


def _team_user(r) -> TeamUser:  # noqa: ANN001
    return TeamUser(id=r.id, email=r.email, name=r.name, role=r.role, active=r.active,
                    created_at=r.created_at.isoformat(), last_login_at=_iso(r.last_login_at))  # fmt: skip


def _pending(r) -> PendingInvitation:  # noqa: ANN001
    return PendingInvitation(id=r.id, email=r.email, name=r.name, role=r.role, created_at=r.created_at.isoformat(),
                             expires_at=r.expires_at.isoformat(), created_by=r.created_by)  # fmt: skip


@router.get("/api/team", response_model=TeamResponse)
async def team(_: Admin, conn: Db) -> TeamResponse:
    us = await conn.execute(select(users).order_by(users.c.active.desc(), users.c.name, users.c.id))
    invs = await conn.execute(
        select(invitations)
        .where(
            invitations.c.accepted_at.is_(None), invitations.c.revoked_at.is_(None), invitations.c.expires_at > now()
        )  # fmt: skip
        .order_by(invitations.c.created_at.desc())
    )
    return TeamResponse(users=[_team_user(r) for r in us], invitations=[_pending(r) for r in invs])


@router.post("/api/team/invitations", response_model=InviteOut, status_code=201, responses={400: {}, 409: {}})
async def invite(body: InviteIn, admin: Admin, conn: Db, tasks: BackgroundTasks) -> InviteOut:
    """Creates an invitation and returns its one-time link (only now). A new invitation to the same address replaces
    the pending one."""
    email = normalize_email(body.email)
    if not valid_email(email):
        raise HTTPException(400, detail="Ese correo no parece válido.")
    if await find_user_id(conn, email) is not None:
        raise HTTPException(409, detail="Ya hay una cuenta con ese correo.")
    inv_id, token = await create_invitation(conn, email, body.name, body.role, admin.id)
    row = (await conn.execute(select(invitations).where(invitations.c.id == inv_id))).one()
    link = invitation_link(token)
    if settings.email_enabled:
        tasks.add_task(mail.invitation_mail, email, link)
    log.info("invitation %d created by user %d (%s)", inv_id, admin.id, body.role)
    return InviteOut(invitation=_pending(row), link=link, expires_at=row.expires_at.isoformat(),
                     emailed=settings.email_enabled)  # fmt: skip


@router.delete("/api/team/invitations/{invitation_id}", status_code=204, responses={404: {}})
async def revoke_invitation(invitation_id: int, admin: Admin, conn: Db) -> Response:
    res = await conn.execute(
        update(invitations)
        .where(
            invitations.c.id == invitation_id, invitations.c.accepted_at.is_(None), invitations.c.revoked_at.is_(None)
        )  # fmt: skip
        .values(revoked_at=now())
    )
    if res.rowcount == 0:
        raise HTTPException(404, detail="No hay ninguna invitación pendiente con ese id.")
    log.info("invitation %d revoked by user %d", invitation_id, admin.id)
    return Response(status_code=204)


@router.patch(
    "/api/team/users/{user_id}", response_model=TeamUser, responses={404: {}, 409: {"description": LAST_ADMIN}}
)
async def patch_user(user_id: int, body: UserPatch, admin: Admin, conn: Db) -> TeamUser:
    """Change role and/or deactivate / reactivate. Role change and deactivation end the person's sessions."""
    # lock every active admin row: two concurrent demotions cannot both pass the "another admin remains" check
    admins = {r.id for r in await conn.execute(
        select(users.c.id).where(users.c.role == "admin", users.c.active).with_for_update())}  # fmt: skip
    target = (await conn.execute(select(users).where(users.c.id == user_id).with_for_update())).first()
    if target is None:
        raise HTTPException(404, detail=NOT_FOUND)
    role = body.role if body.role is not None else target.role
    active = body.active if body.active is not None else target.active
    if target.id in admins and (role != "admin" or not active) and len(admins) <= 1:
        raise HTTPException(409, detail=LAST_ADMIN)
    if (role, active) != (target.role, target.active):
        await conn.execute(update(users).where(users.c.id == user_id).values(role=role, active=active))
        if role != target.role or not active:
            await revoke_sessions(conn, user_id)
        log.info("user %d changed by user %d: role %s->%s active %s->%s",
                 user_id, admin.id, target.role, role, target.active, active)  # fmt: skip
    row = (await conn.execute(select(users).where(users.c.id == user_id))).one()
    return _team_user(row)


@router.post("/api/team/users/{user_id}/reset-link", response_model=LinkOut, status_code=201, responses={404: {}})
async def make_reset_link(user_id: int, admin: Admin, conn: Db, tasks: BackgroundTasks) -> LinkOut:
    """One-time password-reset link for an active user (24 h). Earlier links of that user stop working."""
    row = (await conn.execute(select(users.c.id, users.c.email).where(users.c.id == user_id, users.c.active))).first()
    if row is None:
        raise HTTPException(404, detail=NOT_FOUND)
    token, expires = await create_reset(conn, user_id, admin.id)
    link = reset_link(token)
    if settings.email_enabled:
        tasks.add_task(mail.reset_mail, row.email, link)
    log.info("reset link for user %d created by user %d", user_id, admin.id)
    return LinkOut(link=link, expires_at=expires, emailed=settings.email_enabled)


@router.get("/api/users", response_model=PeopleResponse)
async def people(_: User, conn: Db) -> PeopleResponse:
    """Everyone's id and name (assignee picker, note and vote authors). Inactive people stay listed (old notes)."""
    rows = await conn.execute(select(users.c.id, users.c.name, users.c.active).order_by(users.c.name, users.c.id))
    return PeopleResponse(users=[Person(id=r.id, name=r.name, active=r.active) for r in rows])


@router.patch("/api/me", response_model=Me)
async def rename_me(body: NameIn, user: User, conn: Db) -> Me:
    name = body.name.strip()
    if not name:
        raise HTTPException(400, detail="El nombre no puede estar vacío.")
    await conn.execute(update(users).where(users.c.id == user.id).values(name=name))
    return Me(id=user.id, email=user.email, name=name, role=user.role)


@router.post("/api/me/password", status_code=204, responses={400: {}, 429: {}})
async def change_password(body: PasswordChangeIn, user: User, conn: Db, request: Request) -> Response:
    """Needs the current password (5 wrong ones per 15 min for this user; login is not affected). Ends every
    session and starts a fresh one here."""
    key = str(user.id)
    if wait := throttle.password_change.retry_after(key):
        raise HTTPException(429, detail="Demasiados intentos. Espera unos minutos.", headers={"Retry-After": str(wait)})
    stamp = throttle.password_change.hit(key)  # before the awaited check: no race
    stored = (await conn.execute(select(users.c.password_hash).where(users.c.id == user.id))).scalar_one()
    if not await verify_password_async(stored, body.current_password):
        log.info("password change: wrong current password user=%d ip=%s", user.id, client_ip(request))
        raise HTTPException(400, detail="La contraseña actual no es correcta.")
    throttle.password_change.undo(key, stamp)
    check_password(body.new_password)
    new_hash = await hash_password_async(body.new_password)
    await conn.execute(update(users).where(users.c.id == user.id).values(password_hash=new_hash))
    await revoke_sessions(conn, user.id)
    res = Response(status_code=204)
    await start_session(conn, res, user.id)
    log.info("password changed: user %d", user.id)
    return res
