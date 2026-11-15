"""History of a BDNS call: its previous editions (when it usually opens, for how long) and who won them.

BDNS has no series identifier, and regulatory bases are not a usable key. For each current call:

1. Resolve its organ to BDNS organ ids: the detail carries organ NAMES only (`organo.nivel2`, `nivel3`); the organ
   trees (`/organos?idAdmon=C|A|L`) map (parent name, name) to id(s). Some pairs have 2 ids (both are used), a few
   none (no history).
2. List every call of that organ since 2018 and match titles locally (`match_editions`): published before the
   current one, Jaccard >= 0.5 on title tokens without boilerplate and the organ's own name, at most one per calendar
   year (the best). On a research sample this made 0 wrong links in 42; true matches go down to 0.50.
3. Read the newest previous editions: detail (opening date, window) and awards (`concesiones`, from 2022 only).

Privacy: award rows name natural persons. `reduce_awards` keeps only counts by NIF class, amounts, dates and hits of
the curated NGO list; raw award responses are never memoised, stored or logged.
"""

import re
from collections import Counter
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any
from urllib.parse import quote

from app.models import AwardsSummary, EditionAwards, History, HistoryEdition, ReforestaWin, TypicalOpening
from app.scoring.text import normalize_text
from app.sources.base import SourceContext
from app.sources.bdns import BDNS_BASE, RETRIES, fetch_detail

DAY_S = 86400
HISTORY_SINCE = "01/01/2018"
# BDNS publishes awards from 2022-01-01 and they appear 3-8 months after the call: older editions have none.
AWARDS_FROM = "2021-05-01"
MAX_PREVIOUS = 4  # previous editions read in detail; with the current one, the last 5 editions
MIN_JACCARD = 0.5  # do not raise: true matches go down to 0.50
AWARD_PAGES = 5  # x 2 000 rows

REFORESTA_NIF = "G80428204"
# Curated by NIF (each checked with /terceros?vpd=GE&ambito=C on 2026-11-15), never by name search.
PEERS = {
    "G28795961": "SEO/BirdLife",
    "G28766319": "WWF España",
    "G78423795": "Ecologistas en Acción",
    "G78456118": "GREFA",
    "G80707839": "Fundación Global Nature",
    "G83985028": "Territorios Vivos",
    "G28674125": "Amigos de la Tierra",
}

# First character of the beneficiary NIF. No beneficiary-type field exists in BDNS.
_NIF_CLASS = {
    "G": "sinAnimo",  # associations, foundations
    "A": "empresa",
    "B": "empresa",
    "C": "empresa",
    "D": "empresa",
    "U": "empresa",
    "W": "empresa",
    "P": "ayuntamiento",  # local bodies
    "Q": "publico",  # universities, CSIC, public agencies
    "S": "publico",
    "F": "cooperativa",
    "J": "sociedadCivil",
    "R": "religiosa",
}
NON_PROFIT = "sinAnimo"

_TOKEN = re.compile(r"[a-z0-9]+")
_STOP = frozenset(("a", "al", "amb", "con", "d", "de", "del", "e", "el", "en", "i", "la", "las", "les", "los", "o",
                   "para", "per", "por", "que", "se", "sin", "su", "sus", "y"))  # fmt: skip
_BOILERPLATE = frozenset(("ano", "anualidad", "aprueba", "aprueban", "ayuda", "ayudas", "bases", "competitiva",
                          "concurrencia", "convoca", "convocan", "convocatoria", "convocatorias", "edicion",
                          "ejercicio", "extracto", "orden", "publica", "publicas", "publicacion", "regimen",
                          "reguladoras", "resolucion", "subvencion", "subvenciones"))  # fmt: skip


def _key(s: str | None) -> str:
    return " ".join(_TOKEN.findall(normalize_text(s or "")))


def _enc(s: str) -> str:
    return quote(s, safe="")


def call_url(numero: str) -> str:
    return f"https://www.infosubvenciones.es/bdnstrans/GE/es/convocatoria/{numero}"


# ---------- organs ----------

type OrganIndex = dict[tuple[str, str], list[int]]


