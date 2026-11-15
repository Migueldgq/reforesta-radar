import { getBdnsOpportunities } from "./bdns";
import { getBoeRadar } from "./boe";
import { cachedSource, getAggregate, warmUp, type AggregateData, type SourceResult } from "./cache";
import type { OpportunitiesResponse, Opportunity } from "./opportunity";
import { RSC_OPPORTUNITIES } from "./rsc-opportunities";
import { geographicFit, kindFit, scoreRsc } from "./scoring";
import { scrapeBocm, scrapeDog, scrapeEu, scrapeFundacionBiodiversidad } from "./sources/multi-source";
import type { SourceHealth } from "./types";

const HOUR = 60 * 60 * 1000;

// [id, name, TTL, timeout, fetcher] — TTL matches how often each source publishes.
// Also run by scripts/ingest.ts (with its own longer timeouts) when the Postgres store is configured.
export const SOURCES: [string, string, number, number, () => Promise<SourceResult>][] = [
  ["bdns", "BDNS", 2 * HOUR, 35000, getBdnsOpportunities],
  ["boe", "BOE", 3 * HOUR, 25000, () => getBoeRadar(true)],
  ["eu", "UE · Funding & Tenders", 6 * HOUR, 25000, scrapeEu],
  ["bocm", "BOCM · Comunidad de Madrid", 3 * HOUR, 25000, scrapeBocm],
  ["dog", "DOG · Diario Oficial de Galicia", 3 * HOUR, 25000, scrapeDog],
  ["fb", "Fundación Biodiversidad", 6 * HOUR, 25000, scrapeFundacionBiodiversidad],
];

export function rscItems(): Opportunity[] {
  return RSC_OPPORTUNITIES.map((r) => ({
    id: `rsc:${r.id}`,
    source: "rsc",
    sourceLabel: "RSC · Privado",
    kind: "empresa",
    titulo: `${r.entity} — ${r.program}`,
    organismo: r.entity,
    region: "Estatal",
    nivelAdmin: "Privada",
    publishedAt: null,
    opensAt: null,
    deadline: null,
    deadlineText: r.cadence,
    budget: null,
    amountText: r.typicalAmount,
    tipo: r.type,
    beneficiarios: ["Entidades sin ánimo de lucro"],
    url: r.url,
    basesUrl: null,
    documents: [],
    summary: r.whyReforesta,
    rsc: { whyReforesta: r.whyReforesta, pitchAngle: r.pitchAngle, cadence: r.cadence },
    fit: scoreRsc({ titulo: r.program, focus: r.focus, whyReforesta: r.whyReforesta }),
  }));
}

export const RSC_HEALTH: SourceHealth = {
  id: "rsc",
  name: "RSC · Fundaciones y empresas",
  category: "RSC Privado",
  status: "ok",
  count: 0,
  url: "",
  note: "Lista curada a mano de programas privados que financian proyectos ambientales de ONG en España (sin plazo fijo).",
};

/** Dedupe by id (keep higher score) and drop items without title/url. */
export function cleanItems(all: Opportunity[]): Opportunity[] {
  const byId = new Map<string, Opportunity>();
  for (const o of all) {
    if (!o.titulo?.trim() || !o.url?.trim()) continue;
    const prev = byId.get(o.id);
    if (!prev || o.fit.score > prev.fit.score) byId.set(o.id, o);
  }
  return Array.from(byId.values());
}

// Each source is cached independently (own TTL, own timeout, last-good fallback) — see cache.ts.
async function build(force: boolean): Promise<AggregateData> {
  const results = await Promise.all(
    SOURCES.map(([id, name, ttlMs, timeoutMs, fn]) => cachedSource(id, name, { ttlMs, timeoutMs, force }, fn))
  );

  const rsc = rscItems();
  // Stored with BASE fit only; the geographic adjustment is applied per response (see rank()).
  const items = cleanItems([...results.flatMap((r) => r.items), ...rsc]);

  const sources: SourceHealth[] = [...results.map((r) => r.health), { ...RSC_HEALTH, count: rsc.length }];

  return { items, sources, fetchedAt: new Date().toISOString() };
}

