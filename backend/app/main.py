"""FastAPI app: the read API the Next.js frontend calls. OpenAPI docs at /docs.

Requests never fan out to the sources: the ingest fills Postgres, the API reads it and applies the read-time
fit (geographic + kind) and ranking on every response.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.api.state import last_ingest, read_sources, read_state
from app.config import settings
from app.db.session import make_engine
from app.models import OpportunitiesResponse, SourcesResponse
from app.scoring.rank import rank

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.engine = make_engine()
    yield
    await app.state.engine.dispose()


app = FastAPI(title="Reforesta Radar API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET"], allow_headers=["*"])


def _engine(request: Request) -> AsyncEngine:
    return request.app.state.engine


@app.get("/health")
async def health(request: Request) -> dict[str, str]:
    try:
        async with _engine(request).connect() as conn:
            await conn.execute(text("select 1"))
    except Exception as e:
        raise HTTPException(503, detail=f"database unavailable: {type(e).__name__}") from e
    return {"status": "ok", "database": "ok"}


@app.get("/api/oportunidades", response_model=OpportunitiesResponse)
async def oportunidades(request: Request, response: Response) -> OpportunitiesResponse:
    """Stored base items with geographic + kind fit applied, ranked. Same shape as the TS route."""
    try:
        async with _engine(request).connect() as conn:
            state = await read_state(conn)
    except Exception as e:
        log.exception("postgres read failed")
        raise HTTPException(503, detail=f"Base de datos no disponible ({type(e).__name__}).") from e
    response.headers["Cache-Control"] = "private, max-age=30, stale-while-revalidate=300"
    return OpportunitiesResponse(
        items=rank(state.items),
        sources=state.sources,
        fetched_at=state.last_ingest_at or "1970-01-01T00:00:00.000Z",
        cached=True,
        stale=False,
        refreshing=False,
        storage="postgres",
        last_ingest_at=state.last_ingest_at,
        ingest_stale=state.ingest_stale,
    )


@app.get("/api/fuentes", response_model=SourcesResponse)
async def fuentes(request: Request) -> SourcesResponse:
    """Health of every source from its latest ingest run."""
    try:
        async with _engine(request).connect() as conn:
            sources = await read_sources(conn)
            last, _ = await last_ingest(conn)
    except Exception as e:
        log.exception("postgres read failed")
        raise HTTPException(503, detail=f"Base de datos no disponible ({type(e).__name__}).") from e
    return SourcesResponse(sources=sources, last_ingest_at=last)
