"""Read-only MCP server: the radar's data for the team's own AI assistant (docs/mcp.md, ADR 0026 and 0027).

Two levels:
- public (no token): the ingested calls, private programmes, sources and the default scoring rules, the same data
  `/api/public/oportunidades` already serves to the landing. Scores are the server's, without the team's Perfil;
- team (valid personal access token over HTTP, or `RADAR_MCP_USER` in stdio): also the team's Perfil adjustments
  (same port of the web's `applyProfileAll`, so scores match the web), the board (status, assignee, notes) and votes.

Every tool runs in a `SET TRANSACTION READ ONLY` transaction, returns compact JSON (text fields capped, lists
paginated or truncated), never e-mails, tokens or hashes; people appear by name only.
"""

import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated, Any, Literal

from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import CallToolResult, TextContent, ToolAnnotations
from pydantic import Field, ValidationError
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from app.api.board import TeamProfile, _board_items, _votes
from app.api.perfil import perfil_payload
from app.api.state import last_ingest, read_sources, read_state
from app.config import settings
from app.db.session import make_engine
from app.db.tables import org_settings, tracking, users
from app.models import DeadlineState, Opportunity, OpportunityKind, WorkLine
from app.scoring.rank import rank
from app.scoring.team_profile import apply_profile_all
from app.scoring.text import has_term, normalize_text
from app.sources import SOURCE_ORDER

log = logging.getLogger("mcp")

USER_STATE_KEY = "radar_mcp_user"  # set by app/mcp/http.py on the ASGI scope's state: the token's person, or None
NEEDS_TOKEN = (
    "Conecta con un token personal para ver el tablero del equipo: créalo en la web, «Mi cuenta» → «Conectar un "
    "asistente», y añádelo como cabecera `Authorization: Bearer rr_pat_…`."
)
SERVER_SCORE_NOTE = (
    "Notas del servidor, sin los ajustes del perfil del equipo (la web puede mostrar otra nota). " + NEEDS_TOKEN
)

INSTRUCTIONS = """\
Radar de convocatorias de financiación (subvenciones, licitaciones, fondos europeos, programas de empresas) para la
Asociación Reforesta, una ONG ambiental de Madrid. Solo lectura: no puedes cambiar nada.
- Cada convocatoria tiene una nota de encaje 0-100 calculada por reglas (no por IA), con motivos y avisos que la
  explican; nivel alto >= 60, medio >= 40. Usa `perfil_reforesta` para explicar una nota o juzgar si Reforesta
  puede presentarse.
- Flujo típico: `buscar_convocatorias` (filtra y pagina) → `ver_convocatoria` para la ficha completa (plazos,
  importes, beneficiarios, documentos, ediciones anteriores, quién las ganó y si Reforesta ganó alguna).
- `estado`: abierta (plazo en curso), proxima (abrirá), cerrada (plazo pasado; se conserva como próxima edición),
  sin_fecha. Fechas YYYY-MM-DD, hora de Madrid.
- Di de cuándo son los datos (`fuentes`) y enlaza siempre la url oficial: las bases mandan sobre el radar.
- El tablero del equipo (`tablero_equipo`, estado y notas en `ver_convocatoria`) solo se ve con un token personal.
"""

READ_ONLY = dict(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=False)

mcp = MCPServer("reforesta-radar", title="Reforesta Radar", instructions=INSTRUCTIONS, version="1.0")

# ---------- plumbing ----------

_engine: AsyncEngine | None = None


def bind_engine(engine: AsyncEngine | None) -> None:
    """For stdio and in-process use (tests); without it, the first stdio call creates one from DATABASE_URL."""
    global _engine
    _engine = engine


def _get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = make_engine()
    return _engine


