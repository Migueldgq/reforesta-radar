"""BDNS (Base de Datos Nacional de Subvenciones): port of getBdnsOpportunities in src/lib/bdns.ts.

68 paged searches over the last 365 days (topic keywords, generic third-sector queries, MITECO-family organs),
deduped by call number and pre-scored to drop nominative/direct calls. Every remaining candidate's detail ("ficha")
is read and memoised; only details that fail (or candidates past the MAX_ENRICH safety bound) become "lite" items
built from the search row only.
"""

import math
from datetime import UTC, datetime
from typing import Any, NamedTuple
from urllib.parse import quote

from app.config import local_now, settings
from app.http import map_limit
from app.models import NivelAdmin, Opportunity, OpportunityDocument, SourceHealth
from app.scoring.regions import infer_comunidad_autonoma
from app.scoring.score import FitAdjust, ScoreInput, score_convocatoria
from app.scoring.text import has_term, normalize_text
from app.sources.base import FetchResult, RawOpportunity, Source, SourceContext, score_raw
from app.sources.notices import deadline_from_days, parse_deadline

BDNS_BASE = "https://www.infosubvenciones.es/bdnstrans/api"
# The TS read only the 230 best details: it fetched live inside a 35 s web request. The ingest is a background batch
# (per-source timeout INGEST_SOURCE_TIMEOUT_S, 8 min) with details memoised in fetch_cache, so every candidate that
# survives the pre-score gets its detail (~1 000 today). This is only a safety bound against a runaway search.
MAX_ENRICH = 2000
SEARCH_WINDOW_DAYS = 365
DAY_S = 86400
# BDNS answers bursts with HTTP 429. The TS retried once (fetchText default); a cold run (no memo) then lost ~15% of
# the details to 429s, so the Python connector retries 429/5xx/network errors up to 3 times with the shared backoff.
RETRIES = 3
# Details in flight at once (the TS used 8): BDNS is a public service and already answers bursts with 429.
DETAIL_CONCURRENCY = 4
LITE_WARNING = "Ficha BDNS no cargada en este barrido: abre la convocatoria para ver plazo, tipo y beneficiarios."


class RadarQuery(NamedTuple):
    q: str | None = None
    ngo_only: bool = False
    organ: int | None = None  # BDNS organ id (`organos=` filter)
    priority: bool = False  # results get enrichment priority and looser topic filtering


