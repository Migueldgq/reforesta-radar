"""eu / fb / bocm / dog connectors on recorded fixtures, against the TypeScript connectors run on the same fixtures.

tests/fixtures/<id>/responses.json: url -> body, recorded live on 2026-11-15 and trimmed (anything else is a 404;
the DOG fixture is the 2026-06-05 summary, the most recent with a relevant notice; a few EU/FB entries are edited to
cover the municipality warning, the "-CANCELLED" skip and the "becas" drop).
tests/fixtures/<id>/expected.json: what the former TS connector returned on those fixtures with the same frozen clock
(frozen fixture: the TS backend and its dump tool were removed; see git history before the Python cutover).
Items and health must be identical.
"""

import json
from datetime import datetime
from pathlib import Path

import httpx
import pytest

from app.config import settings
from app.http import Http
from app.scoring import score
from app.sources import bocm, dog, eu, fb
from app.sources.base import Source, SourceContext, score_raw
from app.sources.memo import Memo

FIXTURES = Path(__file__).parent / "fixtures"
NOW = {  # the clocks the expected.json fixtures were dumped with
    "eu": datetime(2026, 11, 15, 12, 0, tzinfo=settings.tz),
    "fb": datetime(2026, 11, 15, 12, 0, tzinfo=settings.tz),
    "bocm": datetime(2026, 11, 15, 12, 0, tzinfo=settings.tz),
    "dog": datetime(2026, 6, 8, 12, 0, tzinfo=settings.tz),
}


def fixture_transport(source_id: str, seen: list[str]) -> httpx.MockTransport:
    responses: dict[str, str] = json.loads((FIXTURES / source_id / "responses.json").read_text())

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        seen.append(url)
        body = responses.get(url)
        return httpx.Response(404) if body is None else httpx.Response(200, text=body)

    return httpx.MockTransport(handler)


@pytest.mark.parametrize(
    ("source", "module"),
    [(eu.EuSource(), eu), (fb.FbSource(), fb), (bocm.BocmSource(), bocm), (dog.DogSource(), dog)],
    ids=["eu", "fb", "bocm", "dog"],
)
async def test_connector_matches_ts_on_fixture(source: Source, module: object, monkeypatch: pytest.MonkeyPatch) -> None:
    now = NOW[source.id]
    monkeypatch.setattr(score, "local_today", lambda: now.date())
    if hasattr(module, "local_now"):
        monkeypatch.setattr(module, "local_now", lambda: now)
    seen: list[str] = []
    async with Http(transport=fixture_transport(source.id, seen)) as http:
        result = await source.fetch(SourceContext(http=http, memo=Memo()))

    want = json.loads((FIXTURES / source.id / "expected.json").read_text())
    items = [o for o in (score_raw(r, now.date()) for r in result.items) if source.keep(o)]
    got = [o.to_json() for o in items]
    assert [o["id"] for o in got] == [o["id"] for o in want["items"]]
    for g, w in zip(got, want["items"], strict=True):
        assert g == w, g["id"]
    health = result.health.model_copy(
        update={"count": len(items), "note": result.health.note.replace("{count}", str(len(items)))}
    )
    assert health.to_json() == want["health"]
    assert want["items"], "fixture should yield at least one item"


async def test_eu_request_is_the_ts_multipart_post() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"results": []})

    async with Http(transport=httpx.MockTransport(handler)) as http:
        ctx = SourceContext(http=http, memo=Memo())
        assert await eu.sedia_search(ctx, "nature restoration", eu.HORIZON_ID, 100) == []
    (req,) = requests
    assert req.method == "POST"
    assert str(req.url).endswith("search?apiKey=SEDIA&text=nature%20restoration&pageSize=100&pageNumber=1")
    body = req.content.decode()
    assert req.headers["content-type"].startswith("multipart/form-data; boundary=")
    assert 'name="query"; filename="blob"\r\nContent-Type: application/json' in body
    assert '{"terms":{"frameworkProgramme":["43108390"]}}' in body
    assert '{"field":"deadlineDate","order":"DESC"}' in body


def test_fb_parse_amount() -> None:
    assert fb.parse_amount("28,5 millones de euros") == 28_500_000
    assert fb.parse_amount("800.000 €") == 800_000
    assert fb.parse_amount("1.234,56 euros") == 1235
    assert fb.parse_amount("Sin importe") is None
    assert fb.parse_amount(None) is None


def test_bocm_xml_url() -> None:
    assert (
        bocm.bocm_xml_url(datetime(2026, 11, 3).date(), 264)
        == "https://www.bocm.es/boletin/CM_Boletin_BOCM/2026/11/03/BOCM-20261103264.xml"
    )
