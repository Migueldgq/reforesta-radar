"""Fundación Biodiversidad: "buscador de convocatorias" + each detail page (port of
scrapeFundacionBiodiversidad in src/lib/sources/multi-source.ts).
"""

import asyncio
import math
import re
from typing import NamedTuple

from app.http import map_limit
from app.models import SourceHealth
from app.scoring.score import FitAdjust, ScoreInput
from app.scoring.text import js_round, normalize_text
from app.sources.base import FetchResult, RawOpportunity, Source, SourceContext, score_raw
from app.sources.notices import decode_html, es_date_to_iso

FB_SEARCH = "https://fundacion-biodiversidad.es/buscador-de-convocatorias/"
ORGANISMO = "Fundación Biodiversidad (MITECO)"

_LIST_RE = re.compile(
    r'<div class="intro-ficha">\s*<h2><a href="([^"]+)">([\s\S]*?)</a></h2>([\s\S]*?)<a class="link-ver-mas-ficha"'
)
_SCRIPT_STYLE_RE = re.compile(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>")
_STATUS_RE = re.compile(r"Convocatoria (abierta|cerrada|resuelta|pr[oó]xima)", re.IGNORECASE)
_START_RE = re.compile(r"Fecha [Ii]nicio:\s*([0-9/]+)")
_END_RE = re.compile(r"Fecha fin:\s*([0-9/]+)")
_TOTAL_RE = re.compile(r"Importe total de la convocatoria:\s*([^:]{3,60}?)(?=\s+(?:Importe|Fuente|Correo|Año|$))")
_PER_PROJECT_RE = re.compile(r"Importe por proyecto:\s*([^:]{3,80}?)(?=\s+(?:Importe|Fuente|Correo|Año|$))")
_BECA_RE = re.compile(r"\bbecas?\b", re.IGNORECASE | re.ASCII)
_COMPETITIVA_RE = re.compile(r"concurrencia competitiva", re.IGNORECASE)


class FbLink(NamedTuple):
    url: str
    title: str
    excerpt: str


def _js_number(s: str) -> float:
    try:
        return float(s) if s.strip() else 0.0
    except ValueError:
        return math.nan


def parse_amount(s: str | None) -> int | None:
    if not s:
        return None
    n = normalize_text(s)
    if mill := re.search(r"([0-9.,]+)\s*millones", n):
        v = _js_number(mill.group(1).replace(".", "").replace(",", ".", 1)) * 1_000_000
    elif eur := re.search(r"([0-9.]+(?:,[0-9]+)?)\s*(?:€|euros)", n):
        v = _js_number(eur.group(1).replace(".", "").replace(",", ".", 1))
    else:
        return None
    return js_round(v) if math.isfinite(v) else None  # JS NaN budget serialises as null


def parse_list(html: str) -> list[FbLink]:
    return [
        FbLink(m.group(1), decode_html(m.group(2)), re.sub(r"\s*\[…\]\s*$", "…", decode_html(m.group(3))))
        for m in _LIST_RE.finditer(html)
    ]


def to_raw(link: FbLink, page: str | None) -> RawOpportunity:
    text = decode_html(_SCRIPT_STYLE_RE.sub(" ", page)) if page else ""
    status = m.group(1).lower() if (m := _STATUS_RE.search(text)) else None
    start = es_date_to_iso(m.group(1) if (m := _START_RE.search(text)) else None)
    end = es_date_to_iso(m.group(1) if (m := _END_RE.search(text)) else None)
    total_txt = m.group(1).strip() if (m := _TOTAL_RE.search(text)) else None
    per_project = m.group(1).strip() if (m := _PER_PROJECT_RE.search(text)) else None
    tipo = "Concurrencia competitiva" if _COMPETITIVA_RE.search(link.excerpt) else "Convocatoria pública"
    closed = not end and status and status not in ("abierta", "próxima", "proxima")
    amount = " · ".join(
        x for x in (total_txt and f"Total: {total_txt}", per_project and f"Por proyecto: {per_project}") if x
    )
    return RawOpportunity(
        id=f"fb:{re.sub(r'/$', '', link.url).split('/')[-1]}",
        source="fb",
        source_label="F. Biodiversidad",
        kind="subvencion",
        titulo=link.title,
        organismo=ORGANISMO,
        region="Estatal",
        nivel_admin="Estatal",
        opens_at=start,
        deadline=end,
        deadline_text=f"Convocatoria {status}" if status else None,
        budget=parse_amount(total_txt),
        amount_text=amount or None,
        tipo=tipo,
        url=link.url,
        summary=link.excerpt or None,
        score_input=ScoreInput(
            titulo=link.title,
            organismo=ORGANISMO,
            tipo_convocatoria=tipo,
            extra_text=link.excerpt,
            fecha_inicio_solicitud=start,
            fecha_fin_solicitud=end,
            abierto=True if status == "abierta" else False if status else None,
            kind="subvencion",
        ),
        adjust=FitAdjust(deadline_state="cerrada", cap=50) if closed else None,
    )


class FbSource(Source):
    id = "fb"
    name = "Fundación Biodiversidad"

    async def fetch(self, ctx: SourceContext) -> FetchResult:
        pages = await asyncio.gather(*(ctx.http.text(u, timeout=10) for u in (FB_SEARCH, f"{FB_SEARCH}?sf_paged=2")))
        links: list[FbLink] = []
        seen: set[str] = set()
        for html in pages:
            for link in parse_list(html or ""):
                if link.url not in seen:
                    seen.add(link.url)
                    links.append(link)
        if not links:
            return FetchResult(
                items=[],
                health=SourceHealth(
                    id="fb",
                    name=self.name,
                    category="Web oficial",
                    status="error",
                    count=0,
                    url=FB_SEARCH,
                    note="No se pudo leer el buscador de convocatorias.",
                ),  # fmt: skip
            )

        details = await map_limit(links, 6, lambda link: ctx.http.text(link.url, timeout=10))
        kept = [
            to_raw(link, page) for link, page in zip(links, details, strict=True) if not _BECA_RE.search(link.title)
        ]
        # the note counts open calls: score here for the note only (the ingest stores its own scoring)
        open_count = sum(1 for r in kept if score_raw(r).fit.deadline_state in ("abierta", "proxima"))
        return FetchResult(
            items=kept,
            health=SourceHealth(
                id="fb",
                name=self.name,
                category="Web oficial",
                status="ok",
                count=0,
                url=FB_SEARCH,
                note=f"Buscador oficial (2 páginas) + ficha de cada convocatoria: {{count}} convocatorias, "
                f"{open_count} abiertas o próximas (el resto se muestran cerradas como referencia).",
            ),
        )