@asynccontextmanager
async def _read(ctx: Context) -> AsyncIterator[AsyncConnection]:
    """A read-only transaction: Postgres refuses any write in it (rolled back on close anyway). Over HTTP it uses the
    API's engine; in stdio (no HTTP request) the bound or a new one."""
    request = ctx.request_context.request
    engine = request.scope["app"].state.engine if request is not None else _get_engine()
    try:
        async with engine.connect() as conn:
            await conn.execute(text("set transaction read only"))
            yield conn
    except ToolError:
        raise
    except Exception as e:
        log.exception("mcp: database read failed")
        raise ToolError(f"Base de datos del radar no disponible ({type(e).__name__}). Prueba en un momento.") from e


async def _team_user(ctx: Context, conn: AsyncConnection) -> str | None:
    """Name of the person whose team view applies, or None (public). HTTP: the token's person (validated by
    app/mcp/http.py); stdio: the active account RADAR_MCP_USER."""
    request = ctx.request_context.request
    if request is not None:
        user = request.scope.get("state", {}).get(USER_STATE_KEY)
        return user.name or "(sin nombre)" if user is not None else None
    if not settings.mcp_user:
        return None
    name = (
        await conn.execute(
            select(users.c.name).where(func.lower(users.c.email) == settings.mcp_user.strip().lower(), users.c.active)
        )
    ).scalar()
    return None if name is None else name or "(sin nombre)"


def _result(data: dict[str, Any]) -> CallToolResult:
    """Structured content plus the same JSON, compact, as text (for clients that only read text)."""
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return CallToolResult(content=[TextContent(type="text", text=body)], structured_content=data)


def _cap(s: str | None, n: int) -> str | None:
    if s is None:
        return None
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _compact(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None and v != [] and v != {}}


async def _team_profile(conn: AsyncConnection) -> TeamProfile | None:
    raw = (await conn.execute(select(org_settings.c.profile).where(org_settings.c.id == 1))).scalar()
    if not raw:
        return None
    try:
        return TeamProfile.model_validate(raw)
    except ValidationError:
        log.warning("mcp: stored team profile does not validate; using the server score")
        return None


async def _catalogue(conn: AsyncConnection, team: bool) -> tuple[list[Opportunity], dict[str, str]]:
    """Ranked live calls as the web shows them: server score, plus the team's Perfil (and its hidden calls) for the
    team view. Same code path as /api/oportunidades (read_state + rank)."""
    items = rank((await read_state(conn)).items)
    if not team or (profile := await _team_profile(conn)) is None:
        return items, {}
    kept, hidden = apply_profile_all(items, profile)
    kept.sort(key=lambda o: "9999" if o.deadline is None else o.deadline)
    kept.sort(key=lambda o: o.fit.score, reverse=True)
    return kept, hidden


def _row(o: Opportunity, board: dict[str, str]) -> dict[str, Any]:
    f = o.fit
    return _compact(
        {
            "id": o.id,
            "titulo": _cap(o.titulo, 200),
            "organismo": _cap(o.organismo, 120),
            "fuente": o.source_label,
            "territorio": o.region,
            "tipo": o.kind,
            "estado": f.deadline_state,
            "cierre": o.deadline,
            "diasRestantes": f.days_remaining,
            "abre": o.opens_at,
            "sueleAbrir": o.history.typical_opening.text if o.history and o.history.typical_opening else None,
            "importe": o.budget,
            "importeTexto": None if o.budget is not None else _cap(o.amount_text, 80),
            "nota": f.score,
            "nivel": f.tier,
            "motivos": [_cap(r, 200) for r in f.reasons[:2]],
            "aviso": _cap(f.warnings[0], 200) if f.warnings else None,
            "tablero": board.get(o.id),
            "url": o.url,
        }
    )


async def _board_status(conn: AsyncConnection) -> dict[str, str]:
    return {
        r.opportunity_id: r.status for r in await conn.execute(select(tracking.c.opportunity_id, tracking.c.status))
    }


def _alternatives(texto: str) -> list[list[str]]:
    """'charca|anfibio rana' → [['charca'], ['anfibio', 'rana']]: any alternative, all words of it."""
    return [ws for alt in texto.split("|") if (ws := normalize_text(alt).split())]


