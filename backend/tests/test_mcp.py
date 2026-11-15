"""Personal access tokens (/api/me/tokens) and the read-only MCP server (/mcp) against a real Postgres (conftest.py),
driven by the SDK's own client over Streamable HTTP (in-process ASGI) and in-process (the stdio code path)."""

import asyncio
import hashlib
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import httpx2
import pytest
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncEngine

from app.auth import throttle
from app.config import settings
from app.db.tables import personal_tokens, users
from app.ingest.store import SourceRun, write_ingest
from app.main import app
from app.mcp import server as mcp_server
from app.mcp.http import endpoint
from app.models import FitAnalysis, Opportunity, OpportunityDocument, SourceHealth
from app.scoring.score import tier_for
from app.sources.base import score_raw
from app.sources.rsc import RSC_PROGRAMMES, to_raw
from tests.conftest import make_client

PUBLIC_TOOLS = {"buscar_convocatorias", "ver_convocatoria", "programas_empresas", "fuentes", "perfil_reforesta"}
TEAM_KEYS = {"equipo", "tablero", "asignada", "notas", "votos", "perfilDelEquipo", "ocultasPorPerfilDelEquipo"}
SECRET_NOTE = "Nota interna del equipo"


def _opp(oid: str, titulo: str, score: int, state: str = "abierta", deadline: str | None = "2099-01-01",
         **kw) -> Opportunity:  # noqa: ANN003  # fmt: skip
    fit = FitAnalysis(score=score, tier=tier_for(score), work_lines=["conservacion"], outside_manual_sources=False,
                      manual_source_match=None, is_competitive=True, is_ong_eligible=True,
                      reasons=[f"Motivo de {oid}.", "Otro motivo.", "Tercer motivo."], warnings=["Aviso."],
                      days_remaining=10, deadline_state=state)  # fmt: skip
    base = dict(id=oid, source="bdns", source_label="BDNS", kind="subvencion", titulo=titulo,
                organismo="Consejería de Medio Ambiente", region="Comunidad de Madrid", nivel_admin="Autonómica",
                deadline=deadline, url=f"https://example.org/{oid}", summary="x" * 5000,
                beneficiarios=["Entidades sin ánimo de lucro"],
                documents=[OpportunityDocument(name="Bases", description="", url="https://example.org/bases.pdf")],
                )  # fmt: skip
    return Opportunity(**{**base, **kw}, fit=fit)


CALLS = [
    _opp("bdns:1", "Ayudas para charcas y anfibios", 70),
    _opp("bdns:2", "Subvenciones para humedales", 55, region="Galicia"),
    _opp("bdns:3", "Proyectos ambientales de la Comunidad de Madrid", 65, "cerrada", "2026-03-01"),
    _opp("bdns:4", "Educación ambiental en colegios", 45, "sin_fecha", None),
    *[_opp(f"bdns:{n}", f"Convocatoria de relleno {n}", 30) for n in range(10, 70)],
]


async def _seed(engine: AsyncEngine) -> None:
    now = datetime.now(UTC)
    rsc = [score_raw(to_raw(r)) for r in RSC_PROGRAMMES[:2]]
    runs = [
        SourceRun(
            SourceHealth(id="bdns", name="BDNS", category="Estatal", status="ok", count=len(CALLS), url="", note=""),
            CALLS,
            now,
            now,
            None,
        ),  # fmt: skip
        SourceRun(
            SourceHealth(id="rsc", name="RSC", category="RSC", status="ok", count=2, url="", note=""),
            rsc,
            now,
            now,
            None,
        ),  # fmt: skip
    ]
    await write_ingest(engine, started_at=now, trigger="test", scoring_version=14, runs=runs, memo=[], dry_run=False)


@pytest.fixture
async def running(engine: AsyncEngine) -> AsyncIterator[None]:
    """The /mcp endpoint as the API lifespan runs it, held open by its own task (pytest-asyncio tears fixtures down
    in another task, and the SDK's task group must be exited where it was entered)."""
    app.state.engine = engine
    started, stop = asyncio.Event(), asyncio.Event()

    async def hold() -> None:
        async with endpoint.run():
            started.set()
            await stop.wait()

    task = asyncio.create_task(hold())
    await started.wait()
    yield
    stop.set()
    await task


def _http(engine: AsyncEngine, ip: str = "127.0.0.1", **headers: str) -> httpx2.AsyncClient:
    app.state.engine = engine
    return httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app, client=(ip, 123)), base_url="http://localhost",
                              headers=headers)  # fmt: skip


