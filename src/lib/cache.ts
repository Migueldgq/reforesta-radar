// Server-side caches for the radar (no external deps).
//  - aggregate: stale-while-revalidate, one shared in-flight build
//  - per-source last-good results with their own TTL + timeout (stale data beats an empty screen)
//  - memo(): small keyed TTL cache for immutable-ish upstream data (BDNS details, past BOE days)
// Everything lives on globalThis so dev hot-reload and the instrumentation bundle share it,
// and the last good state is persisted to .cache/oportunidades.json (silently skipped on read-only FS).
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import type { Opportunity, OpportunitiesResponse } from "./opportunity";
import type { SourceHealth } from "./types";

export type SourceResult = { items: Opportunity[]; health: SourceHealth };
export type AggregateData = Omit<OpportunitiesResponse, "cached" | "stale" | "refreshing">;

type SourceEntry = { at: number; result: SourceResult };
type MemoEntry = { at: number; ttl: number; value: unknown; persist: boolean };

interface Store {
  loaded: boolean;
  aggregate: { at: number; data: AggregateData } | null;
  aggregateInFlight: Promise<AggregateData> | null;
  sources: Map<string, SourceEntry>;
  sourceInFlight: Map<string, Promise<SourceResult>>;
  memo: Map<string, MemoEntry>;
  memoInFlight: Map<string, Promise<unknown>>;
  stats: { builds: number; sourceRuns: Record<string, number> };
}

const g = globalThis as typeof globalThis & { __radarStore?: Store };
const store: Store = (g.__radarStore ??= {
  loaded: false,
  aggregate: null,
  aggregateInFlight: null,
  sources: new Map(),
  sourceInFlight: new Map(),
  memo: new Map(),
  memoInFlight: new Map(),
  stats: { builds: 0, sourceRuns: {} },
});

export const AGGREGATE_TTL_MS = 10 * 60 * 1000;
const MEMO_MAX = 2000;
const CACHE_FILE = path.join(process.cwd(), ".cache", "oportunidades.json");

// ---------------------------------------------------------------- disk

function loadFromDisk() {
  if (store.loaded) return;
  store.loaded = true;
  try {
    const d = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (d?.v !== 1) return;
    store.aggregate ??= d.aggregate ?? null;
    for (const [k, e] of Object.entries(d.sources ?? {})) if (!store.sources.has(k)) store.sources.set(k, e as SourceEntry);
    for (const [k, e] of Object.entries(d.memo ?? {})) if (!store.memo.has(k)) store.memo.set(k, e as MemoEntry);
  } catch {
    // no file yet / unreadable: start cold
  }
}

let saving = false;
async function saveToDisk() {
  if (saving) return;
  saving = true;
  try {
    const memo = Object.fromEntries(Array.from(store.memo).filter(([, e]) => e.persist));
    const json = JSON.stringify({ v: 1, aggregate: store.aggregate, sources: Object.fromEntries(store.sources), memo });
    await fsp.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, json);
    await fsp.rename(tmp, CACHE_FILE);
  } catch {
    // read-only filesystem (serverless): memory cache only
  } finally {
    saving = false;
  }
}

// ---------------------------------------------------------------- helpers

