"""Capture the EU call descriptions that scoring reads but GET /api/oportunidades cuts to 400 characters.

The TS EU connector derives Spanish topic terms from title + description[:2000]; the API keeps description[:400].
This tool repeats the connector's 5 SEDIA searches and saves the first 2000 characters of each golden EU call's
description, so tests/golden_reconstruct.py can rebuild the exact scoring input. Run from backend/:
    uv run python -m tools.capture_eu_inputs
Output: tests/golden/eu_inputs.json.gz
"""

import asyncio
import gzip
import json
from pathlib import Path
from typing import Any

import httpx

from app.config import settings
from app.sources.notices import decode_html

GOLDEN = Path(__file__).resolve().parents[1] / "tests" / "golden"
SEDIA_URL = "https://api.tech.ec.europa.eu/search-api/prod/rest/search"
LIFE_ID, HORIZON_ID = "43252405", "43108390"
QUERIES = (("***", LIFE_ID), ("forest", None), ("biodiversity restoration", None), ("nature restoration", HORIZON_ID),
           ("invasive species", None))  # fmt: skip


async def search(client: httpx.AsyncClient, text: str, programme: str | None) -> list[dict[str, Any]]:
    must: list[Any] = [{"terms": {"type": ["1", "2", "8"]}}, {"terms": {"status": ["31094501", "31094502"]}}]
    if programme:
        must.append({"terms": {"frameworkProgramme": [programme]}})
    files = {
        "query": ("blob", json.dumps({"bool": {"must": must}}), "application/json"),
        "languages": ("blob", json.dumps(["en"]), "application/json"),
        "sort": ("blob", json.dumps({"field": "deadlineDate", "order": "DESC"}), "application/json"),
    }
    params = {"apiKey": "SEDIA", "text": text, "pageSize": 100, "pageNumber": 1}
    res = await client.post(SEDIA_URL, params=params, files=files, timeout=30)
    res.raise_for_status()
    return res.json().get("results") or []


async def main() -> None:
    golden = json.loads((GOLDEN / "oportunidades.json").read_text())
    wanted = {i["id"].removeprefix("eu:") for i in golden["items"] if i["source"] == "eu"}
    async with httpx.AsyncClient(headers={"User-Agent": settings.user_agent}) as client:
        results = await asyncio.gather(*(search(client, t, p) for t, p in QUERIES))
    out: dict[str, dict[str, str]] = {}
    for r in (x for page in results for x in page):
        m = r.get("metadata") or {}
        ident = ((m.get("identifier") or m.get("callIdentifier") or [""])[0]) or ""
        if ident in wanted and ident not in out:
            desc = (m.get("description") or m.get("descriptionByte") or [""])[0]
            out[ident] = {"description": decode_html(desc or "")[:2000]}
    (GOLDEN / "eu_inputs.json.gz").write_bytes(gzip.compress(json.dumps(out, ensure_ascii=False).encode()))
    print(f"{len(out)}/{len(wanted)} EU calls captured")


if __name__ == "__main__":
    asyncio.run(main())