@asynccontextmanager
async def mcp_client(engine: AsyncEngine, token: str | None = None) -> AsyncIterator[Client]:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    async with (
        _http(engine, **headers) as http,
        Client(streamable_http_client("http://localhost/mcp", http_client=http)) as c,
    ):
        yield c


async def call(c: Client, name: str, args: dict[str, Any] | None = None) -> tuple[bool, Any]:
    res = await c.call_tool(name, args or {})
    if res.is_error:
        return True, res.content[0].text
    assert json.loads(res.content[0].text) == res.structured_content  # text mirrors the structured content
    return False, res.structured_content


async def _token(c: httpx.AsyncClient, name: str = "Claude", days: int | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"name": name, **({"expiresInDays": days} if days else {})}
    res = await c.post("/api/me/tokens", json=body)
    assert res.status_code == 201, res.text
    return res.json()


async def _team_state(engine: AsyncEngine, member: httpx.AsyncClient) -> None:
    me = next(u["id"] for u in (await member.get("/api/users")).json()["users"] if u["name"] == "Luis")
    await member.patch("/api/board/bdns:1", json={"status": "estudio", "assigneeId": me})
    await member.post("/api/board/bdns:1/notes", json={"body": SECRET_NOTE})
    await member.put("/api/votes/bdns:1", json={"vote": "sirve", "reason": "Encaja"})
    profile = {
        "extraKeywords": [{"term": "anfibio", "weight": 10}],
        "excludedTerms": [{"term": "humedal", "penalty": 100}],
    }
    await member.put("/api/settings", json={"profile": profile})


# ---------- tokens ----------


async def test_token_lifecycle(engine: AsyncEngine, admin: httpx.AsyncClient, member: httpx.AsyncClient) -> None:
    created = await _token(member, " Claude en el portátil ")
    secret = created["secret"]
    assert secret.startswith("rr_pat_") and len(secret) == 50
    assert created["token"]["name"] == "Claude en el portátil" and created["token"]["lastUsedAt"] is None
    expires = datetime.fromisoformat(created["token"]["expiresAt"])
    assert timedelta(days=89) < expires - datetime.now(UTC) <= timedelta(days=90)
    async with engine.connect() as conn:  # only the hash is stored
        (stored,) = (await conn.execute(text("select token_hash from personal_tokens"))).scalars()
    assert stored == hashlib.sha256(secret.encode()).hexdigest() and secret not in stored
    listed = (await member.get("/api/me/tokens")).json()
    assert listed["mcpUrl"] == settings.mcp_public_url and listed["publicTools"] is True
    assert [t["id"] for t in listed["tokens"]] == [created["token"]["id"]] and "secret" not in json.dumps(listed)
    assert (await admin.get("/api/me/tokens")).json()["tokens"] == []  # only mine
    assert (await admin.delete(f"/api/me/tokens/{created['token']['id']}")).status_code == 404  # not hers
    assert (await member.post("/api/me/tokens", json={"name": "x", "expiresInDays": 366})).status_code == 422
    assert (await member.post("/api/me/tokens", json={"name": "   "})).status_code == 400
    async with make_client(engine) as anon:
        del anon.headers["X-Radar-CSRF"]
        anon.cookies.update(member.cookies)
        assert (await anon.post("/api/me/tokens", json={"name": "x"})).status_code == 403  # CSRF rule applies
        # a token never opens /api/*: those routes read the session cookie only
        anon.cookies.clear()
        assert (await anon.get("/api/board", headers={"Authorization": f"Bearer {secret}"})).status_code == 401
        assert (await anon.get("/api/me/tokens", headers={"Authorization": f"Bearer {secret}"})).status_code == 401
    assert (await member.delete(f"/api/me/tokens/{created['token']['id']}")).status_code == 204
    assert (await member.get("/api/me/tokens")).json()["tokens"] == []


async def _status(engine: AsyncEngine, token: str | None, **headers: str) -> httpx2.Response:
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    hdrs = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json",
            "MCP-Protocol-Version": "2025-11-25", **headers}  # fmt: skip
    if token is not None:
        hdrs["Authorization"] = f"Bearer {token}"
    async with _http(engine) as c:
        return await c.post("/mcp", json=body, headers=hdrs)


