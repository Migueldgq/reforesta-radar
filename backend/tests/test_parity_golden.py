"""End-to-end parity with the running TS app: GET /api/oportunidades (tests/golden/oportunidades.json).

Each item's scoring input is rebuilt from the API fields (tests/golden_reconstruct.py), scored with the Python
base scoring + connector adjustment, then geographic and kind fit, and compared with the TS `fit`.
Refresh the golden with: curl -s localhost:3000/api/oportunidades > backend/tests/golden/oportunidades.json
"""

import json
from collections import Counter
from pathlib import Path
from typing import Any

import pytest

from app.models import FitAnalysis
from app.scoring.rank import adjusted_fit, rank
from app.sources.base import score_raw
from tests.golden_reconstruct import GAPS, reconstruct, scoring_day
from tests.test_parity_functions import INTENDED

GOLDEN: dict[str, Any] = json.loads((Path(__file__).parent / "golden" / "oportunidades.json").read_text())
# RSC items are excluded: the hand-checked list in app/sources/rsc.py replaced the TS one (tested in test_sources).
ITEMS: list[dict[str, Any]] = [i for i in GOLDEN["items"] if i["source"] != "rsc"]

# Items whose TS fit cannot be reproduced from the API fields alone (inputs missing from the API output, see
# GAPS). Keep this list explicit: a new mismatch fails the test until it is explained here.
KNOWN_GAPS: dict[str, str] = {
    # SCORING_VERSION 16: running costs of LEADER groups, only those groups can apply (tests/test_scoring_rules.py)
    "bdns:920464": "leader-groups",
    "bdns:910261": "leader-groups",
    "bdns:913981": "leader-groups",
    "boe:BOE-B-2026-34894": "facility-tender",  # CENEAM security and upkeep tenders: off-topic cap (ADR 0032)
    "boe:BOE-B-2026-36150": "facility-tender",
}
# SCORING_VERSION 18 (ADR 0040): an item that differs only because a later rule fired carries that rule's warning
# (INTENDED), like the function-level parity. Here that is 125 items without a topic match (no bonus for an unchecked
# organism, no "Coincidencia parcial"; no score changes) and 9 whose only match was an ambiguous word, all noise:
# eu:HORIZON-CL5-2027-03-D5-17 and bdns:913212 ("ecosistema"), boe:BOE-B-2026-36910 ("ecosistema de nodos edge"),
# bocm:BOCM-20261110-53 ("aves frescas"), bdns:927188, bdns:912368 and bdns:918961 ("natural/naturaleza"),
# bdns:877675 ("sensibilización" of SMEs), bdns:918333 ("Hábitats de sostenibilidad", an urban project).


def _intended(fit: FitAnalysis) -> bool:
    return bool(set(fit.warnings) & set(INTENDED))


def _python_fit(item: dict[str, Any]) -> tuple[FitAnalysis, str]:
    raw, gap = reconstruct(item)
    o = score_raw(raw, scoring_day(item, GOLDEN["fetchedAt"]))
    return adjusted_fit(o), gap


def _key(fit: dict[str, Any]) -> tuple[Any, ...]:
    return fit["score"], fit["tier"], fit["reasons"]


def _report() -> tuple[list[dict[str, Any]], Counter[str]]:
    mismatches = []
    full_fit_diffs: Counter[str] = Counter()
    for item in ITEMS:
        got, gap = _python_fit(item)
        got_json, want = got.to_json(), item["fit"]
        if got_json != want:
            full_fit_diffs[item["source"]] += 1
        if _key(got_json) != _key(want) and not _intended(got):
            mismatches.append({"id": item["id"], "gap": gap, "want": _key(want), "got": _key(got_json)})
    return mismatches, full_fit_diffs


def test_golden_score_tier_reasons_match_ts() -> None:
    mismatches, full_fit_diffs = _report()
    rate = 1 - len(mismatches) / len(ITEMS)
    print(f"\nparity score/tier/reasons: {len(ITEMS) - len(mismatches)}/{len(ITEMS)} = {rate:.2%}")
    print(f"full-fit differences by source: {dict(full_fit_diffs)}")
    for m in mismatches:
        print(f"  {m['id']} [{m['gap']}: {GAPS.get(m['gap'], '')[:60]}]\n    TS: {m['want']}\n    PY: {m['got']}")
    unexplained = [m for m in mismatches if m["id"] not in KNOWN_GAPS]
    assert not unexplained, f"{len(unexplained)} unexplained mismatches"


@pytest.mark.parametrize("bdns_id", ["bdns:904719", "bdns:923290"])
def test_challenge_calls_are_alto(bdns_id: str) -> None:
    item = next(i for i in ITEMS if i["id"] == bdns_id)
    fit, _ = _python_fit(item)
    assert item["fit"]["tier"] == "alto"
    assert fit.tier == "alto"


def test_rank_order_matches_ts() -> None:
    """Same sort as the TS: score desc, then earliest deadline. Ties keep input order (stable sort)."""
    from app.models import Opportunity

    base = []
    for item in ITEMS:
        raw, _ = reconstruct(item)
        base.append(score_raw(raw, scoring_day(item, GOLDEN["fetchedAt"])))
    ranked = rank(base)
    by_id = {i["id"]: i for i in ITEMS}
    assert all(isinstance(o, Opportunity) for o in ranked)
    kept = [o for o in ranked if o.id not in KNOWN_GAPS and not _intended(o.fit)]
    assert [(o.fit.score, o.deadline or "9999") for o in kept] == [
        (by_id[o.id]["fit"]["score"], by_id[o.id]["deadline"] or "9999") for o in kept
    ]
    assert [o.fit.score for o in ranked] == sorted((o.fit.score for o in ranked), reverse=True)
