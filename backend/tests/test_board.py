"""Shared team state against a real Postgres (see conftest.py): board, settings, votes, import, ingest requests and
the public endpoint."""

from datetime import UTC, datetime

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.ingest.scheduler import CLAIM_SQL, FINISH_SQL, INTERRUPTED_SQL
from app.ingest.store import SourceRun, write_ingest
from app.models import Opportunity, SourceHealth
from app.sources.base import score_raw
from app.sources.rsc import RSC_PROGRAMMES, to_raw


def _items(n: int | None = None) -> list[Opportunity]:
    return [score_raw(to_raw(r)) for r in RSC_PROGRAMMES[:n]]


async def _ingest(engine: AsyncEngine, items: list[Opportunity]) -> None:
    now = datetime.now(UTC)
    health = SourceHealth(id="rsc", name="RSC", category="RSC Privado", status="ok", count=len(items), url="", note="")
    await write_ingest(engine, started_at=now, trigger="test", scoring_version=14,
                       runs=[SourceRun(health, items, now, now, None)], memo=[], dry_run=False)  # fmt: skip


async def test_tracking_survives_the_call_leaving_the_sources(
    engine: AsyncEngine, admin: httpx.AsyncClient, member: httpx.AsyncClient
) -> None:
    items = _items(3)
    await _ingest(engine, items)
    oid = items[0].id
    res = await member.patch(f"/api/board/{oid}", json={"status": "estudio", "assigneeId": 1})
    assert res.status_code == 200
    item = res.json()
    assert item["status"] == "estudio" and item["assignee"] == {"id": 1, "name": "Ana"}
    assert item["titulo"] == items[0].titulo and item["gone"] is False and item["updatedBy"]["name"] == "Luis"
    note = await admin.post(f"/api/board/{oid}/notes", json={"body": "  Mirar bases  "})
    assert note.status_code == 201 and note.json()["author"]["name"] == "Ana" and note.json()["body"] == "Mirar bases"
    assert (await member.delete(f"/api/board/{oid}/notes/{note.json()['id']}")).status_code == 403  # not the author
    assert (await member.patch(f"/api/board/{oid}", json={"assigneeId": 99})).status_code == 400
    assert (await member.patch("/api/board/rsc:nope", json={"status": "estudio"})).status_code == 404
    unassigned = await member.patch(f"/api/board/{oid}", json={"assigneeId": None})
    assert unassigned.json()["assignee"] is None and unassigned.json()["status"] == "estudio"  # status untouched

    await _ingest(engine, items[1:])  # the call disappears from the latest ingest
    (row,) = (await member.get("/api/board")).json()["items"]
    assert row["opportunityId"] == oid and row["gone"] is True and row["status"] == "estudio"
    assert (row["titulo"], row["organismo"], row["source"], row["url"]) == (
        items[0].titulo, items[0].organismo, "rsc", items[0].url,
    )  # fmt: skip
    assert [n["body"] for n in row["notes"]] == ["Mirar bases"]
    # still editable once gone
    assert (await member.patch(f"/api/board/{oid}", json={"status": "descartada"})).json()["status"] == "descartada"


async def test_settings_shared_and_validated(admin: httpx.AsyncClient, member: httpx.AsyncClient) -> None:
    assert (await member.get("/api/settings")).json() == {
        "profile": None, "organisms": None, "updatedBy": None, "updatedAt": None,
    }  # fmt: skip
    profile = {
        "extraKeywords": [{"term": "dehesa", "weight": 10, "line": "restauracion"}, {"term": "lince", "weight": 5}],
        "excludedTerms": [{"term": "becas", "penalty": 100}],
        "linePriority": {"restauracion": 5, "conservacion": 0, "educacion": -2, "agroambiental": 0},
        "regionAdjust": {"Galicia": 3},
        "kinds": ["subvencion", "europa", "empresa"],
        "minBudget": 5000,
        "hideMunicipalOutsideRegions": True,
    }
    organisms = ["MITECO", "Fundación Biodiversidad"]
    res = await member.put("/api/settings", json={"profile": profile, "organisms": organisms})
    assert res.status_code == 200
    out = (await admin.get("/api/settings")).json()  # another person sees it
    assert out["profile"] == {**profile, "minBudget": 5000.0} and out["organisms"] == organisms
    assert out["updatedBy"]["name"] == "Luis" and out["updatedAt"]
    # partial update keeps the other field
    assert (await admin.put("/api/settings", json={"organisms": []})).json()["profile"] == out["profile"]
    bad = await member.put("/api/settings", json={"profile": {"extraKeywords": [{"term": "x", "weight": 99}]}})
    assert bad.status_code == 422
    neutral = await member.put("/api/settings", json={"profile": {}})  # default profile = never customised
    assert neutral.json()["profile"] is None


