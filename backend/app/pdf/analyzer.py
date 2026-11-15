"""Read an official PDF and score it (port of analyzePdfBuffer in src/lib/pdf-analyzer.ts).

Text extraction uses pypdf instead of pdf.js (unpdf). Pages are joined and whitespace is normalised exactly as
unpdf's `mergePages` does, then the TS heuristics run unchanged. JS regex semantics are kept where they differ
from Python: `\\s` is the JS whitespace set, `\\d` is ASCII, and lengths/slices count UTF-16 code units.
"""

import io
import re
from typing import Literal

from pypdf import PdfReader

from app.models import Contract, FitAnalysis, Opportunity
from app.scoring.score import ScoreInput, score_convocatoria
from app.scoring.text import normalize_text
from app.sources.names import organism_name

# Below this many characters a PDF is a form, a cover page or a scan: too little to score on its own.
MIN_SCORING_CHARS = 3000
NOT_ENOUGH_TEXT = "No hemos podido leer lo suficiente de este PDF para puntuarlo."

# JS `\s` (ECMAScript WhiteSpace + LineTerminator). Python's `\s` differs (e.g. no U+FEFF, adds U+001C-U+001F).
_JS_WS_NO_NL = "\t\v\f\r    -     　﻿"  # regex class body
_S = f"[\n{_JS_WS_NO_NL}]"
_JS_WS_CHARS = "\t\n\v\f\r       　﻿" + "".join(map(chr, range(0x2000, 0x200B)))


class PdfAnalysisResult(Contract):
    """Mirror of PdfAnalysisResult in src/lib/types.ts."""

    file_name: str
    total_pages: int
    char_count: int
    title: str
    organism: str | None
    summary: str
    beneficiaries: list[str]
    budget_highlights: list[str]
    deadline_highlights: list[str]
    requirements: list[str]
    fit: FitAnalysis
    excerpt: str
    # Where `fit` comes from: "radar" = the call this PDF belongs to, scored exactly as in the list (callId);
    # "pdf" = scored on the PDF text alone; "none" = too little text to score (fit is empty, `notice` says why).
    score_source: Literal["radar", "pdf", "none"] = "pdf"
    call_id: str | None = None
    notice: str | None = None