def _haystack(o: Opportunity) -> str:
    return normalize_text(" | ".join([o.titulo, o.organismo, o.summary or "", *o.beneficiarios]))


# ---------- tools ----------

Estado = DeadlineState
Orden = Literal["encaje", "cierre", "recientes"]


@mcp.tool(
    title="Buscar convocatorias",
    annotations=ToolAnnotations(title="Buscar convocatorias", **READ_ONLY),
)
async def buscar_convocatorias(
    ctx: Context,
    texto: Annotated[
        str | None,
        Field(
            max_length=200,
            description="Palabras a buscar en título, organismo, resumen y beneficiarios (sin tildes ni mayúsculas; "
            "coincide por inicio de palabra: 'anfibio' encuentra 'anfibios'). Todas las palabras deben aparecer. "
            "Alternativas con '|': 'charca|anfibio|humedal' (basta una).",
        ),
    ] = None,
    estado: Annotated[
        list[Estado] | None,
        Field(
            description="abierta, proxima, cerrada (plazo pasado: próxima edición) o sin_fecha. Varias = cualquiera."
        ),
    ] = None,
    territorio: Annotated[
        str | None,
        Field(max_length=100, description="Parte del territorio: 'Madrid', 'Estatal', 'Unión Europea', 'Galicia'…"),
    ] = None,
    linea: Annotated[WorkLine | None, Field(description="Línea de trabajo de Reforesta que toca.")] = None,
    fuente: Annotated[
        str | None, Field(max_length=20, description=f"Id de la fuente: {', '.join(SOURCE_ORDER)} (ver `fuentes`).")
    ] = None,
    organismo: Annotated[str | None, Field(max_length=200, description="Parte del nombre del organismo.")] = None,
    encaje_minimo: Annotated[
        int | None, Field(ge=0, le=100, description="Nota mínima (60 = alto, 40 = medio).")
    ] = None,
    cierra_antes: Annotated[
        date | None, Field(description="Solo las que cierran ese día o antes (YYYY-MM-DD); excluye las sin fecha.")
    ] = None,
    tipo: Annotated[
        OpportunityKind | None, Field(description="subvencion, licitacion, boletin, europa o empresa.")
    ] = None,
    orden: Annotated[
        Orden, Field(description="encaje (nota, como la web), cierre (antes primero) o recientes (vistas por 1.ª vez).")
    ] = "encaje",
    limite: Annotated[int, Field(ge=1, le=50, description="Filas por página (máx. 50).")] = 20,
    desde: Annotated[int, Field(ge=0, description="Posición de inicio: usa `siguienteDesde` de la respuesta.")] = 0,
) -> CallToolResult:
    """Busca convocatorias vivas del radar con filtros y devuelve filas compactas ordenadas.

    Úsala para responder «¿qué hay abierto para X en Y?» o listar candidatas. Cada fila trae id, título, organismo,
    fuente, territorio, tipo, estado, cierre y días restantes, cuándo suele abrir (si hay historial), importe, nota y
    nivel, 1-2 motivos, el aviso principal y la url oficial. Pide luego `ver_convocatoria` con el id para la ficha.
    Devuelve `total` y `siguienteDesde` (null si no hay más). Sin token: nota del servidor, sin el perfil del
    equipo; con token: la misma nota que la web, sin las convocatorias que el perfil del equipo oculta, y el estado
    en el tablero. Si no encuentras nada, prueba sinónimos o raíces más cortas con '|'."""
    async with _read(ctx) as conn:
        who = await _team_user(ctx, conn)
        items, hidden = await _catalogue(conn, who is not None)
        board = await _board_status(conn) if who else {}
        last, _ = await last_ingest(conn)
    alts = _alternatives(texto) if texto else []
    terr, org = normalize_text(territorio or ""), normalize_text(organismo or "")

    def keep(o: Opportunity) -> bool:
        if estado and o.fit.deadline_state not in estado:
            return False
        if terr and terr not in normalize_text(o.region):
            return False
        if linea and linea not in o.fit.work_lines:
            return False
        if fuente and o.source != fuente.strip().lower():
            return False
        if org and org not in normalize_text(o.organismo):
            return False
        if encaje_minimo is not None and o.fit.score < encaje_minimo:
            return False
        if cierra_antes and (o.deadline is None or o.deadline > cierra_antes.isoformat()):
            return False
        if tipo and o.kind != tipo:
            return False
        if alts:
            hay = _haystack(o)
            return any(all(has_term(hay, w) for w in ws) for ws in alts)
        return True

    found = [o for o in items if keep(o)]
    if orden == "cierre":
        found.sort(key=lambda o: o.deadline or "9999")
    elif orden == "recientes":
        found.sort(key=lambda o: o.first_seen_at or "", reverse=True)
    page = found[desde : desde + limite]
    nxt = desde + len(page)
    data: dict[str, Any] = {
        "total": len(found),
        "desde": desde,
        "siguienteDesde": nxt if nxt < len(found) else None,
        "datosDe": last,
        "vista": "equipo" if who else "publica",
        "convocatorias": [_row(o, board) for o in page],
    }
    if who:
        data["ocultasPorPerfilDelEquipo"] = len(hidden)
    else:
        data["vistaPublica"] = SERVER_SCORE_NOTE
    return _result(data)