_Q = RadarQuery
RADAR_QUERIES: tuple[RadarQuery, ...] = (
    _Q("medio ambiente"),
    _Q("medioambiental"),
    _Q("medioambientales"),
    _Q("medi ambient"),
    _Q("medio ambiente", ngo_only=True),
    _Q("ambiental", ngo_only=True),
    _Q("ambientales", ngo_only=True),
    _Q("ingurumen"),
    _Q("biodiversidad"),
    _Q("biodiversitat"),
    _Q("forestal"),
    _Q("forestales"),
    _Q("montes", ngo_only=True),
    _Q("reforestación"),
    _Q("repoblación forestal"),
    _Q("restauración ecológica"),
    _Q("restauración ambiental"),
    _Q("restauración de ecosistemas"),
    _Q("renaturalización"),
    _Q("custodia del territorio"),
    _Q("custòdia del territori"),
    _Q("educación ambiental"),
    _Q("educació ambiental"),
    _Q("voluntariado ambiental"),
    _Q("voluntariado", ngo_only=True),
    _Q("especies invasoras"),
    _Q("exóticas invasoras"),
    _Q("humedales"),
    _Q("anfibios"),
    _Q("fauna", ngo_only=True),
    _Q("espacios naturales"),
    _Q("patrimonio natural"),
    _Q("red natura"),
    _Q("parque nacional"),
    _Q("parques naturales"),
    _Q("conservación de la naturaleza"),
    _Q("cambio climático", ngo_only=True),
    _Q("desarrollo rural", ngo_only=True),
    _Q("agroambiental"),
    _Q("sostenibilidad", ngo_only=True),
    _Q("infraestructura verde"),
    _Q("proyectos ambientales"),
    _Q("entidades ambientales"),
    _Q("natura", ngo_only=True),
    # generic third-sector calls (title may not say "ambiental")
    _Q("interés general", ngo_only=True, priority=True),
    _Q("interés social", ngo_only=True, priority=True),
    _Q("IRPF", priority=True),
    _Q("0,7", ngo_only=True, priority=True),
    _Q("tercer sector", priority=True),
    _Q("entidades sin ánimo de lucro", ngo_only=True, priority=True),
    _Q("entitats sense ànim de lucre", priority=True),
    # organs (MITECO family)
    _Q(organ=6489, priority=True),  # MITECO · DG Servicios (convocatorias de interés general)
    _Q(organ=6430, priority=True),  # DG Biodiversidad, Bosques y Desertificación
    _Q(organ=466, priority=True),  # Fundación Biodiversidad
    _Q(organ=557, priority=True),  # OAPN
    _Q(organ=716, priority=True),  # Secretaría de Estado de Medio Ambiente
    _Q(organ=719, priority=True),  # Oficina Española del Cambio Climático
    _Q(organ=1723, priority=True),  # DG del Agua
    _Q(organ=6493, priority=True),  # DG Políticas contra la Despoblación
    _Q(organ=1850, priority=True),
    _Q(organ=1851, priority=True),
    _Q(organ=1852, priority=True),
    _Q(organ=1853, priority=True),
    _Q(organ=1987, priority=True),
    _Q(organ=1988, priority=True),
    _Q(organ=1989, priority=True),
    _Q(organ=1990, priority=True),
    _Q(organ=1991, priority=True),  # Confederaciones hidrográficas
)

PRE_DROP_TERMS = (
    "nominativa",
    "nominativas",
    "subv.nom",
    "subv. nom",
    "concesion directa",
    "concessio directa",
    "convenio",
    "conveni",
    "aportacion",
)


def _enc(s: str) -> str:
    """JS encodeURIComponent."""
    return quote(s, safe="!~*'()")


def _nn(*values: Any) -> Any:
    """JS `a ?? b ?? ...`: first value that is not None."""
    return next((v for v in values if v is not None), None)


def _url(numero: str) -> str:
    return f"https://www.infosubvenciones.es/bdnstrans/GE/es/convocatoria/{numero}"


class SearchResult(NamedTuple):
    items: list[dict[str, Any]]
    ok: bool
    total: int


async def search_paged(ctx: SourceContext, q: RadarQuery, fecha_desde: str, max_pages: int) -> SearchResult:
    params = [
        "vpd=GE",
        "pageSize=50",
        f"fechaDesde={_enc(fecha_desde)}",
        f"descripcion={_enc(q.q)}" if q.q else "",
        "tiposBeneficiario=2" if q.ngo_only else "",
        f"organos={q.organ}" if q.organ else "",
    ]
    base = f"{BDNS_BASE}/convocatorias/busqueda?{'&'.join(p for p in params if p)}"
    first = await ctx.http.json(f"{base}&page=0", timeout=8, retries=RETRIES)
    if first is None:
        return SearchResult([], False, 0)
    items = list(first.get("content") or [])
    total = _nn(first.get("totalElements"), len(items))
    pages = min(max_pages, math.ceil(total / 50))
    for p in range(1, pages):
        more = await ctx.http.json(f"{base}&page={p}", timeout=8, retries=RETRIES)
        if not (more or {}).get("content"):
            break
        items.extend(more["content"])
    return SearchResult(items, True, total)


def bdns_nivel(nivel1: str | None) -> NivelAdmin:
    n = normalize_text(nivel1 or "")
    if "estado" in n:
        return "Estatal"
    if "autonomica" in n:
        return "Autonómica"
    if "local" in n:
        return "Local"
    return "Otros"


