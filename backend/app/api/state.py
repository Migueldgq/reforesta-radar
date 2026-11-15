"""Read path (port of readState in store-pg.ts and readDb in aggregate.ts), plus the history of BDNS calls."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.db.tables import bdns_editions
from app.models import History, Opportunity, SourceHealth
from app.sources import SOURCE_ORDER
from app.sources.bdns_history import EditionRow, build_history, from_db

INGEST_STALE = timedelta(hours=36)  # one daily ingest missed, with margin

# Latest run of every source; a failed run takes category/url from the last run that worked.
HEALTH_SQL = text("""
    select distinct on (s.source_id)
      s.source_id as id, s.name, s.status, s.count, s.note, s.error, s.finished_at,
      coalesce((select s3.category from source_runs s3 where s3.source_id = s.source_id and s3.status <> 'error'
                order by s3.run_id desc limit 1), s.category) as category,
      coalesce((select s3.url from source_runs s3 where s3.source_id = s.source_id and s3.status <> 'error'
                order by s3.run_id desc limit 1), s.url) as url,
      (select max(s2.finished_at) from source_runs s2
        where s2.source_id = s.source_id and s2.status <> 'error') as last_ok_at,
      (select count(*)::int from opportunities o where o.source = s.source_id and o.gone_at is null) as live
    from source_runs s
    order by s.source_id, s.run_id desc
""")
ITEMS_SQL = text("select data, first_seen_at from opportunities where gone_at is null")
LAST_INGEST_SQL = text("select max(finished_at) from ingest_runs where status in ('ok', 'partial')")


def iso(dt: datetime) -> str:
    """JS Date.toISOString(): UTC, milliseconds, "Z"."""
    return dt.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass
class State:
    items: list[Opportunity]
    sources: list[SourceHealth]
    last_ingest_at: str | None
    ingest_stale: bool


def _order(source_id: str) -> int:
    return SOURCE_ORDER.index(source_id) if source_id in SOURCE_ORDER else -1  # JS indexOf: unknown first


async def read_sources(conn: AsyncConnection) -> list[SourceHealth]:
    sources = []
    for h in await conn.execute(HEALTH_SQL):
        base = SourceHealth(
            id=h.id, name=h.name, category=h.category, status=h.status, count=h.count, url=h.url, note=h.note
        )
        if h.status != "error" or h.live == 0:
            sources.append(base)
            continue
        # Failed in the last run but earlier rows are still served: say so, like the TS cache path does.
        when = f" del {iso(h.last_ok_at)[:16].replace('T', ' ')} UTC" if h.last_ok_at else ""
        note = f"Mostrando datos de la última ingesta correcta{when}; la última falló ({h.error or h.note})."
        sources.append(base.model_copy(update={"status": "partial", "count": h.live, "note": note}))
    return sorted(sources, key=lambda s: _order(s.id))


async def last_ingest(conn: AsyncConnection) -> tuple[str | None, bool]:
    last = (await conn.execute(LAST_INGEST_SQL)).scalar()
    stale = last is None or datetime.now(UTC) - last > INGEST_STALE
    return (iso(last) if last else None), stale


async def read_histories(conn: AsyncConnection, ids: list[str]) -> dict[str, History]:
    """`history` of each BDNS opportunity id that has previous editions in bdns_editions."""
    numeros = [i.removeprefix("bdns:") for i in ids if i.startswith("bdns:")]
    rows: dict[str, list[EditionRow]] = defaultdict(list)
    if numeros:
        for r in await conn.execute(select(bdns_editions).where(bdns_editions.c.call_numero.in_(numeros))):
            rows[r.call_numero].append(from_db(r))
    out = {}
    for n, rs in rows.items():
        if (h := build_history(rs)) is not None:
            out[f"bdns:{n}"] = h
    return out


async def read_state(conn: AsyncConnection) -> State:
    items = [
        Opportunity.model_validate({**r.data, "firstSeenAt": iso(r.first_seen_at)})
        for r in await conn.execute(ITEMS_SQL)
    ]
    histories = await read_histories(conn, [o.id for o in items])
    items = [o.model_copy(update={"history": histories[o.id]}) if o.id in histories else o for o in items]
    sources = await read_sources(conn)
    last, stale = await last_ingest(conn)
    return State(items=items, sources=sources, last_ingest_at=last, ingest_stale=stale)