async def test_mcp_auth(engine: AsyncEngine, running: None, member: httpx.AsyncClient, patch_settings) -> None:  # noqa: ANN001
    secret = (await _token(member))["secret"]
    assert (await _status(engine, None)).status_code == 200  # public tools without a token
    ok = await _status(engine, secret)
    assert ok.status_code == 200 and len(ok.json()["result"]["tools"]) == 6
    async with engine.connect() as conn:
        assert (await conn.execute(text("select last_used_at from personal_tokens"))).scalar() is not None
    for bad in ("rr_pat_" + "x" * 43, "nope", secret + "x"):
        res = await _status(engine, bad)
        assert res.status_code == 401, bad  # never a silent downgrade to public
        assert res.headers["www-authenticate"].startswith('Bearer realm="reforesta-radar", error="invalid_token"')
    res = await _status(engine, None, Authorization="Basic abc")
    assert res.status_code == 401
    # expired, revoked, deactivated account
    async with engine.begin() as conn:
        await conn.execute(update(personal_tokens).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    assert (await _status(engine, secret)).status_code == 401
    secret = (await _token(member))["secret"]
    async with engine.begin() as conn:
        await conn.execute(update(users).where(users.c.email == "luis@example.org").values(active=False))
    assert (await _status(engine, secret)).status_code == 401
    async with engine.begin() as conn:
        await conn.execute(update(users).where(users.c.email == "luis@example.org").values(active=True))
    assert (await _status(engine, secret)).status_code == 200
    # everything behind tokens
    patch_settings(mcp_public=False)
    res = await _status(engine, None)
    assert res.status_code == 401 and res.headers["www-authenticate"] == 'Bearer realm="reforesta-radar"'
    assert (await _status(engine, secret)).status_code == 200


async def test_password_change_and_reset_revoke_tokens(engine: AsyncEngine, running: None, member: httpx.AsyncClient,
                                                       admin: httpx.AsyncClient) -> None:  # fmt: skip
    secret = (await _token(member))["secret"]
    res = await member.post("/api/me/password", json={"currentPassword": "correct horse battery",
                                                      "newPassword": "another long password"})  # fmt: skip
    assert res.status_code == 204
    assert (await _status(engine, secret)).status_code == 401
    secret = (await _token(member))["secret"]
    luis = next(u["id"] for u in (await admin.get("/api/users")).json()["users"] if u["name"] == "Luis")
    assert (await admin.patch(f"/api/team/users/{luis}", json={"active": False})).status_code == 200
    assert (await admin.patch(f"/api/team/users/{luis}", json={"active": True})).status_code == 200
    assert (await _status(engine, secret)).status_code == 401  # reactivation does not bring tokens back


async def test_session_cookie_alone_is_only_public(
    engine: AsyncEngine, running: None, member: httpx.AsyncClient
) -> None:
    await _seed(engine)
    await _team_state(engine, member)
    async with _http(engine) as http:
        http.cookies.update({k: v for k, v in member.cookies.items()})
        async with Client(streamable_http_client("http://localhost/mcp", http_client=http)) as c:
            err, msg = await call(c, "tablero_equipo")
    assert err and "token personal" in msg


async def test_host_origin_body_and_rate_limits(engine: AsyncEngine, running: None) -> None:
    assert (await _status(engine, None, Host="evil.example")).status_code == 421
    assert (await _status(engine, None, Origin="https://evil.example")).status_code == 403
    assert (await _status(engine, None, Origin="http://localhost:3010")).status_code == 200
    async with _http(engine) as c:
        assert (await c.get("/mcp")).status_code == 405  # no standalone stream to hold open
        assert (await c.delete("/mcp")).status_code == 405
        big = b"x" * (1024 * 1024 + 1)
        res = await c.post("/mcp", content=big, headers={"Content-Type": "application/json"})
        assert res.status_code == 413
    saved = throttle.mcp_public.limit
    throttle.mcp_public.clear()
    throttle.mcp_public.limit = 2
    try:
        codes = [(await _status(engine, None)).status_code for _ in range(3)]
        assert codes == [200, 200, 429]
    finally:
        throttle.mcp_public.limit = saved
    for _ in range(30):
        await _status(engine, "nope")
    res = await _status(engine, "nope")
    assert res.status_code == 429 and int(res.headers["retry-after"]) > 0


# ---------- tools ----------


def _keys(x: Any) -> set[str]:
    if isinstance(x, dict):
        return set(x) | {k for v in x.values() for k in _keys(v)}
    if isinstance(x, list):
        return {k for v in x for k in _keys(v)}
    return set()


async def test_public_tools_expose_no_team_data(engine: AsyncEngine, running: None, member: httpx.AsyncClient) -> None:
    await _seed(engine)
    await _team_state(engine, member)
    async with mcp_client(engine) as c:
        tools = {t.name: t for t in (await c.list_tools()).tools}
        assert set(tools) == PUBLIC_TOOLS | {"tablero_equipo"}
        assert all(t.annotations.read_only_hint and not t.annotations.destructive_hint for t in tools.values())
        outputs = []
        for name, args in [("buscar_convocatorias", {}), ("ver_convocatoria", {"id": "bdns:1"}),
                           ("programas_empresas", {}), ("fuentes", {}), ("perfil_reforesta", {})]:  # fmt: skip
            err, out = await call(c, name, args)
            assert not err, (name, out)
            outputs.append(out)
        err, msg = await call(c, "tablero_equipo")
        assert err and "token personal" in msg
    dumped = json.dumps(outputs, ensure_ascii=False)
    assert not (_keys(outputs) & TEAM_KEYS)
    for private in (SECRET_NOTE, "Encaja", "@example.org", "Luis", "anfibio (+10)"):
        assert private not in dumped, private
    search = outputs[0]
    assert search["vista"] == "publica" and "token personal" in search["vistaPublica"]
    # public view = the server score, hidden calls included (the team's profile hides humedales)
    assert next(r for r in search["convocatorias"] if r["id"] == "bdns:1")["nota"] == 70 + 12  # + Madrid geo
    assert any(r["id"] == "bdns:2" for r in search["convocatorias"])


async def test_search_filters_pagination_and_caps(engine: AsyncEngine, running: None) -> None:
    await _seed(engine)
    async with mcp_client(engine) as c:
        _, page = await call(c, "buscar_convocatorias")
        assert len(page["convocatorias"]) == 20 and page["siguienteDesde"] == 20 and page["total"] == len(CALLS) + 2
        _, last = await call(c, "buscar_convocatorias", {"limite": 50, "desde": 50})
        assert last["siguienteDesde"] is None and len(last["convocatorias"]) == page["total"] - 50
        err, msg = await call(c, "buscar_convocatorias", {"limite": 51})
        assert err and "limite" in msg
        _, hit = await call(c, "buscar_convocatorias", {"texto": "charca|anfibio", "territorio": "madrid",
                                                         "estado": ["abierta"]})  # fmt: skip
        assert [r["id"] for r in hit["convocatorias"]] == ["bdns:1"]
        row = hit["convocatorias"][0]
        assert len(row["motivos"]) == 2 and row["url"] == "https://example.org/bdns:1"
        assert set(row) <= {"id", "titulo", "organismo", "fuente", "territorio", "tipo", "estado", "cierre",
                            "diasRestantes", "abre", "sueleAbrir", "importe", "importeTexto", "nota", "nivel",
                            "motivos", "aviso", "tablero", "url"}  # fmt: skip
        _, closed = await call(c, "buscar_convocatorias", {"estado": ["cerrada"], "texto": "ambientales madrid"})
        assert [r["id"] for r in closed["convocatorias"]] == ["bdns:3"]
        _, soon = await call(c, "buscar_convocatorias", {"cierra_antes": "2026-12-31", "fuente": "bdns"})
        assert [r["id"] for r in soon["convocatorias"]] == ["bdns:3"]
        _, gal = await call(c, "buscar_convocatorias", {"territorio": "Galicia", "encaje_minimo": 1})
        assert [r["id"] for r in gal["convocatorias"]] == ["bdns:2"]
        _, rsc = await call(c, "buscar_convocatorias", {"fuente": "rsc", "orden": "cierre"})
        assert {r["tipo"] for r in rsc["convocatorias"]} == {"empresa"}
        _, detail = await call(c, "ver_convocatoria", {"id": "bdns:1"})
        assert len(detail["resumen"]) <= 1500 and detail["documentos"][0]["url"] == "https://example.org/bases.pdf"
        assert detail["encaje"]["motivos"][0].startswith("Comunidad de Madrid")
        err, msg = await call(c, "ver_convocatoria", {"id": "bdns:nope"})
        assert err and "no está en el radar" in msg
        _, progs = await call(c, "programas_empresas")
        assert progs["total"] == 2 and all(p["programa"]["verifiedOn"] for p in progs["programas"])
        _, src = await call(c, "fuentes")
        assert {s["id"] for s in src["fuentes"]} == {"bdns", "rsc"} and src["ultimaCargaCorrecta"]


async def test_team_view_with_token(engine: AsyncEngine, running: None, member: httpx.AsyncClient) -> None:
    await _seed(engine)
    await _team_state(engine, member)
    secret = (await _token(member))["secret"]
    async with mcp_client(engine, secret) as c:
        _, search = await call(c, "buscar_convocatorias", {"limite": 50})
        assert search["vista"] == "equipo" and search["ocultasPorPerfilDelEquipo"] == 1
        rows = {r["id"]: r for r in search["convocatorias"]}
        assert "bdns:2" not in rows  # hidden by the team's profile, as in the web
        assert rows["bdns:1"]["nota"] == 70 + 12 + 10 and rows["bdns:1"]["tablero"] == "estudio"
        _, detail = await call(c, "ver_convocatoria", {"id": "bdns:1"})
        team = detail["equipo"]
        assert team["estado"] == "estudio" and team["asignada"] == "Luis"
        assert team["notas"][0]["texto"] == SECRET_NOTE and team["notas"][0]["autor"] == "Luis"
        assert team["votos"]["sirve"] == 1 and team["votos"]["detalle"][0]["persona"] == "Luis"
        _, hidden = await call(c, "ver_convocatoria", {"id": "bdns:2"})
        assert hidden["ocultaPorPerfilDelEquipo"] == "descartada"
        _, board = await call(c, "tablero_equipo", {"asignada": "luis"})
        assert board["porEstado"] == {"estudio": 1} and board["convocatorias"][0]["ultimaNota"]["texto"] == SECRET_NOTE
        _, none = await call(c, "tablero_equipo", {"estado": ["presentada"]})
        assert none["convocatorias"] == []
        _, perfil = await call(c, "perfil_reforesta")
        assert perfil["perfilDelEquipo"]["ajustes"]["extraKeywords"][0]["term"] == "anfibio"
        assert perfil["perfilDelEquipo"]["editadoPor"] == "Luis"
    assert "@example.org" not in json.dumps([search, detail, board, perfil], ensure_ascii=False)


TABLES = ("opportunities", "source_runs", "ingest_runs", "bdns_editions", "users", "sessions", "personal_tokens",
          "tracking", "tracking_notes", "org_settings", "votes", "ingest_requests", "fetch_cache")  # fmt: skip


async def _snapshot(engine: AsyncEngine) -> dict[str, str]:
    async with engine.connect() as conn:
        return {t: (await conn.execute(text(f"select md5(coalesce(string_agg(x::text, '' order by x::text), '')) "
                                            f"from {t} x"))).scalar_one() for t in TABLES}  # fmt: skip


async def test_stdio_mode_and_read_only(engine: AsyncEngine, member: httpx.AsyncClient, patch_settings) -> None:  # noqa: ANN001
    """In process = the stdio code path (no HTTP request): team view only with RADAR_MCP_USER. No tool writes."""
    await _seed(engine)
    await _team_state(engine, member)
    mcp_server.bind_engine(engine)
    try:
        async with Client(mcp_server.mcp) as c:
            err, _ = await call(c, "tablero_equipo")
            assert err
            patch_settings(mcp_user="LUIS@example.org")
            before = await _snapshot(engine)
            for name, args in [("buscar_convocatorias", {"texto": "charca", "orden": "recientes"}),
                               ("ver_convocatoria", {"id": "bdns:1"}), ("programas_empresas", {}),
                               ("tablero_equipo", {}), ("fuentes", {}), ("perfil_reforesta", {})]:  # fmt: skip
                err, out = await call(c, name, args)
                assert not err, (name, out)
            assert out and "perfilDelEquipo" in out
            assert await _snapshot(engine) == before
            patch_settings(mcp_user="nobody@example.org")
            assert (await call(c, "tablero_equipo"))[0]
    finally:
        mcp_server.bind_engine(None)


async def test_tools_cannot_write(engine: AsyncEngine) -> None:
    """The tools' transaction is read-only at the database level."""
    from sqlalchemy.exc import DBAPIError

    async with engine.connect() as conn:
        await conn.execute(text("set transaction read only"))
        with pytest.raises(DBAPIError, match="read-only transaction"):
            await conn.execute(text("insert into org_settings (id) values (1)"))
