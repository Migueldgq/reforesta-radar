"""The web's Perfil view keeps a copy of the territory table (GEO_FIT in src/lib/reforesta-profile.ts): it must say
the same as GeoFit here. Skipped when the web sources are not next to the backend (backend-only checkout or image)."""

import re
from pathlib import Path

import pytest

from app.scoring.profile import GeoFit, GeoRegion

TS = Path(__file__).parents[2] / "src" / "lib" / "reforesta-profile.ts"
_REGION = re.compile(r'^\s*"?([^":\n]+?)"?: \{ delta: (-?\d+), (?:cap: (\d+), )?reason: "([^"]*)" \},?$', re.M)
_SCALAR = re.compile(r"^\s*(otherRegion|otherMunicipal|outOfTerritoryCap|closedCap): (-?\d+),$", re.M)


def _geo_fit_block() -> str:
    src = TS.read_text()
    start = src.index("export const GEO_FIT = {")
    return src[start : src.index("\n};", start)]


@pytest.mark.skipif(not TS.exists(), reason="web sources not present")
def test_web_geo_fit_matches_the_server() -> None:
    block = _geo_fit_block()
    regions, madrid = {}, None
    for name, delta, cap, reason in _REGION.findall(block):
        region = GeoRegion(int(delta), reason, int(cap) if cap else 100)
        if name == "madridMunicipal":
            madrid = region
        else:
            regions[name] = region
    assert regions == GeoFit.regions
    assert madrid == GeoFit.madrid_municipal
    scalars = {k: int(v) for k, v in _SCALAR.findall(block)}
    assert scalars == {
        "otherRegion": GeoFit.other_region,
        "otherMunicipal": GeoFit.other_municipal,
        "outOfTerritoryCap": GeoFit.out_of_territory_cap,
        "closedCap": GeoFit.closed_cap,
    }
