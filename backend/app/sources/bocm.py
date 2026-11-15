"""BOCM (Boletín Oficial de la Comunidad de Madrid): daily XML summaries, walking back ~3 weeks (port of scrapeBocm
in src/lib/sources/multi-source.ts).

Finds the latest summary on the home page, walks back issue by issue, keeps grant calls and open tenders, then
reads every candidate's page for the real "Extracto ..." sentence, the deadline and the purpose.
"""

import re
from datetime import date, timedelta
from typing import NamedTuple

from app.http import map_limit
from app.models import Opportunity, OpportunityDocument, SourceHealth
from app.scoring.score import FitAdjust, ScoreInput
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

HOME = "https://www.bocm.es/"
BOCM_DAYS = 21
ESTIMATED_WARNING = "Fecha límite estimada a partir del plazo en días: confirmar en el texto oficial."

_LATEST_RE = re.compile(r"/boletin/CM_Boletin_BOCM/([0-9]{4})/([0-9]{2})/([0-9]{2})/BOCM-[0-9]{8}([0-9]+)\.xml")
_ORG_RE = re.compile(r'<organismo\s+nombre="([^"]+)">([\s\S]*?)</organismo>')
_DISP_RE = re.compile(r"<disposicion[^>]*>([\s\S]*?)</disposicion>")
_SCRIPT_STYLE_RE = re.compile(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>")
_START_RE = re.compile(
    r"Extracto (?:de |del )|Anuncio de licitaci|Objeto del contrato|por (?:el|la) que se (?:convoca|anuncia)",
    re.IGNORECASE,
)
# JS \b is ASCII-only: (?![A-Za-z0-9_]) after "BDNS"
_EXTRACTO_RE = re.compile(
    r"(Extracto (?:de |del )[\s\S]{20,380}?)(?:\.\s+(?:BDNS|De conformidad)|\s+BDNS(?![A-Za-z0-9_]))", re.IGNORECASE
)
_GENERIC_RE = re.compile(r"R[ée]gimen econ[óo]mico|^Extracto convocatoria", re.IGNORECASE)
_LOCAL_RE = re.compile(r"R[ée]gimen econ[óo]mico", re.IGNORECASE)


class NoticeCandidate(NamedTuple):
    id: str
    fecha: str
    organismo: str
    titulo: str
    url: str
    pdf_url: str | None
    licitacion: bool


def bocm_xml_url(d: date, num: int) -> str:
    y, m, day = f"{d.year}", f"{d.month:02d}", f"{d.day:02d}"
    return f"https://www.bocm.es/boletin/CM_Boletin_BOCM/{y}/{m}/{day}/BOCM-{y}{m}{day}{num}.xml"


def _tag(block: str, tag: str) -> str | None:
    m = re.search(f"<{tag}>([^<]+)</{tag}>", block)
    return m.group(1).strip() if m else None


def parse_bocm_xml(xml: str, fecha: str) -> list[NoticeCandidate]:
    out: list[NoticeCandidate] = []
    for om in _ORG_RE.finditer(xml):
        organismo = decode_html(om.group(1))
        for dm in _DISP_RE.finditer(om.group(2)):
            block = dm.group(1)
            ident = _tag(block, "identificador")
            tm = re.search(r"<titulo>([\s\S]*?)</titulo>", block)
            titulo = decode_html(tm.group(1) if tm else "")
            if not ident or not titulo:
                continue
            t = normalize_text(titulo)
            licitacion = is_open_tender(t)
            if not licitacion and not is_call_notice(t):
                continue
            out.append(
                NoticeCandidate(
                    id=ident,
                    fecha=fecha,
                    organismo=organismo,
                    titulo=re.sub(r"^[^–]{0,80}–\s*", "", titulo, count=1),  # drop the short heading before "–"
                    url=_tag(block, "url_html") or f"https://www.bocm.es/{ident.lower()}",
                    pdf_url=_tag(block, "url_pdf") or None,
                    licitacion=licitacion,
                )
            )
    return out


def to_raw(c: NoticeCandidate, page: str | None) -> RawOpportunity:
    text = decode_html(_SCRIPT_STYLE_RE.sub(" ", page)) if page else ""
    m = _START_RE.search(text)
    start_idx = m.start() if m else 0
    body = text[start_idx : start_idx + 15000]
    deadline_text, summary = extract_notice_details(body)
    em = _EXTRACTO_RE.match(body)
    extracto = em.group(1) if em else None
    generic = not c.licitacion and _GENERIC_RE.search(c.titulo) is not None
    titulo = (f"{c.titulo.split('.')[0]}. {extracto}" if generic and extracto else c.titulo).strip()
    explicit = parse_deadline(deadline_text)
    deadline = explicit or deadline_from_days(c.fecha, deadline_text)
    local = _LOCAL_RE.search(c.titulo) is not None or re.search("ayuntamiento", c.organismo, re.IGNORECASE) is not None
    kind = "licitacion" if c.licitacion else "boletin"
    tipo_convocatoria = (
        "Licitación pública"
        if c.licitacion
        else "Concurrencia competitiva"
        if re.search("concurrencia competitiva", body, re.IGNORECASE)
        else "Convocatoria (BOCM)"
    )
    return RawOpportunity(
        id=f"bocm:{c.id}",
        source="bocm",
        source_label="BOCM · Licitación" if c.licitacion else "BOCM",
        kind=kind,
        titulo=titulo,
        organismo=c.organismo,
        region="Comunidad de Madrid",
        nivel_admin="Local" if local else "Autonómica",
        published_at=c.fecha,
        deadline=deadline,
        deadline_estimated=bool(deadline) and not explicit,
        deadline_text=deadline_text,
        tipo="Licitación pública" if c.licitacion else "Convocatoria / extracto",
        url=c.url,
        documents=[OpportunityDocument(name=f"{c.id}.pdf", description="Texto oficial (PDF)", url=c.pdf_url)]
        if c.pdf_url
        else [],
        summary=summary,
        score_input=ScoreInput(
            titulo=titulo,
            organismo=c.organismo,
            region="Comunidad de Madrid",
            tipo_convocatoria=tipo_convocatoria,
            extra_text=summary or "",
            fecha_inicio_solicitud=c.fecha,
            fecha_fin_solicitud=deadline,
            deadline_estimated=bool(deadline) and not explicit,
            kind=kind,
        ),
        adjust=FitAdjust(append_warnings=[ESTIMATED_WARNING]) if deadline and not explicit else None,
    )


def _health(status: str, note: str) -> SourceHealth:
    return SourceHealth(
        id="bocm", name="BOCM · Comunidad de Madrid", category="Boletín Oficial", status=status, count=0, url=HOME,
        note=note,
    )  # fmt: skip


class BocmSource(Source):
    id = "bocm"
    name = "BOCM · Comunidad de Madrid"

    async def fetch(self, ctx: SourceContext) -> FetchResult:
        html = await ctx.http.text(HOME, timeout=9)
        latest = _LATEST_RE.search(html) if html else None
        if not latest:
            return FetchResult(items=[], health=_health("error", "No se encontró el sumario XML del último BOCM."))

        d = date(int(latest.group(1)), int(latest.group(2)), int(latest.group(3)))
        num = int(latest.group(4))
        xmls: list[tuple[str, str]] = []
        first = await ctx.http.text(bocm_xml_url(d, num), timeout=9)
        if first:
            xmls.append((first, d.isoformat()))

        # Walk back: each publication day decrements the issue number by 1 (Sundays have no issue).
        misses = 0
        i = 1
        while i <= BOCM_DAYS and misses < 4:
            d -= timedelta(days=1)
            xml = await ctx.http.text(bocm_xml_url(d, num - 1), timeout=6)
            if xml:
                num -= 1
                misses = 0
                xmls.append((xml, d.isoformat()))
            else:
                misses += 1
            i += 1

        candidates = [c for xml, fecha in xmls for c in parse_bocm_xml(xml, fecha)][:140]
        # BOCM titles are often generic ("Móstoles. Régimen económico. Extracto convocatoria subvenciones"),
        # so read every candidate's page and use the real "Extracto ... por el que se convoca ..." sentence.
        pages = await map_limit(candidates, 6, lambda c: ctx.http.text(c.url, timeout=8))
        items = [to_raw(c, page) for c, page in zip(candidates, pages, strict=True)]
        return FetchResult(
            items=items,
            health=_health(
                "ok",
                f"Sumarios XML oficiales de {len(xmls)} boletines (últimos {BOCM_DAYS} días): {len(candidates)} "
                "convocatorias/licitaciones, {count} con encaje ambiental.",
            ),
        )

    def keep(self, o: Opportunity) -> bool:
        return len(o.fit.work_lines) > 0 and o.fit.score >= 35
