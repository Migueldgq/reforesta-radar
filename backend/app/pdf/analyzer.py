"""Read an official PDF and score it (port of analyzePdfBuffer in src/lib/pdf-analyzer.ts).

Text extraction uses pypdf instead of pdf.js (unpdf). Pages are joined and whitespace is normalised exactly as
unpdf's `mergePages` does, then the TS heuristics run unchanged. JS regex semantics are kept where they differ
from Python: `\\s` is the JS whitespace set, `\\d` is ASCII, and lengths/slices count UTF-16 code units.
"""

import io
import re

from pypdf import PdfReader

from app.models import Contract, FitAnalysis
from app.scoring.score import ScoreInput, score_convocatoria
from app.scoring.text import normalize_text

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
    f"(Orden{_S}+[0-9]+/[0-9]{{4}}[^.]{{10,220}}\\.|Resoluci[oó]n[^.]{{10,220}}\\.|Extracto[^.]{{10,220}}\\.)",
    re.IGNORECASE,
)


def _title_and_organism(text: str, fallback_name: str) -> tuple[str, str | None]:
    lines = [ln.strip(_JS_WS_CHARS) for ln in text.split("\n")]
    lines = [ln for ln in lines if _u16_len(ln) > 4][:30]
    organism = next((ln for ln in lines if _ORGANISM_RE.search(normalize_text(ln))), None)
    m = _TITLE_RE.search(" ".join(lines))
    title = (m.group(1).strip(_JS_WS_CHARS) if m else "") or (lines[0] if lines else "") or fallback_name
    return title, organism


_SUMMARY = [re.compile("objeto|finalidad|tienen por objeto|destinadas a financiar")]
_BENEFICIARIES = [re.compile("beneficiari|entidades sin animo|sin fines de lucro|podran solicitar|podran acceder")]
_BUDGET = [
    re.compile(f"([0-9][0-9.,]*{_S}*(euros|€)|cuantia|presupuesto|credito|financiacion|porcentaje|[0-9]+{_S}*%)")
]
_DEADLINES = [re.compile("plazo de presentacion|dias habiles|dias naturales|fecha limite|hasta el [0-9]")]
_REQUIREMENTS = [re.compile("requisit|cofinanci|memoria|justific|antiguedad|ambito|exclusi|incompatible")]


def analyze_pdf_bytes(data: bytes, file_name: str) -> PdfAnalysisResult:
    total_pages, raw = extract_text(data)
    text = _clean_whitespace(_normalize_merged(raw))
    sentences = _split_sentences(text)
    title, organism = _title_and_organism(text, file_name)

    summary_hits = _find_matching(sentences, _SUMMARY, 2)
    summary = (
        " ".join(summary_hits) or " ".join(sentences[:2]) or "No se pudo extraer un resumen automático del objeto."
    )

    fit = score_convocatoria(
        ScoreInput(titulo=title, organismo=organism or file_name, extra_text=_u16_slice(text, 24000))
    )
    return PdfAnalysisResult(
        file_name=file_name,
        total_pages=total_pages,
        char_count=_u16_len(text),
        title=title,
        organism=organism,
        summary=summary,
        beneficiaries=_find_matching(sentences, _BENEFICIARIES, 3),
        budget_highlights=_find_matching(sentences, _BUDGET, 3),
        deadline_highlights=_find_matching(sentences, _DEADLINES, 3),
        requirements=_find_matching(sentences, _REQUIREMENTS, 4),
        fit=fit,
        excerpt=_u16_slice(text, 1800),
    )
