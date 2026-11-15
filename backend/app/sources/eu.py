"""EU Funding & Tenders (SEDIA search API): LIFE + nature/forest topics (port of scrapeEu in
src/lib/sources/multi-source.ts).

Five searches (all LIFE calls, plus forest / biodiversity / nature-restoration / invasive-species topics), open or
forthcoming calls with a future deadline only. English titles are mapped to Spanish topic terms for the scorer.
"""

import asyncio
import json
import math
import re
import uuid
from typing import Any
from urllib.parse import quote

from app.config import local_now
from app.models import SourceHealth
from app.scoring.score import FitAdjust, ScoreInput
from app.sources.base import FetchResult, RawOpportunity, Source, SourceContext
from app.sources.notices import decode_html

SEDIA_URL = "https://api.tech.ec.europa.eu/search-api/prod/rest/search"
LIFE_ID = "43252405"
HORIZON_ID = "43108390"
PORTAL = "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals"
TOPIC_URL = "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/"
QUERIES: tuple[tuple[str, str | None], ...] = (
    ("***", LIFE_ID),
    ("forest", None),
    ("biodiversity restoration", None),
    ("nature restoration", HORIZON_ID),
    ("invasive species", None),
)
HORIZON_WARNING = (
    "Horizon Europe: proyecto de investigación en consorcio internacional; Reforesta encajaría como socio de "
    "demostración, no como líder."
)
LIFE_REASON = "Programa LIFE: el instrumento europeo de referencia para naturaleza y biodiversidad."
# LIFE has four sub-programmes, named in the call identifier (LIFE-2025-SAP-NAT, LIFE-2025-CET-EUCF…). Only "NAT" is
# nature and biodiversity; clean energy ("CET") is not Reforesta's field at all (ADR 0042).
LIFE_OTHER_REASON = "Programa LIFE: el programa europeo de medio ambiente y acción por el clima."
LIFE_CET_WARNING = (
    "Subprograma LIFE de transición a la energía limpia: es de energía, no de naturaleza ni biodiversidad."
)
LOCAL_WARNING = "Dirigida principalmente a municipios / autoridades locales."

# English topic terms -> Spanish equivalents understood by the scorer. JS regex \b is ASCII-only: re.ASCII.
EN_TOPIC: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(p, re.ASCII), es)
    for p, es in (
        (r"\bbiodiversit", "biodiversidad"),
        (r"\bforest", "forestal bosque"),
        (r"\b(re|af)forest", "reforestacion"),
        (
            r"\bnature restoration|\becosystem restoration|\brestor(e|ation) (of )?(ecosystems|habitats|nature)",
            "restauracion ecologica",
        ),
        (r"\bnature\b|\bnatural capital", "medio natural"),
        (r"\becosystem", "ecosistema"),
        (r"\bhabitat", "habitat"),
        (r"\binvasive (alien )?species", "especies invasoras"),
        (r"\bwetland", "humedal"),
        (r"\bpollinat", "polinizador"),
        (r"\bagroforest", "agroforestal"),
        (r"\bbirds?\b", "avifauna"),
        (r"\bclimate (change )?adaptation", "cambio climatico"),
        (r"\bnature-based solution", "soluciones basadas en la naturaleza"),
        (r"\benvironmental education|\bcitizen science", "educacion ambiental"),
        (r"\bnatura 2000", "red natura"),
    )  # fmt: skip
)
EU_OFFTOPIC = re.compile(
    r"\b(space|aircraft|batter|hydrogen|semiconductor|quantum|cyber|terroris|vehicle|hydropower|pv |photovoltaic|"
    r"ccus|grid|microbiome|livestock|aquatic food|footwear|plastic|construction|electronics|dementia|migration|"
    r"labour|heritage|creative|ai-powered|artificial intelligence|antarctica|food system|protective gear|disaster|"
    r"smuggled|police|policing)",
    re.ASCII,
)
_LOCAL_RE = re.compile(r"municipalit|local authorit|cities\b", re.ASCII)


def _multipart(parts: dict[str, Any]) -> tuple[bytes, str]:
    """Body and content type of a FormData whose fields are JSON Blobs (as the TS sends them)."""
    boundary = f"----formdata-radar-{uuid.uuid4().hex}"
    body = b"".join(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="blob"\r\n'
        f"Content-Type: application/json\r\n\r\n{json.dumps(value, separators=(',', ':'))}\r\n".encode()
        for name, value in parts.items()
    )
    return body + f"--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


async def sedia_search(
    ctx: SourceContext, text: str, programme: str | None, page_size: int
) -> list[dict[str, Any]] | None:
    must: list[Any] = [{"terms": {"type": ["1", "2", "8"]}}, {"terms": {"status": ["31094501", "31094502"]}}]
    if programme:
        must.append({"terms": {"frameworkProgramme": [programme]}})
    body, content_type = _multipart(
        {
            "query": {"bool": {"must": must}},
            "languages": ["en"],
            "sort": {"field": "deadlineDate", "order": "DESC"},
        }
    )
    url = f"{SEDIA_URL}?apiKey=SEDIA&text={quote(text, safe="-_.!~*'()")}&pageSize={page_size}&pageNumber=1"
    res = await ctx.http.json(url, method="POST", content=body, headers={"Content-Type": content_type}, timeout=18)
    if res is None:
        return None
    return res.get("results")  # JS `json?.results ?? null`


