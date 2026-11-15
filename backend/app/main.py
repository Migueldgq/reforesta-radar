"""FastAPI app: the API the Next.js frontend calls. OpenAPI docs at /docs.

Requests never fan out to the sources: the ingest fills Postgres, the API reads it and applies the read-time
fit (geographic + kind) and ranking on every response.

Access (docs/api-auth.md): everything under /api/ needs a session, except /api/auth/* and /api/public/*; /health
is open. State-changing /api/ requests must pass the CSRF check (app/auth/csrf.py). /mcp is the read-only MCP server
(app/mcp/http.py, docs/mcp.md): public tools without credentials, team tools with a personal access token; it never
reads the session cookie.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from starlette.routing import Route

from app.api import analyze_pdf, auth, board, ingest_requests, perfil, team, tokens
from app.api.state import last_ingest, read_sources, read_state
from app.auth.accounts import bootstrap_admin
from app.auth.csrf import csrf_middleware
from app.auth.deps import current_user
from app.body_limit import BodyLimitMiddleware
from app.config import settings
from app.db.session import make_engine
from app.mcp.http import endpoint as mcp_endpoint
from app.models import OpportunitiesResponse, SourcesResponse
from app.scoring.rank import rank

log = logging.getLogger(__name__)
# app loggers (auth audit lines, read errors) next to uvicorn's own; never tokens or passwords
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.engine = make_engine()
    await bootstrap_admin(app.state.engine)
    async with mcp_endpoint.run():
        yield
    await app.state.engine.dispose()


app = FastAPI(title="Reforesta Radar API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST"], allow_headers=["*"]
)
app.middleware("http")(csrf_middleware)
app.add_middleware(BodyLimitMiddleware)  # added last = runs first: oversized bodies never reach routing

# Open: /health, /api/auth/*, /api/public/*. Everything else needs a session (admin routes check the role too).
app.include_router(auth.router)
signed_in = [Depends(current_user)]
no_session: dict[int | str, dict[str, Any]] = {401: {"description": "No valid session (`radar_session` cookie)"}}
for r in (analyze_pdf, perfil, team, tokens, board, ingest_requests):
    app.include_router(r.router, dependencies=signed_in, responses=no_session)
# Read-only MCP server (Streamable HTTP): its own auth, see app/mcp/http.py. POST only (405 otherwise).
app.router.routes.append(Route("/mcp", endpoint=mcp_endpoint))


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


async def _opportunities(request: Request) -> OpportunitiesResponse:
    try:
        async with _engine(request).connect() as conn:
            state = await read_state(conn)
    except Exception as e:
        log.exception("postgres read failed")
        raise HTTPException(503, detail=f"Base de datos no disponible ({type(e).__name__}).") from e
    return OpportunitiesResponse(
        items=rank(state.items),
        sources=state.sources,
        ingest=state.ingest,
        fetched_at=state.last_ingest_at or "1970-01-01T00:00:00.000Z",
        cached=True,
        stale=False,
        refreshing=False,
        storage="postgres",
        last_ingest_at=state.last_ingest_at,
        ingest_stale=state.ingest_stale,
    )


@app.get("/api/oportunidades", response_model=OpportunitiesResponse, dependencies=signed_in, responses=no_session)
async def oportunidades(request: Request, response: Response) -> OpportunitiesResponse:
    """Stored base items with geographic + kind fit applied, ranked. Same shape as the TS route."""
    response.headers["Cache-Control"] = "private, max-age=30, stale-while-revalidate=300"
    return await _opportunities(request)


@app.get("/api/public/oportunidades", response_model=OpportunitiesResponse, tags=["public"])
async def public_oportunidades(request: Request, response: Response) -> OpportunitiesResponse:
    """For the public landing: the same ranked catalogue of public calls as /api/oportunidades. It is built only
    from the ingested public sources (no user, board, vote or team-profile data ever goes into it)."""
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    return await _opportunities(request)


@app.get("/api/fuentes", response_model=SourcesResponse, dependencies=signed_in, responses=no_session)
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
