"""Capture the BDNS fields that scoring reads but GET /api/oportunidades does not return.

The TS BDNS connector scores with extraText = bases + objetivos + descripcionLeng and with `abierto`; the API
output only has a 600-char `summary`. This tool saves those raw fields for every BDNS item of the golden, so
tests/golden_reconstruct.py can rebuild the exact scoring input.

Sources, in order: the TS persisted memo (.cache/oportunidades.json, "bdns:detail:N"), then the public BDNS API
for the rest (search-only "lite" items were never fetched by the TS). Run from backend/:
    uv run python -m tools.capture_bdns_inputs
Output: tests/golden/bdns_inputs.json.gz
"""

import asyncio
import gzip
import json
from pathlib import Path
from typing import Any

from app.http import Http, map_limit

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = ROOT / "backend" / "tests" / "golden"
TS_CACHE = ROOT / ".cache" / "oportunidades.json"
DETAIL_URL = "https://www.infosubvenciones.es/bdnstrans/api/convocatorias?numConv={}&vpd=GE"
FIELDS = (
    "descripcion", "descripcionLeng", "descripcionBasesReguladoras", "descripcionFinalidad", "objetivos", "abierto",
    "fechaInicioSolicitud", "fechaFinSolicitud", "textInicio", "textFin", "fechaRecepcion", "tipoConvocatoria",
    "presupuestoTotal",
)  # fmt: skip


async def main() -> None:
    golden = json.loads((GOLDEN / "oportunidades.json").read_text())
    ids = [i["id"].removeprefix("bdns:") for i in golden["items"] if i["source"] == "bdns"]
    memo: dict[str, Any] = json.loads(TS_CACHE.read_text()).get("memo", {}) if TS_CACHE.exists() else {}

    out: dict[str, dict[str, Any]] = {}
    missing = []
    for n in ids:
        hit = memo.get(f"bdns:detail:{n}")
        if hit:
            out[n] = {"from": "ts-memo", **{k: hit["value"].get(k) for k in FIELDS}}
        else:
            missing.append(n)

    async with Http(concurrency=4) as http:
        details = await map_limit(missing, 4, lambda n: http.json(DETAIL_URL.format(n), timeout=15))
    for n, d in zip(missing, details, strict=True):
        if d:
            out[n] = {"from": "bdns-api", **{k: d.get(k) for k in FIELDS}}

    (GOLDEN / "bdns_inputs.json.gz").write_bytes(gzip.compress(json.dumps(out, ensure_ascii=False).encode()))
    print(f"{len(out)}/{len(ids)} BDNS items captured ({len(ids) - len(missing)} from the TS memo)")


if __name__ == "__main__":
    asyncio.run(main())