function ago(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} días`;
}

// ---------------------------------------------------------------- memo

/** Cache a non-null async value under `key`. On refetch failure the expired value is still returned. */
export async function memo<T>(
  key: string,
  ttlMs: number | ((v: T) => number),
  fn: () => Promise<T | null>,
  opts: { persist?: boolean } = {}
): Promise<T | null> {
  loadFromDisk();
  const hit = store.memo.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value as T;
  let run = store.memoInFlight.get(key) as Promise<T | null> | undefined;
  if (!run) {
    run = fn()
      .catch(() => null)
      .then((value) => {
        if (value === null) return (hit?.value as T) ?? null;
        store.memo.delete(key);
        store.memo.set(key, {
          at: Date.now(),
          ttl: typeof ttlMs === "function" ? ttlMs(value) : ttlMs,
          value,
          persist: !!opts.persist,
        });
        if (store.memo.size > MEMO_MAX) store.memo.delete(store.memo.keys().next().value as string);
        return value;
      })
      .finally(() => store.memoInFlight.delete(key));
    store.memoInFlight.set(key, run);
  }
  return run;
}

// ---------------------------------------------------------------- sources

/**
 * Run one source with its own TTL and timeout. If it errors or times out, return its last good
 * items marked "partial" with an honest note. A timed-out run keeps going and still updates the cache.
 */
export async function cachedSource(
  id: string,
  name: string,
  opts: { ttlMs: number; timeoutMs: number; force?: boolean },
  fn: () => Promise<SourceResult>
): Promise<SourceResult> {
  loadFromDisk();
  const hit = store.sources.get(id);
  if (!opts.force && hit && Date.now() - hit.at < opts.ttlMs) return hit.result;

  let run = store.sourceInFlight.get(id);
  if (!run) {
    store.stats.sourceRuns[id] = (store.stats.sourceRuns[id] ?? 0) + 1;
    run = fn()
      .then((r) => {
        if (r.health.status !== "error") store.sources.set(id, { at: Date.now(), result: r });
        return r;
      })
      .finally(() => store.sourceInFlight.delete(id));
    store.sourceInFlight.set(id, run);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((res) => (timer = setTimeout(() => res("timeout"), opts.timeoutMs)));
  const outcome = await Promise.race([run.catch((e: unknown) => e as Error), timeout]);
  clearTimeout(timer);

  if (outcome !== "timeout" && !(outcome instanceof Error) && outcome.health.status !== "error") return outcome;

  const reason =
    outcome === "timeout"
      ? `la última consulta tardó más de ${Math.round(opts.timeoutMs / 1000)} s`
      : "la última consulta falló";
  const last = store.sources.get(id);
  if (last) {
    return {
      items: last.result.items,
      health: {
        ...last.result.health,
        status: "partial",
        note: `Mostrando datos de hace ${ago(Date.now() - last.at)}; ${reason}. ${last.result.health.note}`,
      },
    };
  }
  if (outcome !== "timeout" && !(outcome instanceof Error)) return outcome; // error health from the connector
  return {
    items: [],
    health: {
      id,
      name,
      category: "Otros",
      status: "error",
      count: 0,
      url: "",
      note: outcome === "timeout" ? `Sin respuesta: ${reason}.` : `Error: ${outcome.message}`,
    },
  };
}

// ---------------------------------------------------------------- aggregate

function startBuild(build: (force: boolean) => Promise<AggregateData>, force: boolean): Promise<AggregateData> {
  if (!store.aggregateInFlight) {
    const n = ++store.stats.builds;
    const t0 = Date.now();
    store.aggregateInFlight = build(force)
      .then((data) => {
        store.aggregate = { at: Date.now(), data };
        console.info(`[radar] aggregate build #${n}${force ? " (forced)" : ""}: ${data.items.length} items in ${Date.now() - t0} ms`);
        void saveToDisk();
        return data;
      })
      .finally(() => {
        store.aggregateInFlight = null;
      });
  }
  return store.aggregateInFlight;
}

/** Stale-while-revalidate: any cached aggregate is served at once; a stale one triggers a background build. */
export async function getAggregate(
  build: (force: boolean) => Promise<AggregateData>,
  force = false
): Promise<OpportunitiesResponse> {
  loadFromDisk();
  const cur = store.aggregate;
  if (!force && cur) {
    const stale = Date.now() - cur.at >= AGGREGATE_TTL_MS;
    if (stale) startBuild(build, false).catch((e) => console.error("[radar] background build failed", e));
    return { ...cur.data, cached: true, stale, refreshing: store.aggregateInFlight !== null };
  }
  try {
    const data = await startBuild(build, force);
    return { ...data, cached: false, stale: false, refreshing: false };
  } catch (e) {
    if (cur) return { ...cur.data, cached: true, stale: true, refreshing: false };
    throw e;
  }
}

/** Start a build at server start unless a fresh aggregate is already on disk. */
export function warmUp(build: (force: boolean) => Promise<AggregateData>) {
  loadFromDisk();
  if (store.aggregate && Date.now() - store.aggregate.at < AGGREGATE_TTL_MS) return;
  startBuild(build, false).catch((e) => console.error("[radar] warm-up failed", e));
}

export function cacheStats() {
  return {
    builds: store.stats.builds,
    sourceRuns: store.stats.sourceRuns,
    aggregateAgeMs: store.aggregate ? Date.now() - store.aggregate.at : null,
    memoSize: store.memo.size,
  };
}