async def test_import_merges_without_overwriting_and_is_idempotent(
    engine: AsyncEngine, admin: httpx.AsyncClient, member: httpx.AsyncClient
) -> None:
    items = _items(3)
    await _ingest(engine, items)
    await admin.patch(f"/api/board/{items[0].id}", json={"status": "presentar"})
    await admin.put("/api/settings", json={"organisms": ["MITECO"]})
    local = {
        "tracking": {
            items[0].id: {
                "status": "descartada",
                "at": "2026-11-01T10:00:00.000Z",
                "titulo": "x",
                "organismo": "y",
                "deadline": None,
            },  # fmt: skip
            items[1].id: {
                "status": "estudio",
                "at": "2026-11-01T10:00:00.000Z",
                "titulo": "t",
                "organismo": "o",
                "deadline": None,
            },  # fmt: skip
            "bdns:1": {
                "status": "presentada",
                "titulo": "Una que ya no está",
                "organismo": "MITECO",
                "deadline": "2026-01-31",
            },  # fmt: skip
            items[2].id: {"status": "nueva"},
        },
        "profile": {"extraKeywords": [{"term": "dehesa", "weight": 10}]},
        "organisms": ["Junta de Andalucía"],
    }
    first = await member.post("/api/import", json=local)
    assert first.json() == {"trackingImported": 2, "trackingKept": 1, "profile": "imported", "organisms": "kept"}
    board = {i["opportunityId"]: i for i in (await member.get("/api/board")).json()["items"]}
    assert board[items[0].id]["status"] == "presentar"  # the team's value wins
    assert board[items[1].id]["status"] == "estudio" and board[items[1].id]["titulo"] == items[1].titulo
    assert board["bdns:1"]["titulo"] == "Una que ya no está" and board["bdns:1"]["gone"] is True
    assert items[2].id not in board
    settings_after = (await member.get("/api/settings")).json()
    assert settings_after["organisms"] == ["MITECO"]
    assert settings_after["profile"]["extraKeywords"] == [{"term": "dehesa", "weight": 10}]

    second = await admin.post("/api/import", json=local)
    assert second.json() == {"trackingImported": 0, "trackingKept": 3, "profile": "kept", "organisms": "kept"}
    assert {i["opportunityId"]: i["status"] for i in (await member.get("/api/board")).json()["items"]} == {
        k: v["status"] for k, v in board.items()
    }
    assert (await member.get("/api/settings")).json() == settings_after
    assert (await member.post("/api/import", json={})).json()["trackingImported"] == 0


async def test_votes_and_disagreements(
    engine: AsyncEngine, admin: httpx.AsyncClient, member: httpx.AsyncClient
) -> None:
    base = _items(3)
    low = base[0].model_copy(update={"fit": base[0].fit.model_copy(update={"score": 10})})
    high = base[1].model_copy(update={"fit": base[1].fit.model_copy(update={"score": 95})})
    await _ingest(engine, [low, high, base[2]])
    scores = {o["id"]: o["fit"]["score"] for o in (await member.get("/api/oportunidades")).json()["items"]}
    assert scores[low.id] < 40 <= scores[base[2].id] < 60 <= scores[high.id]

    assert (await member.put(f"/api/votes/{low.id}", json={"vote": "no_sirve"})).status_code == 200
    v = await member.put(f"/api/votes/{low.id}", json={"vote": "sirve", "reason": " Encaja con dehesas "})
    assert v.json()["vote"] == "sirve" and v.json()["reason"] == "Encaja con dehesas"  # changed, not added
    await admin.put(f"/api/votes/{low.id}", json={"vote": "no_sirve"})
    await admin.put(f"/api/votes/{high.id}", json={"vote": "no_sirve", "reason": "Solo empresas"})
    await member.put(f"/api/votes/{base[2].id}", json={"vote": "sirve"})  # score 40-59: no disagreement possible
    assert (await member.put("/api/votes/rsc:nope", json={"vote": "sirve"})).status_code == 404
    assert (await member.put(f"/api/votes/{low.id}", json={"vote": "quizas"})).status_code == 422

    votes = (await member.get("/api/votes")).json()["votes"]
    assert len(votes) == 4 and sum(1 for x in votes if x["opportunityId"] == low.id) == 2

    items = {d["opportunityId"]: d for d in (await admin.get("/api/votes/disagreements")).json()["items"]}
    assert set(items) == {low.id, high.id}
    assert items[low.id]["kind"] == "sirve_bajo" and items[low.id]["score"] == scores[low.id]
    assert {(x["user"]["name"], x["vote"]) for x in items[low.id]["votes"]} == {("Luis", "sirve"), ("Ana", "no_sirve")}
    assert items[high.id]["kind"] == "no_sirve_alto" and items[high.id]["votes"][0]["reason"] == "Solo empresas"

    assert (await member.delete(f"/api/votes/{low.id}")).status_code == 204
    items = (await admin.get("/api/votes/disagreements")).json()["items"]
    assert [d["opportunityId"] for d in items] == [high.id]