def pre_score(raw: dict[str, Any], now: datetime) -> float:
    text = f"{raw['descripcion']} {raw.get('descripcionLeng') or ''}"
    if any(has_term(normalize_text(text), t) for t in PRE_DROP_TERMS):
        return -1
    fit = score_convocatoria(
        ScoreInput(titulo=text, organismo=raw.get("nivel3") or raw.get("nivel2") or raw.get("nivel1") or ""),
        now.date(),
    )
    # tiny recency bonus (0-5); JS new Date("YYYY-MM-DD") is UTC midnight
    try:
        received = datetime.fromisoformat(raw["fechaRecepcion"])
        received = received if received.tzinfo else received.replace(tzinfo=UTC)
    except (KeyError, TypeError, ValueError):
        return math.nan  # JS: NaN, dropped by the `pre > 0` filter
    age_days = (now.timestamp() - received.timestamp()) / DAY_S
    return fit.score + max(0, 5 - age_days / 30)


def _region(regiones: list[str], nivel2: str | None, organismo: str, nivel1: str | None, nivel: NivelAdmin) -> str:
    region = infer_comunidad_autonoma(regiones, f"{nivel2 or ''} {organismo}", nivel1 or "")
    if region.startswith("Estatal"):
        region = "Estatal" if nivel == "Estatal" else "Sin determinar"
    return region


def detail_to_raw(raw: dict[str, Any], d: dict[str, Any], now: datetime) -> RawOpportunity:
    """Item from the search row + the BDNS detail (detailToOpportunity)."""
    organo = d.get("organo") or {}
    organismo = (
        " · ".join(x for x in (organo.get("nivel3"), organo.get("nivel2")) if x)
        or raw.get("nivel3")
        or raw.get("nivel2")
        or raw.get("nivel1")
    )
    regiones = [r.get("descripcion") for r in d.get("regiones") or []]
    nivel1 = organo.get("nivel1") or raw.get("nivel1")
    nivel_admin = bdns_nivel(nivel1)
    region = _region(regiones, organo.get("nivel2"), organismo, nivel1, nivel_admin)
    beneficiarios = [b.get("descripcion") for b in d.get("tiposBeneficiarios") or []]
    titulo = d.get("descripcion") or raw["descripcion"]
    finalidad = _nn(d.get("descripcionFinalidad"), "")
    bases = _nn(d.get("descripcionBasesReguladoras"), "")
    objetivos = ". ".join(o.get("descripcion") or "" for o in d.get("objetivos") or [])
    fecha_fin = d.get("fechaFinSolicitud")
    text_fin = d.get("textFin")

    # BDNS often gives only a relative term ("20 Días hábiles", "01 Mesos", "Línea 2- 31.10.26"). Estimate the end
    # from the start date, or from the BDNS registration date when the start is "día siguiente a la publicación".
    estimated_end: str | None = None
    if not fecha_fin and text_fin:
        base = _nn(d.get("fechaInicioSolicitud"), d.get("fechaRecepcion"), raw.get("fechaRecepcion"))
        estimated_end = _nn(parse_deadline(text_fin), deadline_from_days(base, text_fin) if base else None)
    today_iso = now.astimezone(UTC).date().isoformat()  # TS: new Date().toISOString().slice(0, 10)
    # BDNS says "abierto" but our estimate is already past: don't contradict the official flag, flag it.
    conflict = bool(estimated_end) and estimated_end < today_iso and d.get("abierto") is True
    deadline = _nn(fecha_fin, None if conflict else estimated_end)

    adjust: FitAdjust | None = None
    if conflict:
        adjust = FitAdjust(
            deadline_state="sin_fecha",
            delta=-12,
            cap=60,
            append_warnings=[
                f"BDNS la marca abierta, pero el plazo («{text_fin}») contado desde la publicación ya habría "
                "vencido: verificar."
            ],
        )
    elif estimated_end and not fecha_fin:
        adjust = FitAdjust(
            append_warnings=[f"Fecha límite estimada a partir de «{text_fin}»: confirmar en el extracto oficial."]
        )

    deadline_text = None if fecha_fin else " · ".join(x for x in (d.get("textInicio"), text_fin) if x) or None
    summary_parts = [p for p in (bases and f"Bases: {bases}", finalidad and f"Finalidad: {finalidad}.") if p]
    numero = raw["numeroConvocatoria"]

    return RawOpportunity(
        id=f"bdns:{numero}",
        source="bdns",
        source_label="BDNS",
        kind="subvencion",
        titulo=titulo,
        organismo=organismo,
        region=region,
        nivel_admin=nivel_admin,
        published_at=d.get("fechaRecepcion") or raw.get("fechaRecepcion") or None,
        opens_at=d.get("fechaInicioSolicitud"),
        deadline=deadline,
        deadline_text=deadline_text,
        budget=d.get("presupuestoTotal"),
        amount_text=None,
        tipo=d.get("tipoConvocatoria"),
        beneficiarios=beneficiarios,
        url=_url(numero),
        bases_url=d.get("urlBasesReguladoras") or d.get("sedeElectronica") or None,
        documents=[
            OpportunityDocument(
                name=doc.get("nombreFic"),
                description=doc.get("descripcion"),
                url=f"{BDNS_BASE}/convocatorias/documentos?idDocumento={doc.get('id')}",
                doc_id=doc.get("id"),
            )
            for doc in d.get("documentos") or []
        ],
        summary=" ".join(summary_parts)[:600] if summary_parts else None,
        score_input=ScoreInput(
            titulo=titulo,
            organismo=organismo,
            tipo_convocatoria=d.get("tipoConvocatoria"),
            beneficiarios=beneficiarios,
            regiones=regiones,
            region=region,
            presupuesto_total=d.get("presupuestoTotal"),
            fecha_inicio_solicitud=d.get("fechaInicioSolicitud"),
            fecha_fin_solicitud=deadline,
            abierto=d.get("abierto"),
            extra_text=f"{bases} {objetivos} {_nn(d.get('descripcionLeng'), '')}",
            kind="subvencion",
        ),
        adjust=adjust,
    )


