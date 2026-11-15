"""DOG (Diario Oficial de Galicia): sections I-III and VI, last ~6 weeks (port of scrapeDog in
src/lib/sources/multi-source.ts).

Reads the daily tables of contents, keeps grant calls and open tenders, pre-scores them on title + organism to
pick the relevant ones, then reads each notice for the deadline and purpose.
"""

import re
from datetime import UTC, timedelta
from typing import NamedTuple

from app.config import local_now, settings
from app.http import map_limit
from app.models import OpportunityDocument, SourceHealth
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

PORTAL = "https://www.xunta.gal/diario-oficial-galicia"
DOG_DAYS = 45
ESTIMATED_WARNING = "Fecha límite estimada a partir del plazo en días: confirmar en el texto oficial."

# walk the TOC in order so each entry gets the last organism heading seen
_TOKEN_RE = re.compile(
    r'<p class="dog-toc-organismo">([\s\S]*?)</p>|<li class="dog-toc-sumario"><a href="([^"]+)"[^>]*>([\s\S]*?)</a>'
)


class DogPage(NamedTuple):
    url: str
    fecha: str


class NoticeCandidate(NamedTuple):
    id: str
    fecha: str
    organismo: str
    titulo: str
    url: str
    pdf_url: str
    licitacion: bool


def summary_pages() -> list[DogPage]:
    """Sections 1 and 3 of every Monday-Friday of the last DOG_DAYS days (JS: Date.now() - i * 86400000)."""
    now = local_now().astimezone(UTC)
    pages: list[DogPage] = []
    for i in range(DOG_DAYS):
        d = (now - timedelta(days=i)).astimezone(settings.tz)
        if d.weekday() >= 5:
            continue  # DOG publishes Mon-Fri
        key = d.strftime("%Y%m%d")
        for s in (1, 3):
            url = f"https://www.xunta.gal/dog/Publicados/{d.year}/{key}/Secciones{s}_es.html"
            pages.append(DogPage(url, d.date().isoformat()))
    return pages


def parse_toc(html: str, fecha: str, seen: set[str]) -> list[NoticeCandidate]:
    out: list[NoticeCandidate] = []
    organismo = "Xunta de Galicia"
    for m in _TOKEN_RE.finditer(html):
        if m.group(1) is not None:
            organismo = decode_html(m.group(1))
            continue
        href = m.group(2)
        titulo = decode_html(m.group(3))
        if href in seen or len(titulo) < 20:
            continue
        t = normalize_text(titulo)
        licitacion = is_open_tender(t)
        if not licitacion and not is_call_notice(t):
            continue
        seen.add(href)
        url = f"https://www.xunta.gal{href}"
        out.append(
            NoticeCandidate(
                id=re.sub(r"\.html$", "", href.split("/")[-1]) or href,
                fecha=fecha,
                organismo=organismo,
                titulo=titulo,
                url=url,
                pdf_url=re.sub(r"\.html$", ".pdf", url, flags=re.IGNORECASE),
                licitacion=licitacion,
            )
        )
    return out


def _tipo_convocatoria(c: NoticeCandidate) -> str:
    return "Licitación pública" if c.licitacion else "Convocatoria (DOG)"


def _kind(c: NoticeCandidate) -> str:
    return "licitacion" if c.licitacion else "boletin"


def to_raw(c: NoticeCandidate, page: str | None) -> RawOpportunity:
    deadline_text, summary = extract_notice_details(decode_html(page)[:20000]) if page else (None, None)
    explicit = parse_deadline(deadline_text)
    deadline = explicit or deadline_from_days(c.fecha, deadline_text)
    return RawOpportunity(
        id=f"dog:{c.id}",
        source="dog",
        source_label="DOG · Licitación" if c.licitacion else "DOG",
        kind=_kind(c),
        titulo=c.titulo,
        organismo=c.organismo,
        region="Galicia",
        nivel_admin="Autonómica",
        published_at=c.fecha,
        deadline=deadline,
        deadline_estimated=bool(deadline) and not explicit,
        deadline_text=deadline_text,
        tipo="Licitación pública" if c.licitacion else "Convocatoria / bases",
        url=c.url,
        documents=[OpportunityDocument(name=f"{c.id}.pdf", description="Texto oficial (PDF)", url=c.pdf_url)]
        if c.pdf_url
        else [],
        summary=summary,
        score_input=ScoreInput(
            titulo=c.titulo,
            organismo=c.organismo,
            region="Galicia",
            tipo_convocatoria=_tipo_convocatoria(c),
            extra_text=summary or "",
            fecha_inicio_solicitud=c.fecha,
            fecha_fin_solicitud=deadline,
            deadline_estimated=bool(deadline) and not explicit,
            kind=_kind(c),
        ),
        adjust=FitAdjust(append_warnings=[ESTIMATED_WARNING]) if deadline and not explicit else None,
    )


class DogSource(Source):
    id = "dog"
    name = "DOG · Diario Oficial de Galicia"

    async def fetch(self, ctx: SourceContext) -> FetchResult:
        pages = summary_pages()
        htmls = await map_limit(pages, 6, lambda p: ctx.http.text(p.url, timeout=8))
        ok_pages = sum(1 for h in htmls if h)
        seen: set[str] = set()
        candidates = [c for p, html in zip(pages, htmls, strict=True) if html for c in parse_toc(html, p.fecha, seen)]

        # pre-score on title + organism to choose which notices to read (never stored)
        def relevant(c: NoticeCandidate) -> bool:
            pre = score_convocatoria(
                ScoreInput(
                    titulo=c.titulo,
                    organismo=c.organismo,
                    region="Galicia",
                    tipo_convocatoria=_tipo_convocatoria(c),
                    kind=_kind(c),
                )
            )
            return len(pre.work_lines) > 0 and pre.score >= 35

        chosen = [c for c in candidates if relevant(c)]
        notices = await map_limit(chosen, 5, lambda c: ctx.http.text(c.url, timeout=8))
        items = [to_raw(c, page) for c, page in zip(chosen, notices, strict=True)]
        return FetchResult(
            items=items,
            health=SourceHealth(
                id="dog",
                name=self.name,
                category="Boletín Oficial",
                status="error" if ok_pages == 0 else "ok",
                count=0,
                url=PORTAL,
                note=f"{ok_pages} sumarios (secciones I-III y VI, últimos {DOG_DAYS} días): {len(candidates)} "
                "convocatorias/licitaciones, {count} con encaje ambiental.",
            ),
        )
