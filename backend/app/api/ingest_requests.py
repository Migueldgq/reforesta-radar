"""Admin "update now": the API only records a request; ingest-scheduler claims it within ~30 s and runs the ingest
(the API container never fetches sources). At most one request is open (requested or running) at a time: a unique
partial index enforces it, so double clicks and two admins at once cannot pile up runs."""

import logging
from datetime import datetime
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError

from app.api.state import last_ingest
from app.auth.deps import Admin, Db, User
from app.db.tables import ingest_requests, users
from app.models import Contract

log = logging.getLogger("ingest-request")
router = APIRouter(tags=["ingest"])

ALREADY_OPEN = "Ya hay una actualización pedida o en marcha."


class IngestRequest(Contract):
    id: int
    status: Literal["requested", "running", "done", "failed"]
    requested_by: str | None  # name
    requested_at: str
    started_at: str | None
    finished_at: str | None
    error: str | None


class IngestStatus(Contract):
    latest: IngestRequest | None
    last_ingest_at: str | None  # latest successful ingest of any trigger (daily, manual, request)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


async def _latest(conn: Db) -> IngestRequest | None:
    r = (
        await conn.execute(
            select(ingest_requests, users.c.name)
            .outerjoin(users, users.c.id == ingest_requests.c.requested_by)
            .order_by(ingest_requests.c.id.desc())
            .limit(1)
        )
    ).first()
    if r is None:
        return None
    return IngestRequest(id=r.id, status=r.status, requested_by=r.name, requested_at=r.requested_at.isoformat(),
                         started_at=_iso(r.started_at), finished_at=_iso(r.finished_at), error=r.error)  # fmt: skip


@router.get("/api/ingest", response_model=IngestStatus)
async def ingest_status(_: User, conn: Db) -> IngestStatus:
    """Poll this (every few seconds while `latest.status` is requested/running)."""
    last, _stale = await last_ingest(conn)
    return IngestStatus(latest=await _latest(conn), last_ingest_at=last)


@router.post("/api/ingest", response_model=IngestStatus, status_code=202, responses={409: {"model": IngestStatus}})
async def request_ingest(admin: Admin, conn: Db) -> IngestStatus | JSONResponse:
    """Ask ingest-scheduler for a run now. 409 (with the open request) when one is already requested or running."""
    try:
        async with conn.begin_nested():
            await conn.execute(insert(ingest_requests).values(status="requested", requested_by=admin.id))
    except IntegrityError:
        last, _stale = await last_ingest(conn)
        body = IngestStatus(latest=await _latest(conn), last_ingest_at=last).to_json()
        return JSONResponse({"detail": ALREADY_OPEN, **body}, status_code=409)
    log.info("ingest requested by user %d", admin.id)
    last, _stale = await last_ingest(conn)
    return IngestStatus(latest=await _latest(conn), last_ingest_at=last)
