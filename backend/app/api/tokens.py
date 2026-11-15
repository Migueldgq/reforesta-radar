"""/api/me/tokens: the signed-in person's personal access tokens for the MCP server (app/auth/pats.py).

Session (cookie) only, like every /api/ route: a token can never create or list tokens. Creating and revoking are
POST/DELETE, so the CSRF rule applies. The token value is returned once, on creation.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException, Response
from pydantic import Field

from app.auth import pats
from app.auth.deps import Db, User
from app.config import settings
from app.models import CleanStr, Contract

log = logging.getLogger("auth")
router = APIRouter(tags=["tokens"])


class TokenInfo(Contract):
    id: int
    name: str
    created_at: str
    expires_at: str
    last_used_at: str | None


class TokensResponse(Contract):
    tokens: list[TokenInfo]  # usable ones only (not revoked, not expired), newest first
    mcp_url: str  # the URL to paste into the assistant
    public_tools: bool  # the public tools work without a token (RADAR_MCP_PUBLIC)


class TokenIn(Contract):
    name: Annotated[CleanStr, Field(min_length=1, max_length=100)]
    expires_in_days: Annotated[int, Field(ge=1, le=pats.MAX_DAYS)] = pats.DEFAULT_DAYS


class TokenCreated(Contract):
    token: TokenInfo
    secret: str  # `rr_pat_…`: shown once, never retrievable again


def _info(r) -> TokenInfo:  # noqa: ANN001
    return TokenInfo(id=r.id, name=r.name, created_at=r.created_at.isoformat(), expires_at=r.expires_at.isoformat(),
                     last_used_at=r.last_used_at.isoformat() if r.last_used_at else None)  # fmt: skip


@router.get("/api/me/tokens", response_model=TokensResponse)
async def list_tokens(user: User, conn: Db) -> TokensResponse:
    rows = await pats.list_tokens(conn, user.id)
    return TokensResponse(tokens=[_info(r) for r in rows], mcp_url=settings.mcp_public_url,
                          public_tools=settings.mcp_public)  # fmt: skip


@router.post("/api/me/tokens", response_model=TokenCreated, status_code=201, responses={400: {}, 409: {}})
async def create_token(body: TokenIn, user: User, conn: Db) -> TokenCreated:
    name = body.name.strip()
    if not name:
        raise HTTPException(400, detail="Ponle un nombre al token (por ejemplo, «Claude en mi portátil»).")
    if await pats.count_active(conn, user.id) >= pats.MAX_ACTIVE:
        raise HTTPException(409, detail=f"Ya tienes {pats.MAX_ACTIVE} tokens activos. Revoca alguno antes.")
    token_id, secret = await pats.create_token(conn, user.id, name, body.expires_in_days)
    (row,) = [r for r in await pats.list_tokens(conn, user.id) if r.id == token_id]
    log.info("personal token %d created by user %d (%d days)", token_id, user.id, body.expires_in_days)
    return TokenCreated(token=_info(row), secret=secret)


@router.delete("/api/me/tokens/{token_id}", status_code=204, responses={404: {}})
async def revoke_token(token_id: int, user: User, conn: Db) -> Response:
    """Only the owner's own active tokens (someone else's id answers 404)."""
    if not await pats.revoke_token(conn, user.id, token_id):
        raise HTTPException(404, detail="No tienes ningún token activo con ese id.")
    log.info("personal token %d revoked by user %d", token_id, user.id)
    return Response(status_code=204)
