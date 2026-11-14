// Ingest: fetch every source and store the result in Postgres (one transaction per run).
// Independent of Next.js; run from anywhere with:
//   DATABASE_URL=... npx tsx scripts/ingest.ts [--dry-run] [--source bdns,boe] [--trigger schedule]
// --dry-run fetches and prints the diff against the database without writing (without DATABASE_URL it
// diffs against an empty database). Exit code 1 only if every source failed or the database write failed.
import { cleanItems, rscItems, RSC_HEALTH, SOURCES } from "../src/lib/aggregate";
import { persistedMemoSince, SCORING_VERSION, seedMemo, type SourceResult } from "../src/lib/cache";
import { closeDb, hasDb } from "../src/lib/db";
import { loadFetchCache, recordFailedRun, runStatus, writeIngest, type IngestResult, type SourceRunInput } from "../src/lib/store-pg";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "";
}

const dryRun = process.argv.includes("--dry-run");
const only = arg("source")?.split(",").map((s) => s.trim()).filter(Boolean);
const trigger = arg("trigger") || process.env.INGEST_TRIGGER || process.env.GITHUB_EVENT_NAME || "manual";

// The web timeouts in SOURCES are tuned for an interactive request; a cold batch run (no memo, BDNS doing
// ~68 searches + ~230 details) needs far longer. Sources run in parallel, so the whole fetch phase is
// bounded by this one value: 8 min leaves room for setup and the DB write inside the 15-min workflow limit.
const BATCH_TIMEOUT_MS = 8 * 60 * 1000;

type Job = { id: string; name: string; timeoutMs: number; fn: () => Promise<SourceResult> };
const jobs: Job[] = [
  ...SOURCES.map(([id, name, , timeoutMs, fn]) => ({ id, name, timeoutMs: Math.max(timeoutMs, BATCH_TIMEOUT_MS), fn })),
  {
    id: "rsc",
    name: RSC_HEALTH.name,
    timeoutMs: 1000,
    fn: async () => {
      const items = rscItems();
      return { items, health: { ...RSC_HEALTH, count: items.length } };
    },
  },
].filter((j) => !only?.length || only.includes(j.id));

/** Batch timeout per source (BATCH_TIMEOUT_MS, not the web one); a timed-out or thrown source becomes an "error" run (rows untouched). */
async function runSource(j: Job): Promise<SourceRunInput> {
  const startedAt = new Date();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((res) => (timer = setTimeout(() => res("timeout"), j.timeoutMs)));
  const outcome = await Promise.race([j.fn().catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))), timeout]);
  clearTimeout(timer);
  const finishedAt = new Date();
  if (outcome === "timeout" || outcome instanceof Error) {
    const error = outcome === "timeout" ? `Sin respuesta en ${Math.round(j.timeoutMs / 1000)} s` : `Error: ${outcome.message}`;
    return {
      health: { id: j.id, name: j.name, category: "Otros", status: "error", count: 0, url: "", note: error },
      items: [],
      startedAt,
      finishedAt,
      error,
    };
  }
  const items = cleanItems(outcome.items);
  return {
    health: { ...outcome.health, id: j.id, count: items.length },
    items,
    startedAt,
    finishedAt,
    error: outcome.health.status === "error" ? outcome.health.note : null,
  };
}

