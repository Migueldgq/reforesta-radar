"""Review step of the ingest: ask the «Revisión por IA» (app/review.py, ADR 0041) about the live calls that have no
current verdict. Runs after the main transaction is committed, next to the history step, with its own HTTP client,
time budget and one small transaction per verdict, so a timeout keeps the verdicts already given. It never raises and
never fails the ingest; with the review off it does nothing.

    python -m app.ingest.review      # the step alone, on what is stored (e.g. after changing the prompt)
"""

import asyncio
import logging
import sys
import time
from collections import Counter

import httpx
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncEngine

from app.api.state import read_state
from app.config import settings
from app.db.session import make_engine
from app.db.tables import ai_reviews
from app.http import map_limit
from app.models import Opportunity
from app.review import ask, input_hash
from app.scoring.rank import rank

log = logging.getLogger("ingest.review")

CONCURRENCY = 2  # the free tier allows a few requests per minute; 429s are retried with Google's own delay
STOP_AFTER_THROTTLED = 3  # calls in a row still refused with 429: the quota is spent, stop asking for this run
BUDGET_S = 1800.0
PROGRESS_EVERY = 25


async def pending(engine: AsyncEngine) -> list[Opportunity]:
    """Live calls as listed (best score first, so a capped run covers the top of the list), without a current
    verdict. Company programmes are left out: that list is checked by hand (ADR 0013)."""
    async with engine.connect() as conn:
        items = [o for o in rank((await read_state(conn)).items) if o.kind != "empresa"]
        ids = [o.id for o in items]
        q = select(ai_reviews.c.opportunity_id, ai_reviews.c.input_hash).where(ai_reviews.c.opportunity_id.in_(ids))
        cached = {r.opportunity_id: r.input_hash for r in await conn.execute(q)} if ids else {}
    return [o for o in items if cached.get(o.id) != input_hash(o)]


async def save(engine: AsyncEngine, o: Opportunity, verdict: str, reason: str) -> None:
    row = {"opportunity_id": o.id, "input_hash": input_hash(o), "verdict": verdict, "reason": reason,
           "model": settings.ai_model}  # fmt: skip
    stmt = pg_insert(ai_reviews).values(**row)
    async with engine.begin() as conn:
        await conn.execute(
            stmt.on_conflict_do_update(
                index_elements=[ai_reviews.c.opportunity_id],
                set_={**{k: stmt.excluded[k] for k in row if k != "opportunity_id"}, "reviewed_at": func.now()},
            )
        )


async def run_review(engine: AsyncEngine, budget_s: float = BUDGET_S) -> Counter[str]:
    """Never raises. Returns the counts it printed (verdicts, failures, 429s), for tests."""
    counts: Counter[str] = Counter()
    if not settings.ai_review_on:
        return counts
    t0 = time.monotonic()
    try:
        todo = await pending(engine)
        capped = todo[: settings.ai_max_calls]
        print(f"[review] {len(todo)} calls without a current verdict; asking about {len(capped)} "
              f"(RADAR_AI_MAX_CALLS={settings.ai_max_calls})", flush=True)  # fmt: skip
        throttled_in_a_row = 0
        done = 0

        async def one(o: Opportunity) -> None:
            nonlocal throttled_in_a_row, done
            if throttled_in_a_row >= STOP_AFTER_THROTTLED:
                counts["skipped"] += 1
                return
            res = await ask(client, o)
            done += 1
            if res.review is not None:
                throttled_in_a_row = 0
                counts[res.review.verdict] += 1
                await save(engine, o, res.review.verdict, res.review.reason)
            else:
                counts["failed"] += 1
                counts["throttled"] += res.throttled
                throttled_in_a_row = throttled_in_a_row + 1 if res.throttled else 0
                log.info("no verdict for %s: %s", o.id, res.error)
                if throttled_in_a_row == STOP_AFTER_THROTTLED:
                    print("[review] the model keeps answering 429 (quota spent): stopping for this run", flush=True)
            if done % PROGRESS_EVERY == 0:
                print(f"[review] {done}/{len(capped)} · {dict(counts)} · {time.monotonic() - t0:.0f} s", flush=True)

        async with httpx.AsyncClient(timeout=None) as client:
            try:
                async with asyncio.timeout(budget_s):
                    await map_limit(capped, CONCURRENCY, one)
            except TimeoutError:
                print(f"[review] time budget of {budget_s:.0f} s spent: keeping the verdicts given", flush=True)
    except Exception:  # noqa: BLE001 - the ingest is already stored; the review is best effort
        log.exception("review step failed (the ingest itself is stored)")
        return counts
    print(f"[review] done: {dict(counts)} · {time.monotonic() - t0:.0f} s", flush=True)
    return counts


async def _main() -> int:
    if not settings.ai_review_on:
        print("[review] off: set GEMINI_API_KEY (and leave RADAR_AI_REVIEW on) to use it", file=sys.stderr)
        return 1
    engine = make_engine()
    try:
        await run_review(engine)
    finally:
        await engine.dispose()
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    sys.exit(asyncio.run(_main()))