def _u16_len(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def _u16_slice(s: str, n: int) -> str:
    """JS `s.slice(0, n)` (UTF-16 units). A split surrogate pair is dropped rather than left dangling."""
    if len(s) <= n and _u16_len(s) <= n:
        return s
    return s.encode("utf-16-le")[: 2 * n].decode("utf-16-le", errors="ignore")


def extract_text(data: bytes) -> tuple[int, str]:
    """(total pages, text) like unpdf `extractText(..., {mergePages: true})`."""
    reader = PdfReader(io.BytesIO(data))
    texts = [page.extract_text() or "" for page in reader.pages]
    return len(reader.pages), "\n".join(texts)


def read_pdf(data: bytes) -> tuple[int, str]:
    """(total pages, cleaned text) of a PDF."""
    total_pages, raw = extract_text(data)
    return total_pages, _clean_whitespace(_normalize_merged(raw))


# "Código BDNS" in a BDNS printout (the number comes on the line before it), "BDNS (Identif.): 923290" in an extract
_BDNS_RE = re.compile(r"(?:(\d{5,7})\s*\n\s*C[óo]digo BDNS|BDNS\s*(?:\(Identif\.\))?\s*:?\s*(\d{5,7})\b)")


def bdns_number(text: str) -> str | None:
    m = _BDNS_RE.search(text)
    return (m.group(1) or m.group(2)) if m else None


def _normalize_merged(text: str) -> str:
    # unpdf normalizeMergedText: /[^\S\n]+/g -> " ", / ?\n ?/g -> "\n", /\n{3,}/g -> "\n\n"
    text = re.sub(f"[{_JS_WS_NO_NL}]+", " ", text)
    text = re.sub(" ?\n ?", "\n", text)
    return re.sub("\n{3,}", "\n\n", text)


def _clean_whitespace(text: str) -> str:
    text = text.replace("\r", "\n")
    text = re.sub("[ \t]+", " ", text)
    text = re.sub("\n{3,}", "\n\n", text)
    return text.strip(_JS_WS_CHARS)


def _split_sentences(text: str) -> list[str]:
    parts = re.split(f"(?<=[.;]){_S}+", re.sub("\n+", " ", text))
    out = [p.strip(_JS_WS_CHARS) for p in parts]
    return [s for s in out if 25 <= _u16_len(s) <= 420]


def _find_matching(sentences: list[str], patterns: list[re.Pattern[str]], limit: int = 3) -> list[str]:
    hits: list[str] = []
    for s in sentences:
        norm = normalize_text(s)
        if any(p.search(norm) for p in patterns):
            hits.append(s)
            if len(hits) >= limit:
                break
    return hits


_ORGANISM_RE = re.compile(
    "^(consejeria|ministerio|diputacion|ayuntamiento|junta|xunta|generalitat|fundacion)", re.IGNORECASE
)
_TITLE_RE = re.compile(
    f"(Orden{_S}+[0-9]+/[0-9]{{4}}[^.]{{10,400}}\\.|Resoluci[oó]n[^.]{{10,400}}\\.|Extracto[^.]{{10,400}}\\.)",
    re.IGNORECASE,
)


def _is_header_line(ln: str) -> bool:
    """A continuation of an all-caps organism heading ("AGRICULTURA E INTERIOR")."""
    letters = [c for c in ln if c.isalpha()]
    return bool(letters) and sum(c.isupper() for c in letters) / len(letters) > 0.8 and _u16_len(ln) <= 80


def _title_and_organism(text: str, fallback_name: str) -> tuple[str, str | None]:
    lines = [ln.strip(_JS_WS_CHARS) for ln in text.split("\n")]
    lines = [ln for ln in lines if _u16_len(ln) > 4][:30]
    organism, header = None, set()
    for i, ln in enumerate(lines):
        if _ORGANISM_RE.search(normalize_text(ln)):
            parts = [ln]
            # an organism heading broken over lines: "CONSEJERÍA DE MEDIO AMBIENTE," / "AGRICULTURA E INTERIOR"
            for nxt in lines[i + 1 : i + 3]:
                if not (parts[-1].endswith(",") or _is_header_line(parts[-1])) or not _is_header_line(nxt):
                    break
                parts.append(nxt)
            header = set(parts)
            organism = organism_name(" ".join(parts).strip(" ,;:"))
            break
    m = _TITLE_RE.search(" ".join(lines))
    first = next((ln for ln in lines if ln not in header), "")
    title = (m.group(1).strip(_JS_WS_CHARS) if m else "") or first or fallback_name
    return " ".join(title.split()).strip(" ,;:"), organism


_SUMMARY = [re.compile("objeto|finalidad|tienen por objeto|destinadas a financiar")]
_BENEFICIARIES = [re.compile("beneficiari|entidades sin animo|sin fines de lucro|podran solicitar|podran acceder")]
_BUDGET = [
    re.compile(f"([0-9][0-9.,]*{_S}*(euros|€)|cuantia|presupuesto|credito|financiacion|porcentaje|[0-9]+{_S}*%)")
]
_DEADLINES = [re.compile("plazo de presentacion|dias habiles|dias naturales|fecha limite|hasta el [0-9]")]
# A deadline sentence states a term or a date; "una vez finalizado el plazo de presentación, …" does not.
_NUMBER_WORDS = "un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|treinta|cuarenta|sesenta"
_DEADLINE_TERM = [
    re.compile(
        f"\\b([0-9]+|{_NUMBER_WORDS}){_S}+(\\([0-9]+\\){_S}+)?(dias|mes|meses|semanas)\\b|hasta el [0-9]|fecha limite"
        f"|[0-9]{{1,2}} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)"
    )
]

_REQUIREMENTS = [re.compile("requisit|cofinanci|memoria|justific|antiguedad|ambito|exclusi|incompatible")]


def _unscored(fit: FitAnalysis) -> FitAnalysis:
    return fit.model_copy(update={"score": 0, "tier": "bajo", "reasons": [], "warnings": [NOT_ENOUGH_TEXT]})


def analyze_text(total_pages: int, text: str, file_name: str, call: Opportunity | None = None) -> PdfAnalysisResult:
    """The PDF's highlights. Its fit is the radar's own fit of `call` when the PDF belongs to a call in the radar
    (same score as the list), else a score of the PDF text alone, or none when the text is too short to score."""
    sentences = _split_sentences(text)
    title, organism = _title_and_organism(text, file_name)

    summary_hits = _find_matching(sentences, _SUMMARY, 2)
    summary = (
        " ".join(summary_hits) or " ".join(sentences[:2]) or "No se pudo extraer un resumen automático del objeto."
    )

    notice = None
    if call is not None:
        title, organism, fit, source = call.titulo, call.organismo, call.fit, "radar"
    else:
        # an unknown organism is not "outside the organisms you check by hand": score it without one
        region = "Comunidad de Madrid" if "comunidad de madrid" in normalize_text(f"{title} {organism}") else None
        fit = score_convocatoria(
            ScoreInput(titulo=title, organismo=organism or "", region=region, extra_text=_u16_slice(text, 24000))
        )
        source = "pdf"
        if _u16_len(text) < MIN_SCORING_CHARS:
            fit, source, notice = _unscored(fit), "none", NOT_ENOUGH_TEXT
    deadlines = [s for s in _find_matching(sentences, _DEADLINES, 20) if _find_matching([s], _DEADLINE_TERM)][:3]
    return PdfAnalysisResult(
        file_name=file_name,
        total_pages=total_pages,
        char_count=_u16_len(text),
        title=title,
        organism=organism,
        summary=summary,
        beneficiaries=_find_matching(sentences, _BENEFICIARIES, 3),
        budget_highlights=_find_matching(sentences, _BUDGET, 3),
        deadline_highlights=deadlines,
        requirements=_find_matching(sentences, _REQUIREMENTS, 4),
        fit=fit,
        excerpt=_u16_slice(text, 1800),
        score_source=source,
        call_id=call.id if call is not None else None,
        notice=notice,
    )


def analyze_pdf_bytes(data: bytes, file_name: str, call: Opportunity | None = None) -> PdfAnalysisResult:
    return analyze_text(*read_pdf(data), file_name, call)
