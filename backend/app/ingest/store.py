"""Write path of the Postgres store (port of writeIngest / recordFailedRun / loadFetchCache in store-pg.ts).

One transaction per run: upsert every item of every source that did not fail, log content changes, mark as gone
what a fully healthy ("ok") source no longer returns, record the run. A failed source's rows are untouched.
With dry_run the same diff is computed and nothing is written.
"""

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import case, delete, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from app.db.tables import bdns_editions, fetch_cache, ingest_runs, opportunities, opportunity_changes, source_runs
from app.ingest.hashing import content_hash, dedupe_key, stable_json
from app.models import Opportunity, SourceHealth
from app.sources.memo import PersistedMemo

RunStatus = Literal["ok", "partial", "error"]
CHUNK = 400


@dataclass
class SourceRun:
    health: SourceHealth
    items: list[Opportunity]
    started_at: datetime
    finished_at: datetime
    error: str | None


@dataclass
class SourceDiff:
    new: int = 0
    changed: int = 0
    unchanged: int = 0
    gone: int = 0


@dataclass
class IngestResult:
    run_id: int | None
    status: RunStatus
    per_source: dict[str, SourceDiff]
    changed_fields: dict[str, int] = field(default_factory=dict)
    duplicate_groups: list[tuple[str, list[str]]] = field(default_factory=list)


def run_status(runs: list[SourceRun]) -> RunStatus:
    ok = [r for r in runs if r.health.status != "error"]
    if not ok:
        return "error"
    return "ok" if all(r.health.status == "ok" for r in runs) else "partial"


def _iso_date(s: str | None) -> date | None:
    """A malformed date from a scraper must not abort the transaction: keep it in `data`, null the column."""
    if not s or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def _chunks[T](items: list[T], n: int = CHUNK) -> list[list[T]]:
    return [items[i : i + n] for i in range(0, len(items), n)]


def _top_level_diff(prev: dict[str, Any], nxt: dict[str, Any]) -> dict[str, dict[str, Any]]:
    diff = {}
    for k in dict.fromkeys([*prev, *nxt]):
        if k in ("fit", "firstSeenAt"):
            continue
        a, b = prev.get(k), nxt.get(k)
        if stable_json(a) != stable_json(b):
            diff[k] = {"from": a, "to": b}
    return diff


async def load_fetch_cache(conn: AsyncConnection) -> list[PersistedMemo]:
    rows = await conn.execute(select(fetch_cache.c.key, fetch_cache.c.value, fetch_cache.c.expires_at))
    return [PersistedMemo(r.key, r.value, r.expires_at.timestamp()) for r in rows]