def _detail(o: Opportunity) -> dict[str, Any]:
    f = o.fit
    history = None
    if o.history:
        h = o.history.to_json()
        h["editions"] = h["editions"][:10]
        history = h
    return _compact(
        {
            "id": o.id,
            "titulo": _cap(o.titulo, 400),
            "organismo": _cap(o.organismo, 200),
            "fuente": o.source_label,
            "tipo": o.kind,
            "tipoAyuda": _cap(o.tipo, 100),
            "nivelAdministracion": o.nivel_admin,
            "territorio": o.region,
            "url": o.url,
            "basesUrl": o.bases_url,
            "fechas": _compact(
                {
                    "publicada": o.published_at,
                    "abre": o.opens_at,
                    "cierre": o.deadline,
                    "cierreTexto": _cap(o.deadline_text, 200),
                    "estado": f.deadline_state,
                    "diasRestantes": f.days_remaining,
                    "vistaPorPrimeraVez": o.first_seen_at,
                }
            ),
            "importe": o.budget,
            "importeTexto": _cap(o.amount_text, 200),
            "beneficiarios": [_cap(b, 200) for b in o.beneficiarios[:15]],
            "resumen": _cap(o.summary, 1500),
            "encaje": _compact(
                {
                    "nota": f.score,
                    "nivel": f.tier,
                    "lineas": f.work_lines,
                    "motivos": [_cap(r, 300) for r in f.reasons[:12]],
                    "avisos": [_cap(w, 300) for w in f.warnings[:12]],
                    "competitiva": f.is_competitive,
                    "ongElegible": f.is_ong_eligible,
                    "fuenteHabitual": f.manual_source_match,
                }
            ),
            "documentos": [
                _compact({"titulo": _cap(d.name, 200), "descripcion": _cap(d.description, 200), "url": d.url})
                for d in o.documents[:20]
            ],
            "historial": history,
            "programa": o.rsc.to_json() if o.rsc else None,
        }
    )