def raw_to_raw(raw: dict[str, Any]) -> RawOpportunity:
    """Lightweight item from the search row only (rawToOpportunity): keeps recall without the detail fetch."""
    organismo = " · ".join(x for x in (raw.get("nivel3"), raw.get("nivel2")) if x) or raw.get("nivel1")
    nivel_admin = bdns_nivel(raw.get("nivel1"))
    region = _region([], raw.get("nivel2"), organismo, raw.get("nivel1"), nivel_admin)
    numero = raw["numeroConvocatoria"]
    return RawOpportunity(
        id=f"bdns:{numero}",
        source="bdns",
        source_label="BDNS",
        kind="subvencion",
        titulo=raw["descripcion"],
        organismo=organismo,
        region=region,
        nivel_admin=nivel_admin,
        published_at=raw.get("fechaRecepcion") or None,
        url=_url(numero),
        score_input=ScoreInput(
            titulo=raw["descripcion"],
            organismo=organismo,
            region=region,
            extra_text=_nn(raw.get("descripcionLeng"), ""),
            kind="subvencion",
        ),
        adjust=FitAdjust(delta=-5, append_warnings=[LITE_WARNING]),
    )


class BdnsSource(Source):
    id = "bdns"
    name = "BDNS"

    def __init__(self) -> None:
        # ids of enriched items that came from a priority query: keep() lets them in without a work line when
        # the call is open to NGOs (TS keep(o, isPriority)). Set by fetch(), read by keep() right after.
        self._priority_ids: set[str] = set()

    async def fetch(self, ctx: SourceContext) -> FetchResult:
        now = local_now()
        since = datetime.fromtimestamp(now.timestamp() - SEARCH_WINDOW_DAYS * DAY_S, settings.tz)
        fecha_desde = since.strftime("%d/%m/%Y")

        searches = await map_limit(
            RADAR_QUERIES, 6, lambda q: search_paged(ctx, q, fecha_desde, 2 if q.priority else 4)
        )
        ok_searches = sum(1 for s in searches if s.ok)
        deduped: dict[str, dict[str, Any]] = {}
        priority: set[str] = set()
        for q, s in zip(RADAR_QUERIES, searches, strict=True):
            for it in s.items:
                deduped.setdefault(it["numeroConvocatoria"], it)
                if q.priority:
                    priority.add(it["numeroConvocatoria"])

        scored = [
            (raw, pre_score(raw, now) + (15 if raw["numeroConvocatoria"] in priority else 0))
            for raw in deduped.values()
        ]
        ranked = sorted((r for r in scored if r[1] > 0), key=lambda r: -r[1])
        dropped = len(deduped) - len(ranked)
        to_enrich = [raw for raw, _ in ranked[:MAX_ENRICH]]
        not_enriched = [raw for raw, _ in ranked[MAX_ENRICH:]]

        # Details of a published call rarely change: cache by number (24 h; 3 h while it has no deadline yet),
        # so a refresh only hits the API for calls not seen before.
        async def detail(raw: dict[str, Any]) -> dict[str, Any] | None:
            n = raw["numeroConvocatoria"]
            return await ctx.memo.get(
                f"bdns:detail:{n}",
                lambda d: (24 if d.get("fechaFinSolicitud") else 3) * 3600,
                lambda: ctx.http.json(
                    f"{BDNS_BASE}/convocatorias?numConv={_enc(n)}&vpd=GE", timeout=8, retries=RETRIES
                ),
                persist=True,
            )

        details = await map_limit(to_enrich, DETAIL_CONCURRENCY, detail)

        items: list[RawOpportunity] = []
        failed = 0
        self._priority_ids = set()
        for raw, d in zip(to_enrich, details, strict=True):
            items.append(detail_to_raw(raw, d, now) if d is not None else raw_to_raw(raw))
            if d is None:
                failed += 1
            if raw["numeroConvocatoria"] in priority:
                self._priority_ids.add(f"bdns:{raw['numeroConvocatoria']}")
        # lite items: TS keeps them only with work lines and keep(o, false), which is what keep() does for them
        # (none is in _priority_ids). The health note counts the kept ones: score them here, never stored.
        lite_items = [raw_to_raw(raw) for raw in not_enriched]
        items.extend(lite_items)
        lite = sum(1 for r in lite_items if self.keep(score_raw(r)))

        status = (
            "error"
            if ok_searches == 0
            else "partial"
            if ok_searches < len(searches) or failed > len(to_enrich) * 0.2
            else "ok"
        )
        return FetchResult(
            items=items,
            health=SourceHealth(
                id="bdns",
                name="BDNS · Base de Datos Nacional de Subvenciones",
                category="API Oficial",
                status=status,
                count=0,
                url="https://www.infosubvenciones.es/bdnstrans/GE/es/convocatorias",
                note=f"{len(RADAR_QUERIES)} búsquedas ({ok_searches} OK; temáticas, tercer sector e interés general, "
                f"y por organismo MITECO/F. Biodiversidad/OAPN/confederaciones) desde {fecha_desde}: "
                f"{len(deduped)} convocatorias únicas, {dropped} descartadas (nominativas, convenios, concesión "
                f"directa), {len(to_enrich)} con ficha completa{f' ({failed} fallidas)' if failed else ''}, "
                f"{lite} solo con datos de búsqueda; {{count}} relevantes.",
            ),
        )

    def keep(self, o: Opportunity) -> bool:
        f = o.fit
        return (
            f.is_competitive
            and f.score >= 25
            and (len(f.work_lines) > 0 or (o.id in self._priority_ids and f.is_ong_eligible is True))
        )