async def write_ingest(
    engine: AsyncEngine | None,
    *,
    started_at: datetime,
    trigger: str,
    scoring_version: int,
    runs: list[SourceRun],
    memo: list[PersistedMemo],
    dry_run: bool,
    run_id: int | None = None,
) -> IngestResult:
    """Without an engine (dry run, no database) everything is diffed against an empty database. With `run_id` (the
    "running" row from start_run) that row is completed; otherwise a new one is inserted."""
    now = datetime.now(UTC)
    status = run_status(runs)
    live = [r for r in runs if r.health.status != "error"]
    ok_ids = [r.health.id for r in runs if r.health.status == "ok"]
    ids = [o.id for r in live for o in r.items]
    per_source = {r.health.id: SourceDiff() for r in runs}
    changed_fields: dict[str, int] = defaultdict(int)

    async def body(conn: AsyncConnection | None) -> IngestResult:
        prev: dict[str, Any] = {}
        if conn is not None:
            for part in _chunks(ids, 2000):
                q = select(opportunities.c.id, opportunities.c.content_hash, opportunities.c.data).where(
                    opportunities.c.id.in_(part)
                )
                prev.update({r.id: r for r in await conn.execute(q)})

        rows: list[dict[str, Any]] = []
        changes: list[dict[str, Any]] = []
        for r in live:
            d = per_source[r.health.id]
            for o in r.items:
                h = content_hash(o)
                data = o.to_json()
                p = prev.get(o.id)
                if p is None:
                    d.new += 1
                elif p.content_hash != h:
                    d.changed += 1
                    diff = _top_level_diff(p.data, data)
                    for k in diff:
                        changed_fields[k] += 1
                    changes.append(
                        {"opportunity_id": o.id, "previous_hash": p.content_hash, "new_hash": h, "diff": diff}
                    )
                else:
                    d.unchanged += 1
                rows.append(
                    {
                        "id": o.id,
                        "source": o.source,
                        "kind": o.kind,
                        "titulo": o.titulo,
                        "organismo": o.organismo or "",
                        "region": o.region,
                        "nivel_admin": o.nivel_admin,
                        "deadline": _iso_date(o.deadline),
                        "opens_at": _iso_date(o.opens_at),
                        "budget": o.budget,
                        "url": o.url,
                        "data": data,
                        "content_hash": h,
                        "dedupe_key": dedupe_key(o),
                        "first_seen_at": now,
                        "last_seen_at": now,
                        "last_changed_at": now,
                    }
                )

        # Gone: only for sources whose run was fully "ok" (never on error or partial).
        gone: list[tuple[str, str]] = []
        if conn is not None and ok_ids:
            seen = set(ids)
            q = select(opportunities.c.id, opportunities.c.source).where(
                opportunities.c.gone_at.is_(None), opportunities.c.source.in_(ok_ids)
            )
            gone = [(r.id, r.source) for r in await conn.execute(q) if r.id not in seen]
        for _, src in gone:
            per_source[src].gone += 1

        # Candidate duplicates among the items seen in this run (reported only, never merged).
        keyed: dict[str, list[str]] = defaultdict(list)
        for row in rows:
            keyed[row["dedupe_key"]].append(row["id"])
        duplicates = [(k, v) for k, v in keyed.items() if len(v) > 1]

        result = IngestResult(None, status, per_source, dict(changed_fields), duplicates)
        if dry_run or conn is None:
            return result

        totals = {
            "perSource": {k: vars(v) for k, v in per_source.items()},
            "changedFields": dict(changed_fields),
            "items": len(rows),
            "duplicateGroups": len(duplicates),
        }
        values = {"started_at": started_at, "finished_at": now, "status": status, "trigger": trigger,
                  "scoring_version": scoring_version, "totals": totals}  # fmt: skip
        stmt = (
            insert(ingest_runs).values(**values)
            if run_id is None
            else update(ingest_runs).where(ingest_runs.c.id == run_id).values(**values)
        )
        new_id = (await conn.execute(stmt.returning(ingest_runs.c.id))).scalar_one()

        for part in _chunks(rows):
            stmt = pg_insert(opportunities).values(part)
            ex = stmt.excluded
            await conn.execute(
                stmt.on_conflict_do_update(
                    index_elements=[opportunities.c.id],
                    set_={
                        **{
                            c: ex[c]
                            for c in (
                                "source",
                                "kind",
                                "titulo",
                                "organismo",
                                "region",
                                "nivel_admin",
                                "deadline",
                                "opens_at",
                                "budget",
                                "url",
                                "data",
                                "dedupe_key",
                                "last_seen_at",
                                "content_hash",
                            )
                        },  # fmt: skip
                        "gone_at": None,
                        "last_changed_at": case(
                            (opportunities.c.content_hash.is_distinct_from(ex.content_hash), ex.last_changed_at),
                            else_=opportunities.c.last_changed_at,
                        ),
                    },
                )
            )
        for part in _chunks(changes):
            await conn.execute(insert(opportunity_changes), [{**c, "run_id": new_id, "changed_at": now} for c in part])
        for part in _chunks([g[0] for g in gone], 2000):
            await conn.execute(update(opportunities).where(opportunities.c.id.in_(part)).values(gone_at=now))
        await conn.execute(
            insert(source_runs),
            [
                {
                    "run_id": new_id,
                    "source_id": r.health.id,
                    "name": r.health.name,
                    "category": r.health.category,
                    "status": r.health.status,
                    "count": len(r.items),
                    "note": r.health.note,
                    "url": r.health.url,
                    "started_at": r.started_at,
                    "finished_at": r.finished_at,
                    "error": r.error,
                }
                for r in runs
            ],
        )
        await upsert_fetch_cache(conn, memo, now)
        # Keep the memo table bounded: drop entries expired for more than 30 days.
        await conn.execute(delete(fetch_cache).where(fetch_cache.c.expires_at < now - timedelta(days=30)))
        result.run_id = new_id
        return result

    if engine is None:
        return await body(None)
    async with engine.begin() as conn:  # one transaction; rolled back on any error
        return await body(conn)