async def _team_part(conn: AsyncConnection, oid: str) -> dict[str, Any]:
    board = await _board_items(conn, [oid])
    votes = await _votes(conn, [oid])
    out: dict[str, Any] = {"estado": "nueva"}
    if board:
        b = board[0]
        out = {
            "estado": b.status,
            "asignada": b.assignee.name if b.assignee else None,
            "notas": [
                {"autor": n.author.name if n.author else None, "fecha": n.created_at[:10], "texto": _cap(n.body, 1000)}
                for n in b.notes[-20:]
            ],
            "actualizada": b.updated_at[:10],
            "actualizadaPor": b.updated_by.name if b.updated_by else None,
        }
    out["votos"] = {
        "sirve": sum(v.vote == "sirve" for v in votes),
        "noSirve": sum(v.vote == "no_sirve" for v in votes),
        "detalle": [
            _compact({"persona": v.user.name, "voto": v.vote, "motivo": _cap(v.reason, 300) or None}) for v in votes
        ],  # fmt: skip
    }
    return _compact(out)


@mcp.tool(title="Ver convocatoria", annotations=ToolAnnotations(title="Ver convocatoria", **READ_ONLY))
async def ver_convocatoria(
    ctx: Context,
    id: Annotated[str, Field(min_length=1, max_length=200, description="Id de la convocatoria, p. ej. 'bdns:923290'.")],
) -> CallToolResult:
    """Ficha completa de una convocatoria por id (el de `buscar_convocatorias` o `tablero_equipo`).

    Devuelve lo que muestra la ficha de la web: nota con todos sus motivos y avisos, fechas (publicada, abre, cierra,
    días restantes), importe, beneficiarios, resumen, documentos (título y url), el programa si es de una empresa y
    el historial de ediciones anteriores (BDNS): cuándo suele abrir, plazo habitual, quién ganó (solo recuentos por
    tipo de entidad), si Reforesta ganó y cuánto, y ONG afines entre los ganadores. Con token añade `equipo`:
    estado en el tablero, persona asignada, notas y votos «sirve / no sirve». Textos recortados."""
    async with _read(ctx) as conn:
        who = await _team_user(ctx, conn)
        items, hidden = await _catalogue(conn, who is not None)
        o = next((x for x in items if x.id == id), None)
        if o is None and id in hidden:  # hidden by the team's profile: still show it, with the server score
            o = next((x for x in rank((await read_state(conn)).items) if x.id == id), None)
        if o is None:
            raise ToolError(
                f"La convocatoria {id!r} no está en el radar (id mal escrito, ya no aparece en las fuentes o es una "
                "edición anterior de otra). Búscala con `buscar_convocatorias`."
            )
        data = _detail(o)
        if who:
            if id in hidden:
                data["ocultaPorPerfilDelEquipo"] = hidden[id]
            data["equipo"] = await _team_part(conn, id)
        else:
            data["vistaPublica"] = SERVER_SCORE_NOTE
    return _result(data)


@mcp.tool(title="Programas de empresas", annotations=ToolAnnotations(title="Programas de empresas", **READ_ONLY))
async def programas_empresas(ctx: Context) -> CallToolResult:
    """Programas privados de fundaciones y empresas (RSC) comprobados a mano en la web del financiador.

    Úsala para «¿qué fundaciones o empresas financian proyectos como los nuestros?». Por programa: tipo (ayuda o
    premio: el premio reconoce trabajo hecho, no financia un proyecto nuevo), por qué puede encajar, requisitos,
    límites para Reforesta, territorio, última ventana publicada, cuándo puede abrir la siguiente, fecha de
    comprobación (`verifiedOn`) y lo que no se pudo comprobar (`unverified`), además de la nota y la url oficial.
    Los datos pueden haber cambiado desde `verifiedOn`: recomiéndale comprobarlos."""
    async with _read(ctx) as conn:
        who = await _team_user(ctx, conn)
        items = rank((await read_state(conn)).items)  # every programme, even if the team's Perfil hides "empresa"
        last, _ = await last_ingest(conn)
    out = [
        _compact(
            {
                "id": o.id,
                "titulo": _cap(o.titulo, 200),
                "organismo": _cap(o.organismo, 120),
                "nota": o.fit.score,
                "nivel": o.fit.tier,
                "estado": o.fit.deadline_state,
                "cierre": o.deadline,
                "importeTexto": _cap(o.amount_text, 200),
                "programa": o.rsc.to_json() if o.rsc else None,
                "url": o.url,
            }
        )
        for o in items
        if o.rsc is not None
    ]
    data: dict[str, Any] = {"datosDe": last, "total": len(out), "programas": out}
    if not who:
        data["vistaPublica"] = SERVER_SCORE_NOTE
    return _result(data)