def flatten_organs(tree: list[dict[str, Any]], parent: str = "") -> list[list[Any]]:
    """[[parent name, name, id], ...] for every node of an /organos tree (depth 2 for C and A, 3 for L)."""
    out: list[list[Any]] = []
    for n in tree or []:
        out.append([parent, n.get("descripcion") or "", n.get("id")])
        out.extend(flatten_organs(n.get("children") or [], n.get("descripcion") or ""))
    return out


def organ_index(triples: list[list[Any]]) -> OrganIndex:
    idx: dict[tuple[str, str], set[int]] = {}
    for parent, name, oid in triples:
        idx.setdefault((_key(parent), _key(name)), set()).add(oid)
    return {k: sorted(v) for k, v in idx.items()}


def resolve_organ(idx: OrganIndex, organo: dict[str, Any]) -> list[int]:
    """Organ ids of a detail's `organo` ({nivel1, nivel2, nivel3}); [] when unknown (e.g. OTROS without nivel3)."""
    if not organo.get("nivel3"):
        return []
    return idx.get((_key(organo.get("nivel2")), _key(organo.get("nivel3"))), [])


# ---------- matching ----------


@dataclass(frozen=True)
class ListedCall:
    numero: str
    title: str
    published_at: str  # YYYY-MM-DD (fechaRecepcion)


def title_tokens(title: str, organ_tokens: frozenset[str] = frozenset()) -> frozenset[str]:
    """Lowercased, accent-free title words without numbers/years, stopwords, boilerplate and the organ's name."""
    return frozenset(
        t
        for t in _TOKEN.findall(normalize_text(title))
        if len(t) > 2
        and not any(c.isdigit() for c in t)
        and t not in _STOP
        and t not in _BOILERPLATE
        and t not in organ_tokens
    )


def jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    return len(a & b) / len(a | b) if a | b else 0.0


def match_editions(current: ListedCall, organ_tokens: frozenset[str], listed: list[ListedCall]) -> list[ListedCall]:
    """Previous editions of `current` among its organ's calls, newest first: published before it, Jaccard >= 0.5,
    at most one per calendar year (the best; the current edition already takes its own year)."""
    mine = title_tokens(current.title, organ_tokens)
    best: dict[str, tuple[float, ListedCall]] = {}
    for c in listed:
        year = c.published_at[:4]
        if c.numero == current.numero or c.published_at >= current.published_at or year == current.published_at[:4]:
            continue
        j = jaccard(mine, title_tokens(c.title, organ_tokens))
        if j < MIN_JACCARD:
            continue
        prev = best.get(year)
        if prev is None or (j, c.published_at) > (prev[0], prev[1].published_at):
            best[year] = (j, c)
    return sorted((c for _, c in best.values()), key=lambda c: c.published_at, reverse=True)


# ---------- edition details ----------

_WINDOW = re.compile(
    r"\b([0-9]{1,3}|un|uno|dos|tres|cinco|diez|quince|veinte|treinta|cuarenta|sesenta)\s+"
    r"(dias|dia|dies|meses|mesos|mes)\b\s*(habiles|habils|naturales|naturals)?"
)
_NUMBER_WORDS = {"un": 1, "uno": 1, "dos": 2, "tres": 3, "cinco": 5, "diez": 10, "quince": 15, "veinte": 20,
                 "treinta": 30, "cuarenta": 40, "sesenta": 60}  # fmt: skip


def window_phrase(text_fin: str | None, start: str | None, end: str | None) -> str | None:
    """Application window: the term the call states ("10 días hábiles") or, without one, the days between dates."""
    if text_fin and (m := _WINDOW.search(normalize_text(text_fin))):
        n = int(m[1]) if m[1].isdigit() else _NUMBER_WORDS[m[1]]
        if n > 0:
            if m[2].startswith("mes"):
                return "1 mes" if n == 1 else f"{n} meses"
            kind = " hábiles" if (m[3] or "").startswith("habil") else " naturales" if m[3] else ""
            return f"{n} día{'' if n == 1 else 's'}{kind}"
    if start and end:
        try:
            days = (date.fromisoformat(end[:10]) - date.fromisoformat(start[:10])).days + 1
        except ValueError:
            return None
        if days > 0:
            return f"{days} días naturales"
    return None


