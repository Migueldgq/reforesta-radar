"""Content hash and dedupe key (ports of stableJson / contentHash / dedupeKey in src/lib/store-pg.ts).

Byte-identical to the TS so rows written by either backend compare as "unchanged" on the next ingest.
"""

import hashlib
import json
import math
import re
from typing import Any

from app.models import Opportunity, OpportunityBase
from app.scoring.text import normalize_text


def _js_number(v: float) -> str:
    """JSON.stringify for numbers: integral floats without ".0", non-finite as null."""
    if not math.isfinite(v):
        return "null"
    if v == int(v) and abs(v) < 1e21:
        return str(int(v))
    return repr(v)


def stable_json(v: Any) -> str:
    """JSON with sorted keys; dict entries whose value is None-for-absent are passed in already dropped."""
    if isinstance(v, list):
        return "[" + ",".join(stable_json(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(f"{json.dumps(k, ensure_ascii=False)}:{stable_json(v[k])}" for k in sorted(v)) + "}"
    if isinstance(v, bool) or v is None:
        return json.dumps(v)
    if isinstance(v, (int, float)):
        return _js_number(float(v)) if isinstance(v, float) else str(v)
    return json.dumps(v, ensure_ascii=False)


def content_dict(o: OpportunityBase) -> dict[str, Any]:
    """What the SOURCE says: the contract JSON without `fit` and `firstSeenAt`."""
    data = o.to_json()
    data.pop("fit", None)
    data.pop("firstSeenAt", None)
    return data


def content_hash(o: OpportunityBase) -> str:
    """`fit` is excluded: it holds volatile values (daysRemaining) and changes with every scoring tweak."""
    return hashlib.sha256(stable_json(content_dict(o)).encode()).hexdigest()


_BDNS_IN_TEXT = re.compile(r"\bBDNS\b[^0-9]{0,25}(\d{5,7})\b", re.IGNORECASE | re.ASCII)
_BDNS_IN_URL = re.compile(r"convocatorias/(\d{5,7})\b", re.ASCII)


def dedupe_key(o: Opportunity | OpportunityBase) -> str:
    """BDNS number when the text cites one, else normalised title|organism|deadline."""
    if o.source == "bdns":
        return f"bdns:{o.id[5:]}"
    text = f"{o.titulo} {o.summary or ''} {o.url}"
    m = _BDNS_IN_TEXT.search(text) or _BDNS_IN_URL.search(o.url)
    if m:
        return f"bdns:{m.group(1)}"
    title = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", normalize_text(o.titulo))).strip()[:120]
    return f"t:{title}|{normalize_text(o.organismo)[:60]}|{o.deadline or ''}"