@mcp.tool(title="Tablero del equipo", annotations=ToolAnnotations(title="Tablero del equipo", **READ_ONLY))
async def tablero_equipo(
    ctx: Context,
    estado: Annotated[
        list[Literal["nueva", "estudio", "presentar", "presentada", "descartada"]] | None,
        Field(description="nueva, estudio, presentar, presentada o descartada. Varias = cualquiera."),
    ] = None,
    asignada: Annotated[
        str | None, Field(max_length=100, description="Parte del nombre de la persona asignada; '-' = sin asignar.")
    ] = None,
    limite: Annotated[int, Field(ge=1, le=50, description="Filas por página (máx. 50).")] = 50,
    desde: Annotated[int, Field(ge=0, description="Posición de inicio: usa `siguienteDesde`.")] = 0,
) -> CallToolResult:
    """Tablero de seguimiento del equipo: convocatorias con estado (nueva, estudio, presentar, presentada,
    descartada), persona asignada, cierre, número de notas y la última nota. Necesita token personal.

    Úsala para «¿qué tenemos en estudio?», «¿qué lleva Ana?» o «¿qué se nos cierra pronto?». Devuelve el recuento
    por estado y las filas (las actualizadas más recientemente primero). `yaNoAparece` = la convocatoria ya no está en
    las fuentes. Para las notas completas y los votos, `ver_convocatoria`."""
    async with _read(ctx) as conn:
        if await _team_user(ctx, conn) is None:
            if ctx.request_context.request is None:  # stdio
                raise ToolError(
                    "El tablero del equipo en modo stdio necesita RADAR_MCP_USER (correo de una cuenta activa)."
                )
            raise ToolError("El tablero del equipo necesita un token personal. " + NEEDS_TOKEN)
        items = await _board_items(conn)
    counts: dict[str, int] = {}
    for b in items:
        counts[b.status] = counts.get(b.status, 0) + 1
    who = normalize_text(asignada or "")

    def keep(b: Any) -> bool:
        if estado and b.status not in estado:
            return False
        if who == "-":
            return b.assignee is None
        return not who or (b.assignee is not None and who in normalize_text(b.assignee.name))

    found = [b for b in items if keep(b)]
    page = found[desde : desde + limite]
    nxt = desde + len(page)
    rows = [
        _compact(
            {
                "id": b.opportunity_id,
                "titulo": _cap(b.titulo, 200),
                "organismo": _cap(b.organismo, 120),
                "estado": b.status,
                "asignada": b.assignee.name if b.assignee else None,
                "cierre": b.deadline,
                "notas": len(b.notes),
                "ultimaNota": _compact(
                    {
                        "autor": b.notes[-1].author.name if b.notes[-1].author else None,
                        "fecha": b.notes[-1].created_at[:10],
                        "texto": _cap(b.notes[-1].body, 300),
                    }
                )
                if b.notes
                else None,  # fmt: skip
                "yaNoAparece": b.gone or None,
                "actualizada": b.updated_at[:10],
                "url": b.url,
            }
        )
        for b in page
    ]
    return _result({"porEstado": counts, "total": len(found), "desde": desde,
                    "siguienteDesde": nxt if nxt < len(found) else None, "convocatorias": rows})  # fmt: skip