async def test_public_endpoint_leaks_nothing_about_people_or_board(
    engine: AsyncEngine, admin: httpx.AsyncClient, member: httpx.AsyncClient
) -> None:
    items = _items(3)
    await _ingest(engine, items)
    await member.patch(f"/api/board/{items[0].id}", json={"status": "presentar", "assigneeId": 2})
    await member.post(f"/api/board/{items[0].id}/notes", json={"body": "NOTA-PRIVADA-123"})
    await member.put(f"/api/votes/{items[0].id}", json={"vote": "no_sirve", "reason": "RAZON-PRIVADA-456"})
    await admin.put("/api/settings", json={"profile": {"extraKeywords": [{"term": "PERFIL-PRIVADO", "weight": 5}]}})
    async with httpx.AsyncClient(transport=member._transport, base_url="http://testserver") as anon:  # noqa: SLF001
        res = await anon.get("/api/public/oportunidades")
    assert res.status_code == 200 and "set-cookie" not in res.headers
    body = res.text
    for secret in ("NOTA-PRIVADA-123", "RAZON-PRIVADA-456", "PERFIL-PRIVADO", "example.org", "assignee", "votes",
                   "tracking", "updatedBy"):  # fmt: skip
        assert secret not in body, secret
    data = res.json()
    assert set(data) == {"items", "sources", "fetchedAt", "cached", "stale", "refreshing", "storage", "lastIngestAt",
                         "ingestStale"}  # fmt: skip
    assert {o["id"] for o in data["items"]} == {o.id for o in items}


async def test_ingest_request_lifecycle_and_guard(engine: AsyncEngine, admin: httpx.AsyncClient, member) -> None:  # noqa: ANN001
    assert (await member.get("/api/ingest")).json() == {"latest": None, "lastIngestAt": None}
    res = await admin.post("/api/ingest")
    assert res.status_code == 202
    latest = res.json()["latest"]
    assert latest["status"] == "requested" and latest["requestedBy"] == "Ana" and latest["startedAt"] is None
    dup = await admin.post("/api/ingest")
    assert dup.status_code == 409 and dup.json()["latest"]["id"] == latest["id"] and dup.json()["detail"]

    async with engine.begin() as conn:  # what ingest-scheduler does on its next tick
        claimed = (await conn.execute(CLAIM_SQL)).scalar()
        assert (await conn.execute(CLAIM_SQL)).scalar() is None  # nothing else to claim
    assert claimed == latest["id"]
    status = (await member.get("/api/ingest")).json()["latest"]
    assert status["status"] == "running" and status["startedAt"]
    assert (await admin.post("/api/ingest")).status_code == 409  # still guarded while running

    async with engine.begin() as conn:
        await conn.execute(FINISH_SQL, {"status": "done", "error": None, "id": claimed})
    status = (await member.get("/api/ingest")).json()["latest"]
    assert status["status"] == "done" and status["finishedAt"]

    nxt = (await admin.post("/api/ingest")).json()["latest"]
    async with engine.begin() as conn:  # the scheduler died mid-run: on restart the request is marked failed
        await conn.execute(CLAIM_SQL)
        await conn.execute(INTERRUPTED_SQL)
        q = text("select status from ingest_requests where id = :i")
        assert (await conn.execute(q, {"i": nxt["id"]})).scalar() == "failed"
    assert (await admin.post("/api/ingest")).status_code == 202