/**
 * Geographic fit, then actionability by kind, on top of the cached base fit; then sort. Cached items are never mutated, so this is
 * idempotent and a change to GEO_FIT applies to the next response without rebuilding any source.
 */
export function rank(items: Opportunity[]): Opportunity[] {
  return items
    .map((o) => ({ ...o, fit: kindFit({ ...o, fit: geographicFit(o) }) }))
    .sort((a, b) => {
      if (b.fit.score !== a.fit.score) return b.fit.score - a.fit.score;
      return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
    });
}

// ---------------------------------------------------------------- Postgres store (optional)
// With DATABASE_URL set, the web is a stateless reader: scripts/ingest.ts fills Postgres, requests never
// fan out to the sources. Without it, everything below is skipped and the cache path runs as before.

const DB_READ_TTL_MS = 60 * 1000;
const INGEST_STALE_MS = 12 * HOUR;
const SOURCE_ORDER = [...SOURCES.map((s) => s[0]), "rsc"];

type DbRead = { at: number; data: AggregateData };
const gdb = globalThis as typeof globalThis & {
  __radarDbRead?: DbRead;
  __radarDbInFlight?: Promise<AggregateData> | null;
  __radarDbFailure?: { at: number; message: string };
};

async function readDb(): Promise<AggregateData> {
  const hit = gdb.__radarDbRead;
  if (hit && Date.now() - hit.at < DB_READ_TTL_MS) return hit.data;
  gdb.__radarDbInFlight ??= (async () => {
    const { readState } = await import("./store-pg");
    const s = await readState();
    // A database that has never had a successful ingest would show an empty radar: use the cache path instead.
    if (!s.lastIngestAt) throw Object.assign(new Error("no successful ingest yet"), { code: "SIN_INGESTA" });
    // Health rows of sources removed from the app stay in source_runs: show only registered sources.
    const sources = s.sources.filter((x) => SOURCE_ORDER.includes(x.id)).sort((a, b) => SOURCE_ORDER.indexOf(a.id) - SOURCE_ORDER.indexOf(b.id));
    const lastMs = s.lastIngestAt ? Date.parse(s.lastIngestAt) : null;
    const data: AggregateData = {
      items: s.items,
      sources,
      fetchedAt: s.lastIngestAt ?? new Date(0).toISOString(),
      storage: "postgres",
      lastIngestAt: s.lastIngestAt,
      ingestStale: lastMs === null || Date.now() - lastMs > INGEST_STALE_MS,
    };
    gdb.__radarDbRead = { at: Date.now(), data };
    return data;
  })().finally(() => {
    gdb.__radarDbInFlight = null;
  });
  return gdb.__radarDbInFlight;
}

function hasDb() {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Postgres when configured (a `refresh` never fans out from a web request: it returns the stored state);
 * otherwise stale-while-revalidate over the sources, where `refresh` forces a rebuild of every source.
 * If Postgres is configured but fails, fall back to the cache path and say so in `storageError`.
 */
export async function getOpportunities(refresh = false): Promise<OpportunitiesResponse> {
  let storageError: string | undefined;
  if (hasDb()) {
    // After a failure, skip Postgres for a minute so every request does not wait for a connect timeout.
    const failure = gdb.__radarDbFailure;
    if (failure && Date.now() - failure.at < DB_READ_TTL_MS) storageError = failure.message;
    else {
      try {
        const data = await readDb();
        gdb.__radarDbFailure = undefined;
        return { ...data, items: rank(data.items), cached: true, stale: false, refreshing: false };
      } catch (e) {
        const err = e as { code?: string; message?: string };
        storageError = `Base de datos no disponible (${err?.code || err?.message || "error desconocido"}); mostrando la caché local.`;
        gdb.__radarDbFailure = { at: Date.now(), message: storageError };
        console.error("[radar] postgres read failed, falling back to cache", e);
      }
    }
  }
  const data = await getAggregate(build, refresh);
  return { ...data, items: rank(data.items), storage: "cache", ...(storageError ? { storageError } : {}) };
}

/** Called from instrumentation at server start (no source fan-out when Postgres is the store). */
export function warmOpportunities() {
  if (hasDb()) return;
  warmUp(build);
}