@mcp.tool(title="Fuentes y frescura de los datos", annotations=ToolAnnotations(title="Fuentes", **READ_ONLY))
async def fuentes(ctx: Context) -> CallToolResult:
    """Fuentes del radar (BDNS, BOE, UE, BOCM, DOG, Fundación Biodiversidad, programas de empresas) con su estado en
    la última carga y cuántas convocatorias aporta cada una, más la hora de la última carga correcta.

    Úsala para decir de cuándo son los datos o por qué falta algo (una fuente con error conserva sus filas
    anteriores). `datosAntiguos` = más de 36 h sin una carga correcta. La carga es diaria a las 9:00 (Madrid)."""
    async with _read(ctx) as conn:
        sources = await read_sources(conn)
        last, stale = await last_ingest(conn)
    rows = [
        _compact(
            {
                "id": s.id,
                "nombre": s.name,
                "categoria": s.category,
                "estado": s.status,
                "convocatorias": s.count,
                "nota": _cap(s.note, 300),
                "url": s.url or None,
            }
        )  # fmt: skip
        for s in sources
    ]
    return _result({"ultimaCargaCorrecta": last, "datosAntiguos": stale, "fuentes": rows})


SCORING_HOW = (
    "La nota (0-100) se calcula por reglas, sin IA: las palabras clave de cada línea de trabajo suman su peso; los "
    "términos de ONG suman; los excluyentes restan (p. ej. subvención nominativa); el territorio ajusta (Madrid y "
    "ámbito estatal suben; otra comunidad o un ayuntamiento de fuera bajan y topan la nota); el tipo ajusta "
    "(licitaciones, boletines informativos y universidades se topan); y en BDNS el historial suma si Reforesta u ONG "
    "afines ganaron ediciones anteriores y avisa si casi nunca gana una entidad sin ánimo de lucro. Niveles: alto "
    ">= 60, medio >= 40, bajo < 40. Cada punto aparece como motivo o aviso en la ficha."
)


@mcp.tool(title="Perfil de Reforesta y cómo se puntúa", annotations=ToolAnnotations(title="Perfil", **READ_ONLY))
async def perfil_reforesta(ctx: Context) -> CallToolResult:
    """Quién es Reforesta y cómo puntúa el radar: identidad (forma jurídica, equipo, misión), líneas de trabajo con
    sus palabras clave y pesos, términos de ONG y excluyentes, regla de territorio, topes y niveles.

    Úsala para explicar una nota o juzgar si Reforesta puede presentarse a algo. Con token añade `perfilDelEquipo`:
    los ajustes que el equipo ha guardado en la web (palabras extra, términos descartados, prioridad por línea y
    territorio, tipos y importe mínimo) y su filtro de organismos (este no se aplica en las búsquedas)."""
    p = perfil_payload()
    data: dict[str, Any] = {
        "comoSePuntua": SCORING_HOW,
        "identidad": p["profile"],
        "lineasDeTrabajo": [
            {
                "linea": w["line"],
                "nombre": w["label"],
                "palabras": [f"{k['term']} ({k['weight']:+d})" for k in w["keywords"]],
            }
            for w in p["workLines"]
        ],
        "terminosOng": p["ngoTerms"],
        "excluyentes": [
            {"termino": d["term"], "penalizacion": -d["penalty"], "aviso": d["warning"]} for d in p["dealbreakers"]
        ],
        "niveles": p["tiers"],
        "territorio": p["geo"],
    }
    async with _read(ctx) as conn:
        if await _team_user(ctx, conn) is not None:
            row = (await conn.execute(select(org_settings).where(org_settings.c.id == 1))).first()
            people = {r.id: r.name for r in await conn.execute(select(users.c.id, users.c.name))}
            data["perfilDelEquipo"] = {
                "ajustes": row.profile if row else None,
                "organismos": row.organisms if row else None,
                "editadoPor": people.get(row.updated_by) if row and row.updated_by else None,
                "editadoEl": row.updated_at.isoformat()[:10] if row and row.updated_at else None,
            }
        else:
            data["vistaPublica"] = "Perfil por defecto. " + NEEDS_TOKEN
    return _result(data)
