"""Text helpers shared by scoring and connectors (ports of normalizeText / hasTerm in src/lib/scoring.ts)."""

import math
import re
import unicodedata
from functools import cache

_COMBINING = re.compile("[̀-ͯ]")


def normalize_text(text: str) -> str:
    """Lowercase, strip accents (NFD + drop combining marks)."""
    return _COMBINING.sub("", unicodedata.normalize("NFD", text.lower()))


@cache
def _term_re(term: str) -> re.Pattern[str]:
    return re.compile(f"(^|[^a-z0-9]){re.escape(term)}")


def has_term(norm_text: str, term: str) -> bool:
    """Word-start match on already-normalised text ("aves" won't match "naves")."""
    return _term_re(term).search(norm_text) is not None


@cache
def _word_re(word: str) -> re.Pattern[str]:
    return re.compile(f"(^|[^a-z0-9]){re.escape(word)}($|[^a-z0-9])")


def has_word(norm_text: str, word: str) -> bool:
    """Whole-word match on already-normalised text ("soria" won't match "asesoria")."""
    return _word_re(word).search(norm_text) is not None


def js_round(x: float) -> int:
    """JavaScript Math.round: halves round towards +infinity (Python's round() is banker's rounding)."""
    return math.floor(x + 0.5)
