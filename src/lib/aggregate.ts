import { getBdnsOpportunities } from "./bdns";
import { getBoeRadar } from "./boe";
import { cachedSource, getAggregate, warmUp, type AggregateData, type SourceResult } from "./cache";
import type { OpportunitiesResponse, Opportunity } from "./opportunity";
import { RSC_OPPORTUNITIES } from "./rsc-opportunities";
import { geographicFit, kindFit, scoreRsc } from "./scoring";
import { fetchBocyl, fetchBoja, fetchMontemadrid, fetchTed } from "./sources/extra";
import { scrapeBocm, scrapeDog, scrapeEu, scrapeFundacionBiodiversidad } from "./sources/multi-source";
import type { SourceHealth } from "./types";

const HOUR = 60 * 60 * 1000;

// [id, name, TTL, timeout, fetcher] — TTL matches how often each source publishes.
const SOURCES: [string, string, number, number, () => Promise<SourceResult>][] = [
  ["bdns", "BDNS", 2 * HOUR, 35000, getBdnsOpportunities],
  ["boe", "BOE", 3 * HOUR, 25000, () => getBoeRadar(true)],
  ["eu", "UE · Funding & Tenders", 6 * HOUR, 25000, scrapeEu],
  ["bocm", "BOCM · Comunidad de Madrid", 3 * HOUR, 25000, scrapeBocm],
  ["dog", "DOG · Diario Oficial de Galicia", 3 * HOUR, 25000, scrapeDog],
  ["fb", "Fundación Biodiversidad", 6 * HOUR, 25000, scrapeFundacionBiodiversidad],
  ["boja", "BOJA · Junta de Andalucía", 3 * HOUR, 25000, fetchBoja],
  ["bocyl", "BOCYL · Castilla y León", 3 * HOUR, 25000, fetchBocyl],
  ["ted", "TED · Licitaciones UE (España)", 3 * HOUR, 25000, fetchTed],
  ["montemadrid", "Fundación Montemadrid · Convocatorias", 12 * HOUR, 25000, fetchMontemadrid],
];

function rscItems(): Opportunity[] {
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

// Each source is cached independently (own TTL, own timeout, last-good fallback) — see cache.ts.
async function build(force: boolean): Promise<AggregateData> {
  const results = await Promise.all(
    SOURCES.map(([id, name, ttlMs, timeoutMs, fn]) => cachedSource(id, name, { ttlMs, timeoutMs, force }, fn))
  );

  const rsc = rscItems();
  const all = [...results.flatMap((r) => r.items), ...rsc];

  // Dedupe by id (keep higher score) and drop items without title/url
  const byId = new Map<string, Opportunity>();
  for (const o of all) {
    if (!o.titulo?.trim() || !o.url?.trim()) continue;
    const prev = byId.get(o.id);
    if (!prev || o.fit.score > prev.fit.score) byId.set(o.id, o);
  }
  // Stored with BASE fit only; the geographic adjustment is applied per response (see rank()).
  const items = Array.from(byId.values());

  const sources: SourceHealth[] = [
    ...results.map((r) => r.health),
    {
      id: "rsc",
      name: "RSC · Fundaciones y empresas",
      category: "RSC Privado",
      status: "ok",
      count: rsc.length,
      url: "",
      note: "Lista curada a mano de programas privados que financian proyectos ambientales de ONG en España (sin plazo fijo).",
    },
  ];

  return { items, sources, fetchedAt: new Date().toISOString() };
}

/**
 * Geographic fit, then actionability by kind, on top of the cached base fit; then sort. Cached items are never mutated, so this is
 * idempotent and a change to GEO_FIT applies to the next response without rebuilding any source.
 */
function rank(items: Opportunity[]): Opportunity[] {
  return items
    .map((o) => ({ ...o, fit: kindFit({ ...o, fit: geographicFit(o) }) }))
    .sort((a, b) => {
      if (b.fit.score !== a.fit.score) return b.fit.score - a.fit.score;
      return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
    });
}

/** Stale-while-revalidate; `refresh` forces a rebuild of every source (still deduped). */
export async function getOpportunities(refresh = false): Promise<OpportunitiesResponse> {
  const data = await getAggregate(build, refresh);
  return { ...data, items: rank(data.items) };
}

/** Called from instrumentation at server start. */
export function warmOpportunities() {
  warmUp(build);
}
