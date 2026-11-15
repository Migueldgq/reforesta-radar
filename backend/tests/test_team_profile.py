"""The port of the web's applyProfileAll (src/components/radar/profile.ts) in app/scoring/team_profile.py, on
hand-computed cases: same score, same reason texts, same hidden calls."""

from app.api.board import TeamProfile
from app.models import FitAnalysis, Opportunity
from app.scoring.team_profile import apply_profile_all


def _opp(oid: str, titulo: str, score: int = 50, state: str = "abierta", **kw) -> Opportunity:  # noqa: ANN003
    fit = FitAnalysis(score=score, tier="medio", work_lines=["conservacion"], outside_manual_sources=False,
                      manual_source_match=None, is_competitive=True, is_ong_eligible=True, reasons=["Base."],
                      warnings=[], days_remaining=5, deadline_state=state)  # fmt: skip
    base = dict(id=oid, source="bdns", source_label="BDNS", kind="subvencion", titulo=titulo, organismo="Org",
                region="Comunidad de Madrid", nivel_admin="Autonómica", url="https://example.org/" + oid)  # fmt: skip
    return Opportunity(**{**base, **kw}, fit=fit)


def test_neutral_profile_changes_nothing() -> None:
    items = [_opp("a", "Charcas")]
    assert apply_profile_all(items, TeamProfile()) == (items, {})


def test_adjustments_and_reasons_match_the_web() -> None:
    p = TeamProfile.model_validate({
        "extraKeywords": [{"term": "charca", "weight": 10, "line": "restauracion"}],
        "excludedTerms": [{"term": "caza", "penalty": 15}],
        "linePriority": {"conservacion": -2},
        "regionAdjust": {"Comunidad de Madrid": 3},
    })  # fmt: skip
    (o,), hidden = apply_profile_all([_opp("a", "Charcas para anfibios y caza")], p)
    assert hidden == {}
    assert o.fit.score == 50 + 10 - 15 - 2 + 3 and o.fit.tier == "medio"
    assert o.fit.work_lines == ["conservacion", "restauracion"]
    assert o.fit.reasons == [
        "Base.",
        "Vuestro perfil: menciona «charca» (+10).",
        "Vuestro perfil: territorio Comunidad de Madrid (+3).",
    ]
    assert o.fit.warnings == [
        "Vuestro perfil: menciona «caza», que descartáis (−15).",
        "Vuestro perfil: prioridad baja a Conservación de hábitats (−2).",
    ]


def test_closed_calls_do_not_climb_past_the_cap_and_scores_are_bounded() -> None:
    p = TeamProfile.model_validate({"extraKeywords": [{"term": "charca", "weight": 25}]})
    (closed, high), _ = apply_profile_all([_opp("a", "Charca", 40, "cerrada"), _opp("b", "Charca", 90)], p)
    assert closed.fit.score == 52  # GeoFit.closed_cap
    assert high.fit.score == 100 and high.fit.tier == "alto"


def test_hidden_calls() -> None:
    p = TeamProfile.model_validate({
        "excludedTerms": [{"term": "becas", "penalty": 100}],
        "kinds": ["subvencion"],
        "minBudget": 5000,
        "hideMunicipalOutsideRegions": True,
    })  # fmt: skip
    items = [
        _opp("ok", "Charcas", budget=10000),
        _opp("becas", "Becas de verano"),
        _opp("tipo", "Charcas", kind="licitacion"),
        _opp("importe", "Charcas", budget=1000),
        _opp("muni", "Charcas", nivel_admin="Local", region="Galicia"),
        _opp("muni-madrid", "Charcas", nivel_admin="Local"),  # Madrid is the team's territory
    ]
    kept, hidden = apply_profile_all(items, p)
    assert [o.id for o in kept] == ["ok", "muni-madrid"]
    assert hidden == {"becas": "descartada", "tipo": "tipo", "importe": "importe", "muni": "municipal"}
