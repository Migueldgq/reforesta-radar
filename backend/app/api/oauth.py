"""The web side of the assistants' sign-in (ADR 0035): the consent step and the list of connected assistants.

Session (cookie) only, like every /api/ route, and the CSRF rule applies to the POST/DELETE (X-Radar-CSRF). The
pending request id travels in the JSON body (never in an API path), and the request only opens in the browser that
started it at /oauth/authorize: its `radar_oauth` cookie must match (app/oauth/routes.py). A decision consumes the
request: the answer is the URL the browser goes to next (the assistant's registered redirect URI, with `code` or
`error=access_denied`, `state` and `iss`).
"""

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request, Response
from mcp.server.auth.provider import construct_redirect_uri
from pydantic import Field
from sqlalchemy import select, update

from app.auth.deps import Db, User
from app.config import settings
from app.db.tables import oauth_clients, oauth_grants
from app.models import Contract
from app.oauth import clients, provider
from app.oauth.routes import BROWSER_COOKIE, COOKIE_PATH, oauth_available

log = logging.getLogger("auth")
router = APIRouter(tags=["assistants"])

GONE = (
    "Esta solicitud ya no vale: ha caducado, ya se usó o se abrió en otro navegador. "
    "Vuelve a conectar desde tu asistente."
)

RequestId = Annotated[str, Field(min_length=1, max_length=100)]
Kind = Literal["conocido", "local", "desconocido"]


class ConsentIn(Contract):
    request: RequestId


class DecisionIn(Contract):
    request: RequestId
    allow: bool


class ConsentInfo(Contract):
    assistant: str  # the name the assistant gave itself (sanitised)
    kind: Kind  # conocido: Claude's own address; local: a program on this computer; desconocido: anything else
    redirect_host: str  # where the permission is sent


class DecisionOut(Contract):
    redirect_to: str


class Assistant(Contract):
    id: int
    name: str
    kind: Kind
    redirect_host: str
    created_at: str
    last_used_at: str | None


class AssistantsResponse(Contract):
    assistants: list[Assistant]  # connected (live grants), newest first
    team_url: str  # the address to paste for the team view (sign-in from the assistant)
    public_url: str  # the address without sign-in (public data only)
    sign_in: bool  # sign-in from the assistant is available (https issuer or local use)
    public_tools: bool


@router.post("/api/oauth/consent", response_model=ConsentInfo, responses={404: {}})
async def consent(body: ConsentIn, user: User, conn: Db, request: Request) -> ConsentInfo:
    pending = await provider.pending_request(conn, body.request, request.cookies.get(BROWSER_COOKIE))
    if pending is None:
        raise HTTPException(404, detail=GONE)
    return ConsentInfo(assistant=pending.client_name, kind=clients.kind_of(pending.redirect_uri),
                       redirect_host=clients.host_of(pending.redirect_uri))  # fmt: skip


@router.post("/api/oauth/consent/decision", response_model=DecisionOut, responses={404: {}})
async def decision(body: DecisionIn, user: User, conn: Db, request: Request, response: Response) -> DecisionOut:
    result = await provider.decide(conn, body.request, request.cookies.get(BROWSER_COOKIE) or "", user.id, body.allow)
    if result is None:
        raise HTTPException(404, detail=GONE)
    response.delete_cookie(
        BROWSER_COOKIE, path=COOKIE_PATH, httponly=True, samesite="lax", secure=settings.cookie_secure
    )
    uri, params = result
    return DecisionOut(redirect_to=construct_redirect_uri(uri, **params))


def _iso(dt) -> str | None:  # noqa: ANN001
    return dt.isoformat() if dt else None


def _kind(uris: list[str]) -> tuple[Kind, str]:
    kinds = {clients.kind_of(u) for u in uris}
    kind: Kind = kinds.pop() if len(kinds) == 1 else "desconocido"
    return kind, ", ".join(sorted({clients.host_of(u) for u in uris}))


@router.get("/api/me/assistants", response_model=AssistantsResponse)
async def assistants(user: User, conn: Db) -> AssistantsResponse:
    t = provider._now()
    rows = await conn.execute(
        select(
            oauth_grants.c.id,
            oauth_grants.c.created_at,
            oauth_grants.c.last_used_at,
            oauth_clients.c.name,
            oauth_clients.c.redirect_uris,
        )  # fmt: skip
        .join(oauth_clients, oauth_clients.c.client_id == oauth_grants.c.client_id)
        .where(
            oauth_grants.c.user_id == user.id,
            oauth_grants.c.revoked_at.is_(None),
            oauth_grants.c.expires_at > t,
            oauth_grants.c.last_used_at.is_not(None),  # tokens issued: not an approval whose code was never used
        )
        .order_by(oauth_grants.c.created_at.desc(), oauth_grants.c.id.desc())
    )
    items = []
    for r in rows:
        kind, host = _kind(r.redirect_uris)
        items.append(Assistant(id=r.id, name=r.name, kind=kind, redirect_host=host, created_at=r.created_at.isoformat(),
                               last_used_at=_iso(r.last_used_at)))  # fmt: skip
    return AssistantsResponse(assistants=items, team_url=settings.mcp_team_url, public_url=settings.mcp_public_url,
                              sign_in=oauth_available(), public_tools=settings.mcp_public)  # fmt: skip


@router.delete("/api/me/assistants/{grant_id}", status_code=204, responses={404: {}})
async def disconnect(grant_id: int, user: User, conn: Db) -> Response:
    """Only the person's own connected assistants (someone else's id answers 404)."""
    res = await conn.execute(
        update(oauth_grants)
        .where(oauth_grants.c.id == grant_id, oauth_grants.c.user_id == user.id, oauth_grants.c.revoked_at.is_(None))
        .values(revoked_at=provider._now())
    )
    if res.rowcount == 0:
        raise HTTPException(404, detail="No tienes ningún asistente conectado con ese id.")
    log.info("oauth: grant %d disconnected by user %d", grant_id, user.id)
    return Response(status_code=204)