def opening_date(d: dict[str, Any]) -> str | None:
    """Start of applications, else the journal extract date, else the BDNS registration date."""
    if d.get("fechaInicioSolicitud"):
        return d["fechaInicioSolicitud"][:10]
    published = sorted(a["datPublicacion"][:10] for a in d.get("anuncios") or [] if a.get("datPublicacion"))
    return published[0] if published else (d.get("fechaRecepcion") or "")[:10] or None


def slim_detail(d: dict[str, Any]) -> dict[str, str | None]:
    return {
        "opened_at": opening_date(d),
        "closes_at": (d.get("fechaFinSolicitud") or "")[:10] or None,
        "window": window_phrase(d.get("textFin"), d.get("fechaInicioSolicitud"), d.get("fechaFinSolicitud")),
    }


# ---------- awards ----------


def nif_class(nif: str) -> str:
    """Kind of beneficiary from its NIF. Masked (`***1234**`), DNI and NIE identifiers are natural persons."""
    c = nif[:1].upper()
    if not c:
        return "otra"
    if c == "*" or c.isdigit() or c in "XYZKLM":
        return "persona"
    return _NIF_CLASS.get(c, "otra")


def reduce_awards(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Counts only: the beneficiary string ("NIF NAME") never leaves this function."""
    by_class: Counter[str] = Counter()
    importe = 0.0
    dates: list[str] = []
    reforesta: float | None = None
    peers: set[str] = set()
    for r in rows:
        nif = (r.get("beneficiario") or "").strip().split(" ", 1)[0].upper()
        amount = float(r.get("importe") or 0)
        by_class[nif_class(nif)] += 1
        importe += amount
        if r.get("fechaConcesion"):
            dates.append(r["fechaConcesion"][:10])
        if nif == REFORESTA_NIF:
            reforesta = (reforesta or 0) + amount
        elif nif in PEERS:
            peers.add(nif)
    return {
        "count": len(rows),
        "byClass": dict(by_class),
        "importe": round(importe, 2),
        "first": min(dates, default=None),
        "last": max(dates, default=None),
        "reforesta": reforesta,
        "peers": sorted(peers),
    }


def awards_ttl_days(summary: dict[str, Any], published_at: str, today: date) -> int:
    """Settled (newest award > 6 months old): 90 d. Nothing yet on a call under a year old: 7 d. Else 30 d."""
    if summary.get("last") and date.fromisoformat(summary["last"]) < today - timedelta(days=182):
        return 90
    if not summary.get("count") and date.fromisoformat(published_at) > today - timedelta(days=365):
        return 7
    return 30


# ---------- fetching (memoised in fetch_cache) ----------


async def fetch_organ_index(ctx: SourceContext) -> OrganIndex:
    triples: list[list[Any]] = []
    for admin in ("C", "A", "L"):  # state, regions, local bodies ("O": universities and others, no history)

        async def get(admin: str = admin) -> list[list[Any]] | None:
            tree = await ctx.http.json(f"{BDNS_BASE}/organos?vpd=GE&idAdmon={admin}", timeout=30, retries=RETRIES)
            return None if tree is None else flatten_organs(tree)

        triples.extend(await ctx.memo.get(f"bdns:organos:{admin}", 7 * DAY_S, get, persist=True) or [])
    return organ_index(triples)


async def fetch_organ_calls(ctx: SourceContext, ids: list[int]) -> list[ListedCall] | None:
    key = ",".join(map(str, ids))

    async def get() -> list[list[str]] | None:
        res = await ctx.http.json(
            f"{BDNS_BASE}/convocatorias/busqueda?vpd=GE&organos={_enc(key)}&fechaDesde={_enc(HISTORY_SINCE)}"
            "&order=fechaRecepcion&direccion=desc&pageSize=2000&page=0",
            timeout=30,
            retries=RETRIES,
        )
        if res is None:
            return None
        return [
            [r["numeroConvocatoria"], r.get("descripcion") or "", (r.get("fechaRecepcion") or "")[:10]]
            for r in res.get("content") or []
        ]

    rows = await ctx.memo.get(f"bdns:organ-calls:{key}", 7 * DAY_S, get, persist=True)
    return None if rows is None else [ListedCall(*r) for r in rows]


async def fetch_edition(ctx: SourceContext, numero: str) -> dict[str, str | None] | None:
    async def get() -> dict[str, str | None] | None:
        d = await ctx.http.json(f"{BDNS_BASE}/convocatorias?numConv={_enc(numero)}&vpd=GE", timeout=8, retries=RETRIES)
        return None if d is None else slim_detail(d)

    return await ctx.memo.get(f"bdns:edition:{numero}", 90 * DAY_S, get, persist=True)


async def fetch_awards(ctx: SourceContext, numero: str, published_at: str, today: date) -> dict[str, Any] | None:
    async def get() -> dict[str, Any] | None:
        rows: list[dict[str, Any]] = []
        for page in range(AWARD_PAGES):
            res = await ctx.http.json(
                f"{BDNS_BASE}/concesiones/busqueda?vpd=GE&numeroConvocatoria={_enc(numero)}&pageSize=2000&page={page}",
                timeout=20,
                retries=RETRIES,
            )
            if res is None:
                return None
            rows.extend(res.get("content") or [])
            if res.get("last", True):
                break
        return reduce_awards(rows)  # the memo (fetch_cache) gets the reduced summary, never the raw rows

    return await ctx.memo.get(
        f"bdns:awards:{numero}", lambda s: awards_ttl_days(s, published_at, today) * DAY_S, get, persist=True
    )


@dataclass
class EditionRow:
    """One row of bdns_editions. The current edition is a row too (numero == call_numero, no awards)."""

    call_numero: str
    numero: str
    organ_ids: str
    title: str
    published_at: str
    opened_at: str | None
    closes_at: str | None
    window: str | None
    awards: dict[str, Any] | None = None  # reduce_awards() output; None = not checked

    @property
    def is_current(self) -> bool:
        return self.numero == self.call_numero


async def call_editions(
    ctx: SourceContext,
    numero: str,
    organs: OrganIndex,
    organ_calls: Callable[[list[int]], Awaitable[list[ListedCall] | None]],
    today: date,
) -> list[EditionRow] | None:
    """Rows for one current call: [] when no previous edition is found, None when a fetch failed (keep old rows)."""
    d = await fetch_detail(ctx, numero)
    if d is None:
        return None
    organo = d.get("organo") or {}
    published = (d.get("fechaRecepcion") or "")[:10]
    ids = resolve_organ(organs, organo)
    if not ids or not published:
        return []
    listed = await organ_calls(ids)
    if listed is None:
        return None
    organ_tokens = frozenset(_TOKEN.findall(normalize_text(f"{organo.get('nivel2') or ''} {organo.get('nivel3')}")))
    current = ListedCall(numero, d.get("descripcion") or "", published)
    previous = match_editions(current, organ_tokens, listed)[:MAX_PREVIOUS]
    if not previous:
        return []
    organ_ids = ",".join(map(str, ids))
    rows = [EditionRow(numero, numero, organ_ids, current.title, published, **slim_detail(d))]
    for c in previous:
        det = await fetch_edition(ctx, c.numero) or {}
        awards = await fetch_awards(ctx, c.numero, c.published_at, today) if c.published_at >= AWARDS_FROM else None
        opened = det.get("opened_at") or c.published_at
        closes, window = det.get("closes_at"), det.get("window")
        rows.append(EditionRow(numero, c.numero, organ_ids, c.title, c.published_at, opened, closes, window, awards))
    return rows


# ---------- the `history` object (read time) ----------

MONTHS = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
          "noviembre", "diciembre")  # fmt: skip


def typical_opening(editions: list[EditionRow]) -> TypicalOpening | None:
    """Month range of the opening dates (current + previous editions), measured around the year end if shorter."""
    months = [int(e.opened_at[5:7]) for e in editions if e.opened_at]
    if len(months) < 2:
        return None
    spread, start = min((max((x - m) % 12 for x in months), m) for m in months)
    end = (start - 1 + spread) % 12 + 1
    years = sorted({int(e.published_at[:4]) for e in editions}, reverse=True)
    irregular = any(a - b >= 2 for a, b in zip(years, years[1:], strict=False))
    if irregular:
        text = "Convocatoria irregular: no sale todos los años"
    elif spread == 0:
        text = f"Suele abrir en {MONTHS[start - 1]}"
    elif spread <= 2:
        text = f"Suele abrir entre {MONTHS[start - 1]} y {MONTHS[end - 1]}"
    else:
        text = f"Ha abierto entre {MONTHS[start - 1]} y {MONTHS[end - 1]}"
    return TypicalOpening(from_=start, to=end, text=text, irregular=irregular)


def typical_window(editions: list[EditionRow]) -> str | None:
    """Most frequent window; a tie goes to the newest edition."""
    phrases = [e.window for e in editions if e.window]
    return max(phrases, key=phrases.count) if phrases else None


def awards_summary(previous: list[EditionRow]) -> AwardsSummary | None:
    """Counts from the last 2 previous editions with awards; Reforesta and peer wins from every checked one."""
    checked = [(e, e.awards) for e in previous if e.awards is not None]
    if not checked:
        return None
    recent = [(e, a) for e, a in checked if a["count"] > 0][:2]
    by_class: Counter[str] = Counter()
    for _, a in recent:
        by_class.update(a["byClass"])
    total = sum(by_class.values())
    non_profit = by_class.get(NON_PROFIT, 0)
    hits = {nif for _, a in checked for nif in a.get("peers") or []}
    return AwardsSummary(
        editions=[int(e.published_at[:4]) for e, _ in recent],
        total=total,
        non_profit=non_profit,
        non_profit_share=round(non_profit / total, 2) if total else 0.0,
        by_class=dict(by_class.most_common()),
        won_by_reforesta=[
            ReforestaWin(year=int(e.published_at[:4]), importe=a["reforesta"])
            for e, a in checked
            if a.get("reforesta") is not None
        ],
        peers=[name for nif, name in PEERS.items() if nif in hits],
    )


def build_history(rows: list[EditionRow]) -> History | None:
    """The `history` of one call from its bdns_editions rows; None without a previous edition."""
    previous = sorted((r for r in rows if not r.is_current), key=lambda r: r.published_at, reverse=True)
    if not previous:
        return None
    considered = [r for r in rows if r.is_current] + previous
    return History(
        editions=[
            HistoryEdition(
                year=int(r.published_at[:4]),
                numero=r.numero,
                url=call_url(r.numero),
                opened_at=r.opened_at,
                closes_at=r.closes_at,
                window=r.window,
                awards=None
                if r.awards is None
                else EditionAwards(
                    count=r.awards["count"],
                    non_profit=r.awards["byClass"].get(NON_PROFIT, 0),
                    importe=r.awards["importe"],
                ),
            )
            for r in previous
        ],
        typical_opening=typical_opening(considered),
        typical_window=typical_window(considered),
        awards=awards_summary(previous),
    )


# ---------- DB mapping ----------


def to_db(r: EditionRow) -> dict[str, Any]:
    a = r.awards
    iso = date.fromisoformat
    return {
        "call_numero": r.call_numero,
        "numero": r.numero,
        "organ_ids": r.organ_ids,
        "title": r.title,
        "published_at": iso(r.published_at),
        "opened_at": iso(r.opened_at) if r.opened_at else None,
        "closes_at": iso(r.closes_at) if r.closes_at else None,
        "window_text": r.window,
        "awards_count": a["count"] if a else None,
        "awards_by_class": a["byClass"] if a else None,
        "awards_importe": a["importe"] if a else None,
        "awards_first": iso(a["first"]) if a and a["first"] else None,
        "awards_last": iso(a["last"]) if a and a["last"] else None,
        "reforesta_importe": a["reforesta"] if a else None,
        "peer_hits": a["peers"] if a else None,
    }


def from_db(row: Any) -> EditionRow:
    def iso(d: date | None) -> str | None:
        return d.isoformat() if d else None

    awards = None
    if row.awards_count is not None:
        awards = {
            "count": row.awards_count,
            "byClass": row.awards_by_class or {},
            "importe": float(row.awards_importe) if row.awards_importe is not None else None,
            "first": iso(row.awards_first),
            "last": iso(row.awards_last),
            "reforesta": float(row.reforesta_importe) if row.reforesta_importe is not None else None,
            "peers": row.peer_hits or [],
        }
    return EditionRow(
        call_numero=row.call_numero,
        numero=row.numero,
        organ_ids=row.organ_ids,
        title=row.title,
        published_at=row.published_at.isoformat(),
        opened_at=iso(row.opened_at),
        closes_at=iso(row.closes_at),
        window=row.window_text,
        awards=awards,
    )
