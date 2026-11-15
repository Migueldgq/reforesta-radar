"""Text helpers for official notices, shared by BOE, BOCM, DOG and BDNS.

Ports of decodeHtml / toIsoDate / esDateToIso (src/lib/http.ts) and isCallNotice / isOpenTender /
extractNoticeDetails / parseDeadline / deadlineFromDays (src/lib/boe.ts).
"""

import re
from datetime import UTC, date, datetime, timedelta

from app.config import settings
from app.scoring.text import has_term, normalize_text

# ---------------------------------------------------------------- HTML

_ACUTE = {"a": "á", "e": "é", "i": "í", "o": "ó", "u": "ú", "A": "Á", "E": "É", "I": "Í", "O": "Ó", "U": "Ú"}
_HTML_RULES: tuple[tuple[str, str], ...] = (
    (r"<[^>]+>", " "),
    (r"&nbsp;", " "),
    (r"&amp;", "&"),
    (r"&lt;", "<"),
    (r"&gt;", ">"),
    (r"&quot;", '"'),
    (r"&#0?39;|&rsquo;|&lsquo;|&#8217;|&#8216;", "'"),
    (r"&ldquo;|&rdquo;|&#8220;|&#8221;", '"'),
    (r"&hellip;|&#8230;", "…"),
    (r"&ndash;|&#8211;", "–"),
    (r"&mdash;|&#8212;", "—"),
)


def decode_html(s: str) -> str:
    """Strip tags, decode the common entities, collapse whitespace."""
    for pattern, repl in _HTML_RULES:
        s = re.sub(pattern, repl, s)
    s = re.sub(r"&([aeiou])acute;", lambda m: _ACUTE.get(m.group(1), m.group(1)), s, flags=re.IGNORECASE)
    for entity, char in (("&ntilde;", "ñ"), ("&Ntilde;", "Ñ"), ("&uuml;", "ü"), ("&ordm;", "º"), ("&ordf;", "ª"),
                         ("&euro;", "€")):  # fmt: skip
        s = s.replace(entity, char)
    s = re.sub(r"&#([0-9]+);", lambda m: chr(int(m.group(1)) & 0xFFFF), s)
    return re.sub(r"\s+", " ", s).strip()


def es_date_to_iso(s: str | None) -> str | None:
    """ "dd/mm/yyyy" -> "yyyy-mm-dd" (None if not parseable)."""
    m = re.search(r"([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})", s or "")
    return f"{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}" if m else None


# ---------------------------------------------------------------- notice classification (normalised text)

_NOT_A_CALL = (
    "subasta", "junta general", "provision de", "puesto", "concurso de meritos", "tribunal", "pruebas",
    "credito presupuestario", "amplia en", "modifica", "convocatoria de junta", "levantamiento", "actas previas",
    "oposicion", "proceso selectivo", "concedidas", "se conceden", "se resuelve", "resolucion definitiva", "corrige",
    "correccion de errores",
)  # fmt: skip


def is_call_notice(t: str) -> bool:
    """Grant-like notice (convocatoria / extracto / premios), not a procedural notice."""
    if any(x in t for x in _NOT_A_CALL):
        return False
    grant = (
        has_term(t, "subvenci") or has_term(t, "ayudas") or has_term(t, "premio") or has_term(t, "bases reguladoras")
    )
    call = has_term(t, "extracto") or has_term(t, "convoca") or has_term(t, "bases reguladoras")
    return grant and call


def is_open_tender(t: str) -> bool:
    if any(x in t for x in ("formalizacion", "adjudicacion", "desistimiento", "anulacion")):
        return False
    return "licitacion" in t or "convocatoria del contrato" in t or "procedimiento abierto" in t


# ---------------------------------------------------------------- deadlines and purpose from plain text

