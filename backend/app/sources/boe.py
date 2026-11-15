"""BOE (Boletín Oficial del Estado): open-data daily summaries (port of getBoeRadar in src/lib/boe.ts).

Scans the last 30 summaries (sections 3, 5A, 5B), keeps grant calls and open tenders, pre-scores them to pick
the 60 most relevant, then reads each notice's text for the deadline and purpose.
"""

from datetime import datetime, timedelta
from typing import Any, TypedDict

from app.config import local_now
from app.http import map_limit
from app.models import Opportunity, OpportunityDocument, SourceHealth
from app.scoring.score import FitAdjust, ScoreInput, score_convocatoria
from app.scoring.text import normalize_text
from app.sources.base import FetchResult, RawOpportunity, Source, SourceContext
from app.sources.notices import (
    deadline_from_days,
    decode_html,
    extract_notice_details,
    is_call_notice,
    is_open_tender,
    parse_deadline,
)

API = "https://www.boe.es/datosabiertos/api/boe/sumario"
SCAN_DAYS = 30
DAY_S = 86400
ESTIMATED_WARNING = "Fecha límite estimada a partir del plazo en días: confirmar en el texto oficial."


class BoeEntry(TypedDict):
    """One summary row. camelCase keys: the same JSON the TS stores under fetch_cache "boe:day:*"."""

    identificador: str
    fecha: str  # YYYY-MM-DD
    seccionCodigo: str
    seccionNombre: str
    departamento: str
    epigrafe: str
    titulo: str
    urlPdf: str | None
    urlHtml: str | None
    esLicitacion: bool


class BoeDay(TypedDict):
    entries: list[BoeEntry]
    ok: bool


class NoticeDetails(TypedDict):
    deadlineText: str | None
    summary: str | None


def _as_list(v: Any) -> list[Any]:
    if not v:
        return []
    return v if isinstance(v, list) else [v]


def parse_summary(json: Any, ymd: str) -> list[BoeEntry]:
    """Entries of one daily summary: grant calls (sections 3, 5B) and open tenders (5A)."""
    diario = ((((json or {}).get("data") or {}).get("sumario") or {}).get("diario") or [None])[0]
    if (json.get("status") or {}).get("code") != "200" or not diario or not diario.get("seccion"):
        return []  # no BOE that day
    iso = f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:8]}"
    entries: list[BoeEntry] = []
    for sec in _as_list(diario["seccion"]):
        code = sec.get("codigo") or ""
        if code not in ("3", "5A", "5B"):
            continue
        for dep in _as_list(sec.get("departamento")):
            groups = [("", _as_list(dep.get("item")))] + [
                (e.get("nombre") or "", _as_list(e.get("item"))) for e in _as_list(dep.get("epigrafe"))
            ]
            for epigrafe, items in groups:
                for it in items:
                    t = normalize_text(it["titulo"])
                    es_licitacion = code == "5A"
                    if not (is_open_tender(t) if es_licitacion else is_call_notice(t)):
                        continue
                    pdf = it.get("url_pdf")
                    entries.append(
                        BoeEntry(
                            identificador=it["identificador"],
                            fecha=iso,
                            seccionCodigo=code,
                            seccionNombre=sec.get("nombre") or code,
                            departamento=dep.get("nombre") or "Administración General del Estado",
                            epigrafe=epigrafe,
                            titulo=it["titulo"],
                            urlPdf=pdf if isinstance(pdf, str) else (pdf or {}).get("texto") or None,
                            urlHtml=it.get("url_html")
                            or f"https://www.boe.es/diario_boe/txt.php?id={it['identificador']}",
                            esLicitacion=es_licitacion,
                        )
                    )
    return entries


def _tipo(e: BoeEntry) -> str:
    return "Licitación pública" if e["esLicitacion"] else "Extracto de convocatoria (BOE)"


def _kind(e: BoeEntry) -> str:
    return "licitacion" if e["esLicitacion"] else "boletin"


def notice_text(html: str) -> str:
    """Plain text of a notice page (body only when found), first 12 000 characters."""
    i = html.find('<div id="textoxslt"')
    return decode_html(html[i:] if i >= 0 else html)[:12000]


