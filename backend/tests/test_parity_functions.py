"""Function-level parity with the TypeScript scoring: identical inputs must give identical outputs.

Golden data: tests/golden/ts_functions.json.gz, dumped from the former TypeScript scoring with a frozen clock.
It is a frozen fixture now (the TS backend and its dump tool were removed; see git history before the Python cutover).
"""

import gzip
import json
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from app.config import settings
from app.ingest.hashing import content_hash, dedupe_key
from app.models import FitAnalysis, Opportunity
from app.scoring.rank import (
    FACILITY_WARNING,
    SUPPLY_TENDER_WARNING,
    WORKS_TENDER_WARNING,
    geographic_fit,
    kind_fit,
)
from app.scoring.regions import infer_comunidad_autonoma
from app.scoring.score import (
    LEADER_GROUPS_WARNING,
    NO_TOPIC_WARNING,
    SECTOR_ASSOCIATIONS_WARNING,
    ScoreInput,
    score_convocatoria,
)
from app.scoring.text import normalize_text

GOLDEN = Path(__file__).parent / "golden"
TS: dict[str, Any] = json.loads(gzip.decompress((GOLDEN / "ts_functions.json.gz").read_bytes()))
TODAY = datetime.fromisoformat(TS["now"]).astimezone(settings.tz).date()


def _fit(d: dict[str, Any]) -> dict[str, Any]:
    return FitAnalysis.model_validate(d).to_json()


def _opp(item: dict[str, Any]) -> Opportunity:
    """geographicFit/kindFit only read these fields; fill the rest of the contract with placeholders."""
    return Opportunity.model_validate(
        {"id": "x", "source": "x", "sourceLabel": "x", "url": "x", **item, "nivelAdmin": item["nivelAdmin"]}
    )


# Rules added after the TS (SCORING_VERSION 16-18): a case that differs only because one of them fired carries its
# warning, and is checked by its own tests (tests/test_scoring_rules.py) instead. v18 (ADR 0040): every call without a
# topic match carries NO_TOPIC_WARNING (no "Coincidencia parcial" reason, no bonus for an unchecked organism), and
# supply and works tenders name their contract.
INTENDED = (
    LEADER_GROUPS_WARNING,
    SECTOR_ASSOCIATIONS_WARNING,
    FACILITY_WARNING,
    NO_TOPIC_WARNING,
    SUPPLY_TENDER_WARNING,
    WORKS_TENDER_WARNING,
)


def _warnings(got: Any) -> list[str]:
    fits = got if isinstance(got, tuple) else (got,)
    return [w for f in fits for w in f.get("warnings", [])]


def _mismatches(pairs: list[tuple[Any, Any, Any]]) -> list[Any]:
    return [(case, want, got) for case, want, got in pairs if want != got and not set(_warnings(got)) & set(INTENDED)]


def test_score_convocatoria_matches_ts() -> None:
    pairs = []
    for case in TS["score"]:
        got = score_convocatoria(ScoreInput.model_validate(case["input"]), TODAY).to_json()
        pairs.append((case["input"], _fit(case["fit"]), got))
    bad = _mismatches(pairs)
    assert not bad, f"{len(bad)}/{len(pairs)} mismatches; first: {bad[0]}"


def test_geographic_and_kind_fit_match_ts() -> None:
    pairs = []
    for case in TS["geo"]:
        o = _opp(case["item"])
        geo = geographic_fit(o)
        kind = kind_fit(o.model_copy(update={"fit": geo}))
        pairs.append((case["item"], (_fit(case["geo"]), _fit(case["kind"])), (geo.to_json(), kind.to_json())))
    bad = _mismatches(pairs)
    assert not bad, f"{len(bad)}/{len(pairs)} mismatches; first: {bad[0]}"


def test_infer_comunidad_autonoma_matches_ts() -> None:
    bad = [
        c for c in TS["ccaa"] if infer_comunidad_autonoma(c["regiones"], c["organismo"], c["nivelAdmin"]) != c["result"]
    ]
    assert not bad


def test_normalize_text_matches_ts() -> None:
    assert all(normalize_text(c["input"]) == c["output"] for c in TS["normalize"])


@pytest.fixture(scope="module")
def golden_items() -> dict[str, Opportunity]:
    data = json.loads((GOLDEN / "oportunidades.json").read_text())
    # RSC items use the former TS shape of `rsc`; the hand-checked list replaced them (see test_sources)
    return {i["id"]: Opportunity.model_validate(i) for i in data["items"] if i["source"] != "rsc"}


def test_content_hash_and_dedupe_key_match_ts(golden_items: dict[str, Opportunity]) -> None:
    for case in (c for c in TS["hashes"] if c["id"] in golden_items):
        o = golden_items[case["id"]]
        assert content_hash(o) == case["contentHash"], case["id"]
        assert dedupe_key(o) == case["dedupeKey"], case["id"]


def test_profile_tables_match_ts() -> None:
    """Every table value by value: catches a drift in terms the golden inputs never hit."""
    from app.scoring import SCORING_VERSION
    from app.scoring.profile import (
        DEALBREAKER_TERMS,
        KEYWORD_RULES,
        MANUAL_SOURCES,
        ONG_POSITIVE_TERMS,
        WORK_LINE_LABELS,
        GeoFit,
        KindFit,
    )

    p = TS["profile"]
    # frozen golden at v12; v13-14 added and tuned the BDNS history signal (app/scoring/history.py), v15 the deadline
    # estimate of undated calls (score.estimated_end), v16 one estimated-deadline mechanism flagged as such (ADR 0029),
    # v17 sector associations, LEADER groups and facility-service tenders (ADR 0032), v18 ambiguous keywords and no
    # organism bonus without a topic match (ADR 0040: KEYWORD_CONTEXT is a new table, KEYWORD_RULES is unchanged),
    # v19 facility tenders judged on their object and honest LIFE reasons (ADR 0042); none of them is in these tables
    assert p["scoringVersion"] + 7 == SCORING_VERSION
    assert [{"line": g.line, "keywords": [k._asdict() for k in g.keywords]} for g in KEYWORD_RULES] == p["keywordRules"]
    assert list(ONG_POSITIVE_TERMS) == p["ongPositiveTerms"]
    assert [d._asdict() for d in DEALBREAKER_TERMS] == p["dealbreakerTerms"]
    assert [{"label": m.label, "patterns": list(m.patterns)} for m in MANUAL_SOURCES] == p["manualSources"]
    assert p["workLineLabels"] == WORK_LINE_LABELS
    geo = p["geoFit"]
    assert {
        k: {"delta": v.delta, "reason": v.reason, **({"cap": v.cap} if v.cap != 100 else {})}
        for k, v in GeoFit.regions.items()
    } == geo["regions"]
    assert GeoFit.madrid_municipal._asdict() | {"cap": 100} == geo["madridMunicipal"] | {"cap": 100}
    assert (GeoFit.other_region, GeoFit.other_municipal, GeoFit.out_of_territory_cap, GeoFit.closed_cap) == (
        geo["otherRegion"],
        geo["otherMunicipal"],
        geo["outOfTerritoryCap"],
        geo["closedCap"],
    )
    kind = p["kindFit"]
    assert {
        "bulletinCap": KindFit.bulletin_cap,
        "tenderPenalty": KindFit.tender_penalty,
        "tenderCap": KindFit.tender_cap,
        "horizonCap": KindFit.horizon_cap,
        "minTitleTopic": KindFit.min_title_topic,
        "offTopicCap": KindFit.off_topic_cap,
        "universityCap": KindFit.university_cap,
    } == kind
