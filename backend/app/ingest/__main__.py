"""Ingest: fetch every source and store the result in Postgres (one transaction per run).
Port of scripts/ingest.ts.

    python -m app.ingest [--dry-run] [--source boe,rsc] [--trigger schedule]

--dry-run fetches and prints the diff against the database without writing (if the database is unreachable it
diffs against an empty one). Exit code 1 only if every source failed or the database write failed. After the write,
the BDNS history step (app/ingest/history.py) reads previous editions of the best BDNS calls; it never fails the run.
"""

import argparse
import asyncio
import logging
import os
import sys
import time
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncEngine

from app.config import settings
from app.db.session import make_engine
from app.http import Http
from app.ingest.history import run_history
from app.ingest.store import (
    IngestResult,
    SourceDiff,
    SourceRun,
    load_fetch_cache,
    record_failed_run,
    run_status,
    start_run,
    write_ingest,
)
from app.models import SourceHealth
from app.scoring import SCORING_VERSION
from app.scoring.rank import clean_items
from app.sources import SOURCES
from app.sources.base import Source, SourceContext, score_raw
from app.sources.memo import Memo

log = logging.getLogger("ingest")


async def run_source(source: Source, ctx: SourceContext, timeout_s: float) -> SourceRun:
    """Batch timeout per source; a timed-out or crashed source becomes an "error" run (its rows stay untouched)."""
    started = datetime.now(UTC)
    try:
        result = await asyncio.wait_for(source.fetch(ctx), timeout_s)
    except Exception as e:  # noqa: BLE001 - any connector failure is reported, never fatal for the run
        error = f"Sin respuesta en {round(timeout_s)} s" if isinstance(e, TimeoutError) else f"Error: {e}"
        log.warning("source %s failed: %s", source.id, error, exc_info=not isinstance(e, TimeoutError))
        print(f"[ingest] {source.id}: error ({error[:120]})", flush=True)
        health = {"id": source.id, "name": source.name, "category": "Otros", "status": "error", "count": 0, "url": ""}
        return SourceRun(
            health=SourceHealth(**health, note=error), items=[], started_at=started, finished_at=datetime.now(UTC),
            error=error,
        )  # fmt: skip
    items = clean_items([o for o in (score_raw(r) for r in result.items) if source.keep(o)])
    health = result.health.model_copy(
        update={"id": source.id, "count": len(items), "note": result.health.note.replace("{count}", str(len(items)))}
    )
    secs = (datetime.now(UTC) - started).total_seconds()
    print(f"[ingest] {source.id}: {len(items)} convocatorias en {secs:.0f} s ({health.status})", flush=True)
    return SourceRun(
        health=health,
        items=items,
        started_at=started,
        finished_at=datetime.now(UTC),
        error=health.note if health.status == "error" else None,
    )


def print_summary(runs: list[SourceRun], res: IngestResult | None, t0: float, dry_run: bool) -> None:
    def row(*cols: str) -> str:
        return cols[0].ljust(13) + cols[1].ljust(9) + "".join(c.rjust(6) for c in cols[2:7]) + cols[7].rjust(7)

    print("\n" + row("source", "status", "items", "new", "chg", "same", "gone", "secs"))
    for r in runs:
        d = res.per_source.get(r.health.id) if res else None
        nums = [str(x) for x in (d.new, d.changed, d.unchanged, d.gone)] if d else ["-"] * 4
        secs = f"{(r.finished_at - r.started_at).total_seconds():.1f}"
        line = row(r.health.id, r.health.status, str(len(r.items)), *nums, secs)
        print(line + (f"  {r.error[:120]}" if r.error else ""))
    if res:
        t = SourceDiff()
        for d in res.per_source.values():
            t.new, t.changed, t.unchanged, t.gone = (
                t.new + d.new,
                t.changed + d.changed,
                t.unchanged + d.unchanged,
                t.gone + d.gone,
            )
        total = sum(len(r.items) for r in runs)
        print("TOTAL".ljust(22) + "".join(str(x).rjust(6) for x in (total, t.new, t.changed, t.unchanged, t.gone)))
        if res.changed_fields:
            fields = sorted(res.changed_fields.items(), key=lambda kv: -kv[1])
            print("changed fields: " + ", ".join(f"{k}×{n}" for k, n in fields))
        if res.duplicate_groups:
            print(f"candidate duplicate groups (not merged): {len(res.duplicate_groups)}")
            for key, ids in res.duplicate_groups[:10]:
                print(f"  {key[:70]} → {', '.join(ids)}")
    suffix = (" (dry run: nothing written)" if dry_run else "") + (
        f" · run #{res.run_id}" if res and res.run_id else ""
    )
    print(f"\nduration {time.monotonic() - t0:.1f} s{suffix}")