async def upsert_fetch_cache(conn: AsyncConnection, memo: list[PersistedMemo], now: datetime) -> None:
    for part in _chunks(memo):
        stmt = pg_insert(fetch_cache).values(
            [
                {
                    "key": m.key,
                    "value": m.value,
                    "expires_at": datetime.fromtimestamp(m.expires_at, UTC),
                    "updated_at": now,
                }
                for m in part
            ]  # fmt: skip
        )
        await conn.execute(
            stmt.on_conflict_do_update(
                index_elements=[fetch_cache.c.key],
                set_={
                    "value": stmt.excluded.value,
                    "expires_at": stmt.excluded.expires_at,
                    "updated_at": stmt.excluded.updated_at,
                },  # fmt: skip
            )
        )


async def write_history(
    engine: AsyncEngine, rows_by_call: dict[str, list[dict[str, Any]]], memo: list[PersistedMemo]
) -> None:
    """History step (app/ingest/history.py), its own transaction: replace the bdns_editions rows of every call it
    read (an empty list clears them) and save its memo entries. Calls it could not read are not in `rows_by_call`."""
    now = datetime.now(UTC)
    async with engine.begin() as conn:
        for part in _chunks(list(rows_by_call), 2000):
            await conn.execute(delete(bdns_editions).where(bdns_editions.c.call_numero.in_(part)))
        rows = [{**r, "fetched_at": now} for rs in rows_by_call.values() for r in rs]
        for part in _chunks(rows):
            await conn.execute(insert(bdns_editions), part)
        await upsert_fetch_cache(conn, memo, now)


async def start_run(engine: AsyncEngine, started_at: datetime, trigger: str, scoring_version: int) -> int:
    """A "running" ingest_runs row while the sources load (the API reports it as `ingest.running`); write_ingest or
    record_failed_run completes it."""
    async with engine.begin() as conn:
        stmt = insert(ingest_runs).values(
            started_at=started_at, status="running", trigger=trigger, scoring_version=scoring_version
        )
        return (await conn.execute(stmt.returning(ingest_runs.c.id))).scalar_one()


async def record_failed_run(
    engine: AsyncEngine,
    started_at: datetime,
    trigger: str,
    scoring_version: int,
    error: str,
    run_id: int | None = None,
) -> None:
    """Best-effort record of a run whose main transaction failed, so the health view shows it."""
    values = {"started_at": started_at, "finished_at": datetime.now(UTC), "status": "error", "trigger": trigger,
              "scoring_version": scoring_version, "totals": {"error": error}}  # fmt: skip
    async with engine.begin() as conn:
        if run_id is None:
            await conn.execute(insert(ingest_runs).values(**values))
        else:
            await conn.execute(update(ingest_runs).where(ingest_runs.c.id == run_id).values(**values))


INTERRUPTED_RUNS_SQL = text("""
    update ingest_runs set status = 'error', finished_at = now(),
           totals = totals || '{"error": "Interrumpida: el proceso terminó sin registrar el final"}'::jsonb
    where status = 'running'
""")
