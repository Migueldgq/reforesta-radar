"""Daily ingest at RADAR_INGEST_AT (default 09:00, RADAR_TZ): `python -m app.ingest.scheduler`.

Wakes every 30 s and runs `python -m app.ingest --trigger schedule` when a run is due (see `is_due`).
Polling instead of sleeping until 09:00 survives the host sleeping (a laptop): the first tick after waking catches
up. Each tick also claims an admin's "update now" request (table ingest_requests, POST /api/ingest) and runs it
with `--trigger request`; one short connection per tick, two tiny indexed queries.
"""

import asyncio
import logging
import subprocess
import sys
import time as clock
from datetime import datetime, time, timedelta

from sqlalchemy import TextClause, text

from app.config import local_now, settings
from app.db.session import make_engine
from app.ingest.store import INTERRUPTED_RUNS_SQL

log = logging.getLogger("scheduler")

TICK_S = 30  # also how soon an "update now" request is picked up
RETRY_AFTER = timedelta(hours=1)  # a failed run is retried at most once an hour
LAST_OK_SQL = text("select max(finished_at) from ingest_runs where status in ('ok', 'partial')")
CLAIM_SQL = text("""
    update ingest_requests set status = 'running', started_at = now()
    where id = (select id from ingest_requests where status = 'requested' order by id limit 1 for update skip locked)
    returning id
""")
FINISH_SQL = text("update ingest_requests set status = :status, finished_at = now(), error = :error where id = :id")
# a request left "running" by a scheduler that died mid-run would block every later request
INTERRUPTED_SQL = text("""
    update ingest_requests set status = 'failed', finished_at = now(), error = 'Interrumpida al reiniciarse'
    where status = 'running'
""")


def latest_slot(now: datetime, at: time) -> datetime:
    """The most recent run time at or before now (today's if it has passed, else yesterday's)."""
    slot = datetime.combine(now.date(), at, tzinfo=now.tzinfo)
    return slot if now >= slot else slot - timedelta(days=1)


def is_due(now: datetime, at: time, last_ok: datetime | None, last_attempt: datetime | None = None) -> bool:
    """Due when the database was never ingested, or when no ingest (any trigger) has succeeded since the latest
    slot: after 09:00, none since today's 09:00; before 09:00, none since yesterday's (a missed day catches up as soon
    as the host wakes). After a failed attempt, wait RETRY_AFTER before the next one."""
    if last_attempt is not None and now - last_attempt < RETRY_AFTER:
        return False
    return last_ok is None or last_ok < latest_slot(now, at)


async def _execute(sql: TextClause, **params: object) -> None:
    engine = make_engine()
    try:
        async with engine.begin() as conn:
            await conn.execute(sql, params)
    finally:
        await engine.dispose()


async def poll() -> tuple[datetime | None, int | None]:
    """(last successful ingest, id of the request just claimed or None)."""
    engine = make_engine()
    try:
        async with engine.begin() as conn:
            last_ok = (await conn.execute(LAST_OK_SQL)).scalar()
            claimed = (await conn.execute(CLAIM_SQL)).scalar()
            return last_ok, claimed
    finally:
        await engine.dispose()


def run_ingest(trigger: str) -> int:
    return subprocess.run([sys.executable, "-m", "app.ingest", "--trigger", trigger]).returncode


def run_request(request_id: int) -> None:
    log.info("ingest requested from the web (request %d); running", request_id)
    code = run_ingest("request")
    log.info("requested ingest finished with exit code %d", code)
    status, error = ("done", None) if code == 0 else ("failed", f"La ingesta terminó con código {code}")
    try:
        asyncio.run(_execute(FINISH_SQL, status=status, error=error, id=request_id))
    except Exception as e:  # noqa: BLE001 - left "running"; the next scheduler start marks it failed
        log.warning("cannot record the end of request %d: %s", request_id, e)


def _fmt(dt: datetime | None) -> str:
    return dt.astimezone(settings.tz).strftime("%Y-%m-%d %H:%M") if dt else "never"


def main() -> None:
    at = time.fromisoformat(settings.ingest_at)
    log.info("daily ingest at %s %s; checking every %d s", at.strftime("%H:%M"), settings.timezone, TICK_S)
    last_attempt: datetime | None = None
    announced: datetime | None = None
    try:
        asyncio.run(_execute(INTERRUPTED_SQL))
        asyncio.run(_execute(INTERRUPTED_RUNS_SQL))  # an ingest killed with the previous scheduler
    except Exception as e:  # noqa: BLE001
        log.warning("cannot reset interrupted requests: %s", e)
    while True:
        try:
            last_ok, claimed = asyncio.run(poll())
        except Exception as e:  # noqa: BLE001 - database down: try again next tick
            log.warning("cannot read the last ingest: %s", e)
        else:
            now = local_now()
            if claimed is not None:
                run_request(claimed)
            elif is_due(now, at, last_ok, last_attempt):
                log.info("ingest due (last successful: %s); running", _fmt(last_ok))
                last_attempt = now
                code = run_ingest("schedule")
                log.info("ingest finished with exit code %d", code)
            else:
                # not due: either done since the latest slot, or waiting out RETRY_AFTER after a failed run
                done = last_ok is not None and last_ok >= latest_slot(now, at)
                nxt = (
                    latest_slot(now, at) + timedelta(days=1)
                    if done or last_attempt is None
                    else last_attempt + RETRY_AFTER
                )
                if nxt != announced:
                    log.info("not due (last successful: %s); next run at %s", _fmt(last_ok), _fmt(nxt))
                    announced = nxt
        clock.sleep(TICK_S)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    main()
