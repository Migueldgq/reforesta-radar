"""GET /api/perfil (port of src/app/api/perfil/route.ts): the default scoring rules, read-only, for the Perfil
screen. Keys are built in the TS order so the JSON is byte-identical to the Next.js route."""

from typing import Any

from fastapi import APIRouter

from app.scoring.profile import (
    DEALBREAKER_TERMS,
    KEYWORD_RULES,
    MANUAL_SOURCES,
    ONG_POSITIVE_TERMS,
    REFORESTA_IDENTITY,
    WORK_LINE_LABELS,
    GeoFit,
    GeoRegion,
)

router = APIRouter()


def _region(r: GeoRegion) -> dict[str, Any]:
    # TS objects: {delta, reason} or {delta, cap, reason}
    return {"delta": r.delta, **({"cap": r.cap} if r.cap != 100 else {}), "reason": r.reason}


def perfil_payload() -> dict[str, Any]:
    me = REFORESTA_IDENTITY
    return {
        "profile": {
            "name": me.name,
            "yearsActive": me.years_active,
            "teamSize": me.team_size,
            "legalForm": me.legal_form,
            "coreMission": me.core_mission,
            "manualSources": [{"label": m.label, "patterns": list(m.patterns)} for m in MANUAL_SOURCES],
        },
        "workLines": [
            {"line": g.line, "label": WORK_LINE_LABELS[g.line], "keywords": [k._asdict() for k in g.keywords]}
            for g in KEYWORD_RULES
        ],
        "ngoTerms": list(ONG_POSITIVE_TERMS),
        "dealbreakers": [d._asdict() for d in DEALBREAKER_TERMS],
        "usualSources": [m.label for m in MANUAL_SOURCES],
        "tiers": {"alto": 60, "medio": 40},
        "geo": {
            "regions": {name: _region(r) for name, r in GeoFit.regions.items()},
            "madridMunicipal": {"delta": GeoFit.madrid_municipal.delta, "reason": GeoFit.madrid_municipal.reason},
            "otherRegion": GeoFit.other_region,
            "otherMunicipal": GeoFit.other_municipal,
            "outOfTerritoryCap": GeoFit.out_of_territory_cap,
            "closedCap": GeoFit.closed_cap,
        },
    }


@router.get("/api/perfil")
async def perfil() -> dict[str, Any]:
    return perfil_payload()