def next_future_deadline(dates: list[str] | None) -> str | None:
    today = local_now().date().isoformat()
    future = sorted(d[:10] for d in dates or [] if d[:10] >= today)
    return future[0] if future else None


def _first(m: dict[str, Any], key: str) -> Any:
    v = m.get(key)
    return v[0] if v else None


def _js_number(s: Any) -> float:
    """JS Number(x) for a string or undefined (NaN when not numeric)."""
    if s is None:
        return math.nan
    t = str(s).strip()
    if not t:
        return 0.0
    try:
        return float(t)
    except ValueError:
        return math.nan


def to_raw(m: dict[str, Any], identifier: str, deadline: str) -> RawOpportunity | None:
    """Map one SEDIA result's metadata; None when off-topic."""
    fp = _first(m, "frameworkProgramme")
    programme = "LIFE" if fp == LIFE_ID else "Horizon Europe" if fp == HORIZON_ID else "UE"
    title = decode_html(_first(m, "title") or _first(m, "callTitle") or identifier)
    description = decode_html(_first(m, "description") or _first(m, "descriptionByte") or "")[:2000]
    en_text = f"{title} {description}".lower()
    is_life = programme == "LIFE"
    title_lc = title.lower()
    if not is_life and EU_OFFTOPIC.search(title_lc):
        return None
    es_terms = [es for r, es in EN_TOPIC if r.search(title_lc)]
    es_desc_terms = [es for r, es in EN_TOPIC if r.search(en_text)]
    if not is_life and not es_terms:
        return None  # title must be on-topic for non-LIFE

    start = _first(m, "startDate")
    opens_at = start[:10] if start is not None else None
    delta, cap = 0, None
    prepend: list[str] = []
    warnings: list[str] = []
    if programme == "Horizon Europe":
        delta, cap = -12, 58
        warnings.append(HORIZON_WARNING)
    elif is_life:
        parts = identifier.upper().split("-")
        if "CET" in parts:
            warnings.append(LIFE_CET_WARNING)
        else:
            prepend.append(LIFE_REASON if "NAT" in parts else LIFE_OTHER_REASON)
    if _LOCAL_RE.search(title_lc):
        warnings.append(LOCAL_WARNING)

    budget = _js_number(_first(m, "budget"))
    url = _first(m, "url") if _first(m, "type") == "8" and _first(m, "url") else f"{TOPIC_URL}{identifier.lower()}"
    return RawOpportunity(
        id=f"eu:{identifier}",
        source="eu",
        source_label="UE · LIFE" if is_life else f"UE · {programme}",
        kind="europa",
        titulo=title,
        organismo=f"Comisión Europea · {programme} ({identifier})",
        region="Unión Europea",
        nivel_admin="UE",
        opens_at=opens_at,
        deadline=deadline,
        budget=budget if math.isfinite(budget) and budget > 0 else None,
        tipo="Convocatoria UE (concurrencia competitiva)",
        beneficiarios=[],
        url=url,
        summary=description[:400] if description else None,
        score_input=ScoreInput(
            titulo=" ".join(es_terms) or title,
            organismo=f"Comisión Europea · {programme}",
            tipo_convocatoria="Concurrencia competitiva (UE)",
            fecha_inicio_solicitud=opens_at,
            fecha_fin_solicitud=deadline,
            extra_text=" ".join(es_desc_terms),
            kind="europa",
        ),
        adjust=FitAdjust(delta=delta, cap=cap, prepend_reasons=prepend, append_warnings=warnings),
    )


class EuSource(Source):
    id = "eu"
    name = "UE · Funding & Tenders (LIFE, Horizon)"

    async def fetch(self, ctx: SourceContext) -> FetchResult:
        results = await asyncio.gather(*(sedia_search(ctx, t, p, 100) for t, p in QUERIES))
        ok_count = sum(1 for r in results if r is not None)
        seen: set[str] = set()
        items: list[RawOpportunity] = []
        for r in (x for page in results for x in page or []):
            m = (r or {}).get("metadata")
            if not m:
                continue
            identifier = _first(m, "identifier") or _first(m, "callIdentifier") or ""
            if not identifier or identifier in seen or identifier.endswith("-CANCELLED"):
                continue
            deadline = next_future_deadline(m.get("deadlineDate"))
            if not deadline:
                continue  # all deadlines past
            raw = to_raw(m, identifier, deadline)
            if raw is None:
                continue
            seen.add(identifier)
            items.append(raw)

        return FetchResult(
            items=items,
            health=SourceHealth(
                id="eu",
                name=self.name,
                category="Portal UE",
                status="error" if ok_count == 0 else "partial" if ok_count < len(QUERIES) else "ok",
                count=0,
                url=PORTAL,
                note="API SEDIA OK, pero ninguna convocatoria LIFE/naturaleza con plazo futuro en este momento."
                if not items and ok_count > 0
                else f"API SEDIA oficial: {len(QUERIES)} búsquedas (LIFE + bosques/biodiversidad/restauración), "
                "solo con plazo futuro.",
            ),
        )