_ANY = r"[\s\S]"
_PLAZO_RES = (
    re.compile(rf"(Fecha l[ií]mite de presentaci[oó]n{_ANY}{{5,140}}?(?:[0-9]{{4}}|\.))", re.IGNORECASE),
    re.compile(rf"Plazo para la recepci[oó]n de ofertas[^:]*:\s*({_ANY}{{5,120}}?[0-9]{{4}})", re.IGNORECASE),
    re.compile(
        rf"(?:Plazo de presentaci[oó]n de (?:solicitudes|ofertas|proposiciones)[^.:]*[.:]\s*)({_ANY}{{10,260}}?\.)",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:presentaci[oó]n de (?:solicitudes|ofertas|proposiciones)[^.]{0,40}?:?\s*)"
        rf"((?:hasta|el plazo|será|ser[aá]n?|de){_ANY}{{5,220}}?\.)",
        re.IGNORECASE,
    ),
)
_OBJETO_RE = re.compile(rf"(?:Objeto|Finalidad)\s*[.:]\s*({_ANY}{{20,400}}?\.)\s", re.IGNORECASE)


def extract_notice_details(text: str) -> tuple[str | None, str | None]:
    """(deadline_text, summary): the "plazo" and "objeto/finalidad" sentences of an official notice."""
    plazo = next((m.group(1) for r in _PLAZO_RES if (m := r.search(text)) and m.group(1)), None)
    objeto = m.group(1) if (m := _OBJETO_RE.search(text)) else None
    return (plazo.strip() if plazo else None, objeto.strip() if objeto else None)


_MONTHS = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
           "noviembre", "diciembre")  # fmt: skip
_NUMERIC_DATE = re.compile(r"\b([0-9]{1,2})[/.]([0-9]{1,2})[/.]([0-9]{4}|[0-9]{2})\b", re.ASCII)
_SPANISH_DATE = re.compile(rf"([0-9]{{1,2}}) de ({'|'.join(_MONTHS)}) de ([0-9]{{4}})")


def parse_deadline(text: str | None) -> str | None:
    """First explicit date in a deadline sentence ("30/11/2026", "30 de noviembre de 2026")."""
    if not text:
        return None
    if m := _NUMERIC_DATE.search(text):
        year = f"20{m.group(3)}" if len(m.group(3)) == 2 else m.group(3)
        return f"{year}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"
    if m := _SPANISH_DATE.search(normalize_text(text)):
        return f"{m.group(3)}-{_MONTHS.index(m.group(2)) + 1:02d}-{m.group(1).zfill(2)}"
    return None


_DAYS_RE = re.compile(r"([0-9]{1,3}|quince|diez|veinte|treinta|un mes)\s*(dias? habiles|dias? naturales|dias?|mes)")
_NUMBER_WORDS = {"diez": 10, "quince": 15, "veinte": 20, "treinta": 30}


def deadline_from_days(published: str, text: str | None) -> str | None:
    """Add N natural/working days from the day after publication (approximation for "N días hábiles")."""
    if not text or not (m := _DAYS_RE.search(normalize_text(text))):
        return None
    start = date.fromisoformat(published)
    if m.group(1) == "un mes" or m.group(2) == "mes":
        # TS: Date.setMonth(+1) (overflows like JS) then toISOString(): local midnight printed in UTC, which in
        # Madrid is the previous day. Kept for parity; see README "Known TS quirks kept for parity".
        y, mo = (start.year + 1, 1) if start.month == 12 else (start.year, start.month + 1)
        shifted = date(y, mo, 1) + timedelta(days=start.day - 1)
        local_midnight = datetime(shifted.year, shifted.month, shifted.day, tzinfo=settings.tz)
        return local_midnight.astimezone(UTC).date().isoformat()
    n = _NUMBER_WORDS.get(m.group(1)) or (int(m.group(1)) if m.group(1).isdigit() else 0)
    if not n:
        return None
    habiles = "habil" in m.group(2)
    d = start
    while n > 0:
        d += timedelta(days=1)
        if not habiles or d.weekday() < 5:
            n -= 1
    return d.isoformat()
