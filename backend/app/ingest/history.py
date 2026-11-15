"""History step of the ingest: previous editions and past winners of the best BDNS calls (app/sources/bdns_history.py).

Runs after the main transaction is committed, with its own HTTP client (3 requests in flight), time budget and
transaction. A failure or timeout here is logged and never fails the ingest or touches its rows; on a timeout, the
calls already read are still saved, and every call not read keeps the rows of an earlier run.
"""

import asyncio
import logging
import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncEngine

from app.config import local_today
from app.http import Http, map_limit
from app.ingest.store import write_history
from app.models import Opportunity
from app.scoring.rank import adjusted_fit
from app.sources.base import SourceContext
from app.sources.bdns_history import ListedCall, call_editions, fetch_organ_calls, fetch_organ_index, to_db
from app.sources.memo import Memo

log = logging.getLogger("ingest.history")

CONCURRENCY = 3  # BDNS answers bursts with 429
MIN_SCORE = 40  # displayed score (geographic + kind fit, without history)
PROGRESS_EVERY = 25


def wants_history(o: Opportunity) -> bool:
    """Competitive BDNS grants worth a look (displayed score >= 40), or closed recurring ones (next edition)."""
    if o.source != "bdns" or o.kind != "subvencion" or not o.fit.is_competitive:
        return False
    closed_recurring = o.fit.deadline_state == "cerrada" and o.fit.is_ong_eligible is not False
    return closed_recurring or adjusted_fit(o).score >= MIN_SCORE


async def collect(ctx: SourceContext, numeros: list[str], out: dict[str, list[dict[str, Any]]]) -> None:
    """Fill `out` (call number -> bdns_editions rows) as calls complete, so a timeout keeps what was read."""
    t0 = time.monotonic()
    today = local_today()
    organs = await fetch_organ_index(ctx)
    if not organs:
        print("[history] organ trees unavailable: skipped", flush=True)
        return
    in_flight: dict[str, asyncio.Task[list[ListedCall] | None]] = {}  # calls of one organ share one request

    def organ_calls(ids: list[int]) -> asyncio.Task[list[ListedCall] | None]:
        key = ",".join(map(str, ids))
        if key not in in_flight:
            in_flight[key] = asyncio.ensure_future(fetch_organ_calls(ctx, ids))
        return in_flight[key]

    done = 0

    async def one(n: str) -> None:
        nonlocal done
        try:
            rows = await call_editions(ctx, n, organs, organ_calls, today)
        except Exception:  # noqa: BLE001 - one bad call never stops the others
            log.warning("history of bdns:%s failed", n, exc_info=True)
            rows = None
        if rows is not None:
            out[n] = [to_db(r) for r in rows]
        done += 1
        if done % PROGRESS_EVERY == 0 or done == len(numeros):
            with_history = sum(1 for rs in out.values() if rs)
            print(
                f"[history] {done}/{len(numeros)} calls · {with_history} with history · {ctx.http.requests} requests"
                f" ({ctx.http.throttled}× 429) · {time.monotonic() - t0:.0f} s",
                flush=True,
            )

    try:
        await map_limit(numeros, CONCURRENCY, one)
    finally:
        for task in in_flight.values():
            task.cancel()


async def run_history(engine: AsyncEngine, memo: Memo, items: list[Opportunity], timeout_s: float) -> None:
    """Never raises."""
    t0, since = time.monotonic(), time.time()
    numeros = [o.id.removeprefix("bdns:") for o in items if wants_history(o)]
    print(f"[history] {len(numeros)} BDNS calls (competitive, score >= {MIN_SCORE} or closed recurring)", flush=True)
    out: dict[str, list[dict[str, Any]]] = {}
    try:
        async with Http(concurrency=CONCURRENCY) as http:
            try:
                async with asyncio.timeout(timeout_s):
                    await collect(SourceContext(http=http, memo=memo), numeros, out)
            except TimeoutError:
                print(f"[history] time budget of {timeout_s:.0f} s spent: saving the {len(out)} calls read", flush=True)
            requests, throttled = http.requests, http.throttled
        await write_history(engine, out, memo.persisted_since(since))
    except Exception:  # noqa: BLE001 - the ingest is already stored; history is best effort
        log.exception("history step failed (the ingest itself is stored)")
        return
    rows = [r for rs in out.values() for r in rs]
    previous = [r for r in rows if r["numero"] != r["call_numero"]]
    print(
        f"[history] saved: {sum(1 for rs in out.values() if rs)} calls with history, {len(previous)} past editions "
        f"({sum(1 for r in previous if r['awards_count'] is not None)} with awards checked) · {requests} requests "
        f"({throttled}× 429) · {time.monotonic() - t0:.0f} s",
        flush=True,
    )
