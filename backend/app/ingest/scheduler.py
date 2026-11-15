"""Daily ingest at RADAR_INGEST_AT (default 09:00, RADAR_TZ): `python -m app.ingest.scheduler`.

Wakes every few minutes and runs `python -m app.ingest --trigger schedule` when a run is due (see `is_due`).
Polling instead of sleeping until 09:00 survives the host sleeping (a laptop): the first tick after waking catches
up.
"""

import asyncio
import logging
import subprocess
import sys
import time as clock
from datetime import datetime, time, timedelta

from sqlalchemy import text

from app.config import local_now, settings
from app.db.session import make_engine

log = logging.getLogger("scheduler")

TICK_S = 300
RETRY_AFTER = timedelta(hours=1)  # a failed run is retried at most once an hour
LAST_OK_SQL = text("select max(finished_at) from ingest_runs where status in ('ok', 'partial')")


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


async def last_ok_at() -> datetime | None:
    engine = make_engine()
    try:
        async with engine.connect() as conn:
            return (await conn.execute(LAST_OK_SQL)).scalar()
    finally:
        await engine.dispose()


def _fmt(dt: datetime | None) -> str:
    return dt.astimezone(settings.tz).strftime("%Y-%m-%d %H:%M") if dt else "never"


def main() -> None:
    at = time.fromisoformat(settings.ingest_at)
    log.info("daily ingest at %s %s; checking every %d s", at.strftime("%H:%M"), settings.timezone, TICK_S)
    last_attempt: datetime | None = None
    announced: datetime | None = None
    while True:
        try:
            last_ok = asyncio.run(last_ok_at())
        except Exception as e:  # noqa: BLE001 - database down: try again next tick
            log.warning("cannot read the last ingest: %s", e)
        else:
            now = local_now()
            if is_due(now, at, last_ok, last_attempt):
                log.info("ingest due (last successful: %s); running", _fmt(last_ok))
                last_attempt = now
                code = subprocess.run([sys.executable, "-m", "app.ingest", "--trigger", "schedule"]).returncode
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