function printSummary(runs: SourceRunInput[], res: IngestResult | null, t0: number) {
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  const num = (s: string | number, n: number) => String(s).padStart(n);
  console.log(`\n${pad("source", 13)}${pad("status", 9)}${num("items", 6)}${num("new", 6)}${num("chg", 6)}${num("same", 6)}${num("gone", 6)}${num("secs", 7)}`);
  for (const r of runs) {
    const d = res?.perSource[r.health.id];
    const secs = ((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000).toFixed(1);
    console.log(
      `${pad(r.health.id, 13)}${pad(r.health.status, 9)}${num(r.items.length, 6)}${num(d?.new ?? "-", 6)}${num(d?.changed ?? "-", 6)}${num(d?.unchanged ?? "-", 6)}${num(d?.gone ?? "-", 6)}${num(secs, 7)}` +
        (r.error ? `  ${r.error.slice(0, 120)}` : "")
    );
  }
  if (res) {
    const t = Object.values(res.perSource).reduce(
      (a, d) => ({ new: a.new + d.new, changed: a.changed + d.changed, unchanged: a.unchanged + d.unchanged, gone: a.gone + d.gone }),
      { new: 0, changed: 0, unchanged: 0, gone: 0 }
    );
    console.log(`${pad("TOTAL", 22)}${num(runs.reduce((a, r) => a + r.items.length, 0), 6)}${num(t.new, 6)}${num(t.changed, 6)}${num(t.unchanged, 6)}${num(t.gone, 6)}`);
    const fields = Object.entries(res.changedFields).sort((a, b) => b[1] - a[1]);
    if (fields.length) console.log(`changed fields: ${fields.map(([k, n]) => `${k}×${n}`).join(", ")}`);
    if (res.duplicateGroups.length) {
      console.log(`candidate duplicate groups (not merged): ${res.duplicateGroups.length}`);
      for (const g of res.duplicateGroups.slice(0, 10)) console.log(`  ${g.key.slice(0, 70)} → ${g.ids.join(", ")}`);
    }
  }
  console.log(`\nduration ${((Date.now() - t0) / 1000).toFixed(1)} s${dryRun ? " (dry run: nothing written)" : ""}${res?.runId ? ` · run #${res.runId}` : ""}`);
}

async function main(): Promise<number> {
  const t0 = Date.now();
  const startedAt = new Date();
  if (!hasDb() && !dryRun) {
    console.error("DATABASE_URL is not set. Set it, or use --dry-run to fetch without a database.");
    return 1;
  }
  if (!jobs.length) {
    console.error(`No source matches --source ${only?.join(",")}. Known: ${[...SOURCES.map((s) => s[0]), "rsc"].join(", ")}`);
    return 1;
  }
  console.log(`[ingest] ${jobs.map((j) => j.id).join(", ")} · trigger=${trigger} · scoring v${SCORING_VERSION}${dryRun ? " · DRY RUN" : ""}`);

  // Persisted memo (BDNS details, past BOE days/notices) from Postgres instead of .cache/oportunidades.json.
  if (hasDb()) seedMemo(await loadFetchCache());
  else seedMemo([]); // dry run without a database: start cold, never touch the local cache file
  const memoSince = Date.now();

  const runs = await Promise.all(jobs.map(runSource));
  const status = runStatus(runs);

  let res: IngestResult | null = null;
  if (hasDb()) {
    try {
      res = await writeIngest({ startedAt, trigger, scoringVersion: SCORING_VERSION, sources: runs, memo: persistedMemoSince(memoSince), dryRun });
    } catch (e) {
      console.error("[ingest] database write failed (rolled back):", e);
      if (!dryRun) await recordFailedRun(startedAt, trigger, SCORING_VERSION, String((e as Error)?.message ?? e)).catch(() => {});
      printSummary(runs, null, t0);
      return 1;
    }
  } else {
    // dry run without a database: everything is "new"
    res = { runId: null, status, perSource: Object.fromEntries(runs.filter((r) => r.health.status !== "error").map((r) => [r.health.id, { new: r.items.length, changed: 0, unchanged: 0, gone: 0 }])), changedFields: {}, duplicateGroups: [] };
  }
  printSummary(runs, res, t0);
  if (status === "error") {
    console.error("[ingest] every source failed");
    return 1;
  }
  console.log(`[ingest] ${status}`);
  return 0;
}

main()
  .catch((e) => {
    console.error("[ingest] fatal:", e);
    return 1;
  })
  .then(async (code) => {
    await closeDb().catch(() => {});
    // Timed-out source fetches may still be pending: exit explicitly.
    process.exit(code);
  });