async def connect(dry_run: bool) -> AsyncEngine | None:
    engine = make_engine()
    try:
        async with engine.connect():
            return engine
    except Exception as e:  # noqa: BLE001
        await engine.dispose()
        if not dry_run:
            raise
        print(f"[ingest] database unreachable ({type(e).__name__}): dry run against an empty database")
        return None


async def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m app.ingest", description="Fetch sources and store them in Postgres.")
    p.add_argument("--dry-run", action="store_true", help="fetch and diff, write nothing")
    p.add_argument("--source", default="", help=f"comma-separated subset of: {', '.join(SOURCES)}")
    p.add_argument("--trigger", default=os.getenv("INGEST_TRIGGER", "manual"))
    args = p.parse_args(argv)

    t0, started = time.monotonic(), datetime.now(UTC)
    only = [s.strip() for s in args.source.split(",") if s.strip()]
    unknown = [s for s in only if s not in SOURCES]
    if unknown:
        print(f"Unknown source(s) {', '.join(unknown)}. Known: {', '.join(SOURCES)}", file=sys.stderr)
        return 1
    disabled = set(settings.disabled_sources)
    if unknown_disabled := sorted(disabled - set(SOURCES)):
        print(f"[ingest] RADAR_DISABLED_SOURCES: unknown id(s) {', '.join(unknown_disabled)} ignored", file=sys.stderr)
    jobs = [s for s in SOURCES.values() if (not only or s.id in only) and s.id not in disabled]
    if skipped := [s for s in SOURCES if s in disabled and (not only or s in only)]:
        print(f"[ingest] desactivadas por RADAR_DISABLED_SOURCES: {', '.join(skipped)}", flush=True)
    if not jobs:
        print("[ingest] no source to read (all disabled or filtered out)", file=sys.stderr)
        return 1
    print(f"[ingest] {', '.join(j.id for j in jobs)} · trigger={args.trigger} · scoring v{SCORING_VERSION}"
          + (" · DRY RUN" if args.dry_run else ""))  # fmt: skip

    try:
        engine = await connect(args.dry_run)
    except Exception as e:  # noqa: BLE001
        print(f"[ingest] database unreachable: {e}", file=sys.stderr)
        return 1
    run_id: int | None = None
    try:
        seed = []
        if engine is not None:
            async with engine.connect() as conn:
                seed = await load_fetch_cache(conn)
            if not args.dry_run:
                run_id = await start_run(engine, started, args.trigger, SCORING_VERSION)
        memo = Memo(seed)
        memo_since = time.time()
        n = len(jobs)
        print(f"[ingest] leyendo {n} fuente{'s' if n != 1 else ''}… (cada una avisa al terminar)", flush=True)
        async with Http() as http:
            ctx = SourceContext(http=http, memo=memo)
            runs = await asyncio.gather(*(run_source(j, ctx, settings.ingest_source_timeout_s) for j in jobs))
        status = run_status(runs)
        try:
            res = await write_ingest(
                engine,
                started_at=started,
                trigger=args.trigger,
                scoring_version=SCORING_VERSION,
                runs=runs,
                memo=memo.persisted_since(memo_since),
                dry_run=args.dry_run,
                run_id=run_id,
            )
            run_id = None  # completed
        except Exception as e:
            log.exception("database write failed (rolled back)")
            if engine is not None and not args.dry_run:
                try:
                    await record_failed_run(engine, started, args.trigger, SCORING_VERSION, str(e), run_id)
                    run_id = None
                except Exception:  # noqa: BLE001
                    log.exception("could not record the failed run")
            print_summary(runs, None, t0, args.dry_run)
            return 1
        print_summary(runs, res, t0, args.dry_run)
        bdns = next((r for r in runs if r.health.id == "bdns" and r.health.status != "error"), None)
        if bdns is not None and engine is not None and not args.dry_run:
            # after the commit above: a failure or timeout here never fails the run (run_history never raises)
            await run_history(engine, memo, bdns.items, settings.history_timeout_s)
        if status == "error":
            print("[ingest] every source failed", file=sys.stderr)
            return 1
        print(f"[ingest] {status}")
        return 0
    finally:
        if engine is not None:
            if run_id is not None:  # crashed before the write: do not leave the run "running"
                try:
                    await record_failed_run(engine, started, args.trigger, SCORING_VERSION, "Interrumpida", run_id)
                except Exception:  # noqa: BLE001
                    log.exception("could not record the interrupted run")
            await engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    sys.exit(asyncio.run(main()))