class BoeSource(Source):
    id = "boe"
    name = "BOE"

    async def fetch(self, ctx: SourceContext) -> FetchResult:
        now = local_now()
        # BOE publishes Monday-Saturday
        dates = [d for d in (now - timedelta(days=i) for i in range(SCAN_DAYS)) if d.weekday() != 6]
        days = await map_limit(dates, 6, lambda d: self._day(ctx, d, now))
        by_id: dict[str, BoeEntry] = {}
        for day in days:
            for e in day["entries"]:
                by_id.setdefault(e["identificador"], e)
        ok_days = sum(1 for d in days if d["ok"])
        failed_days = len(days) - ok_days

        # pre-score on title + department only, to choose which notices to read (never stored)
        candidates = [
            e for e in by_id.values() if (pre := score_convocatoria(_input(e))).work_lines and pre.score >= 35
        ][:60]
        details = await map_limit(candidates, 6, lambda e: self._details(ctx, e))
        items = [_to_raw(e, d) for e, d in zip(candidates, details, strict=True)]

        failed = f", {failed_days} con error" if failed_days else ""
        return FetchResult(
            items=items,
            health=SourceHealth(
                id="boe",
                name="BOE · Boletín Oficial del Estado",
                category="Boletín Oficial",
                status="error" if ok_days == 0 else "partial" if failed_days > 3 else "ok",
                count=0,
                url="https://www.boe.es/datosabiertos/",
                note=f"API de sumarios: {SCAN_DAYS} días ({ok_days} leídos{failed}). Solo extractos de convocatorias "
                "y licitaciones abiertas (sin formalizaciones) con encaje ambiental.",
            ),
        )

    def keep(self, o: Opportunity) -> bool:
        return o.fit.score >= 30

    async def _day(self, ctx: SourceContext, d: datetime, now: datetime) -> BoeDay:
        ymd = d.strftime("%Y%m%d")

        async def fetch_day() -> BoeDay:
            json = await ctx.http.json(f"{API}/{ymd}", timeout=9)
            return {"entries": [], "ok": False} if json is None else {"entries": parse_summary(json, ymd), "ok": True}

        if ymd == now.strftime("%Y%m%d"):
            return await fetch_day()  # today's summary may still change

        async def fetch_ok() -> BoeDay | None:
            day = await fetch_day()
            return day if day["ok"] else None

        # past summaries are immutable
        return await ctx.memo.get(f"boe:day:{ymd}", 7 * DAY_S, fetch_ok, persist=True) or {"entries": [], "ok": False}

    async def _details(self, ctx: SourceContext, e: BoeEntry) -> NoticeDetails:
        async def fetch() -> NoticeDetails | None:
            html = await ctx.http.text(f"https://www.boe.es/diario_boe/txt.php?id={e['identificador']}", timeout=8)
            if html is None:
                return None
            deadline_text, summary = extract_notice_details(notice_text(html))
            return {"deadlineText": deadline_text, "summary": summary}

        # published notices never change
        hit = await ctx.memo.get(f"boe:notice:{e['identificador']}", 30 * DAY_S, fetch, persist=True)
        return hit or {"deadlineText": None, "summary": None}


def _input(e: BoeEntry, **extra: Any) -> ScoreInput:
    return ScoreInput(
        titulo=e["titulo"], organismo=e["departamento"], tipo_convocatoria=_tipo(e), kind=_kind(e), **extra
    )


def _to_raw(e: BoeEntry, det: NoticeDetails) -> RawOpportunity:
    explicit = parse_deadline(det["deadlineText"])
    deadline = explicit or deadline_from_days(e["fecha"], det["deadlineText"])
    return RawOpportunity(
        id=f"boe:{e['identificador']}",
        source="boe",
        source_label="BOE · Licitación" if e["esLicitacion"] else "BOE",
        kind=_kind(e),
        titulo=e["titulo"],
        organismo=e["departamento"],
        region="Estatal",
        nivel_admin="Estatal",
        published_at=e["fecha"],
        deadline=deadline,
        deadline_estimated=bool(deadline) and not explicit,
        deadline_text=det["deadlineText"],
        tipo="Licitación pública" if e["esLicitacion"] else "Extracto de convocatoria",
        url=e["urlHtml"] or f"https://www.boe.es/diario_boe/txt.php?id={e['identificador']}",
        documents=[
            OpportunityDocument(name=f"{e['identificador']}.pdf", description="Texto oficial (PDF)", url=e["urlPdf"])
        ]
        if e["urlPdf"]
        else [],
        summary=det["summary"],
        score_input=_input(
            e,
            extra_text=det["summary"] or "",
            fecha_fin_solicitud=deadline,
            fecha_inicio_solicitud=e["fecha"],
            deadline_estimated=bool(deadline) and not explicit,
        ),
        adjust=FitAdjust(append_warnings=[ESTIMATED_WARNING]) if deadline and not explicit else None,
    )
