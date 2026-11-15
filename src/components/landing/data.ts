import { cacheLife } from "next/cache";
import type { OpportunitiesResponse, Opportunity } from "@/lib/opportunity";
import type { SourceHealth } from "@/lib/types";
import { daysLeft, isClosed, isOpenNow, mondayOf, todayUTC, WEEK_MS } from "@/components/radar/model";

const NEXT_EDITION = /Convocatoria periódica: la edición actual (?:cerró el ([\d/]+)|ya cerró)/;

export interface LandingData {
  /** UTC midnight of the day the data was summarised; render code uses it instead of `new Date()`. */
  today: number;
  total: number;
  open: number;
  nextEdition: number;
  fetchedAt: string;
  sources: SourceHealth[];
  topOpen: Opportunity[];
  fitExample: Opportunity | null;
  nextEditionExamples: { o: Opportunity; closedOn: string | null }[];
  challengeSamples: { id: string; label: string; o: Opportunity | null }[];
  weeks: { start: number; count: number }[];
  weeksLater: number;
  /** Private programmes (hand-checked RSC list), best fit first. */
  companies: Opportunity[];
}

const TIMEOUT_MS = 4000;
/** The Python API, reached server-to-server (inside compose: http://api:8000). */
const API_URL = (process.env.API_URL ?? "http://localhost:8010").replace(/\/+$/, "");

function summarize(items: Opportunity[], sources: SourceHealth[], fetchedAt: string): LandingData {
  const byScore = [...items].sort((a, b) => b.fit.score - a.fit.score);
  const openItems = byScore.filter(isOpenNow);
  const nextEd = byScore.filter((o) => isClosed(o) && o.fit.reasons.some((r) => NEXT_EDITION.test(r)));

  const today = todayUTC();
  const start = mondayOf(today);
  const weeks = Array.from({ length: 12 }, (_, i) => ({ start: start + i * WEEK_MS, count: 0 }));
  let weeksLater = 0;
  for (const o of items) {
    const d = daysLeft(o);
    if (d == null || d < 0) continue;
    const t = today + d * 86_400_000;
    const i = Math.floor((t - start) / WEEK_MS);
    if (i < 12) weeks[i].count++;
    else weeksLater++;
  }

  const find = (id: string) => items.find((o) => o.id === id) ?? null;

  return {
    today,
    total: items.length,
    open: openItems.length,
    nextEdition: nextEd.length,
    fetchedAt,
    sources,
    topOpen: openItems.slice(0, 5),
    fitExample: openItems.find((o) => o.fit.reasons.length >= 3 && o.fit.warnings.length > 0) ?? openItems[0] ?? null,
    nextEditionExamples: nextEd.slice(0, 3).map((o) => ({
      o,
      closedOn: o.fit.reasons.map((r) => NEXT_EDITION.exec(r)?.[1]).find(Boolean) ?? null,
    })),
    challengeSamples: [
      { id: "bdns:923290", label: "MITECO · BDNS 923290", o: find("bdns:923290") },
      { id: "bdns:904719", label: "Comunidad de Madrid · Orden 1689/2026", o: find("bdns:904719") },
    ],
    weeks,
    weeksLater,
    companies: byScore.filter((o) => o.kind === "empresa").slice(0, 3),
  };
}

/**
 * Live figures for the landing, read from the API's `/api/oportunidades`. Cached for a few
 * minutes with `use cache`, so the figures are part of the server HTML (no client fetch, works
 * without JS). Returns `null` when the API is down or empty (e.g. during `next build` without a
 * running backend), so every section falls back to copy without numbers; that miss is cached briefly.
 */
export async function getLandingData(): Promise<LandingData | null> {
  "use cache";
  let result: LandingData | null = null;
  try {
    const res = await fetch(`${API_URL}/api/oportunidades`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = res.ok ? ((await res.json()) as OpportunitiesResponse) : null;
    if (data && data.items.length > 0) result = summarize(data.items, data.sources, data.fetchedAt);
  } catch {
    result = null;
  }
  cacheLife(result ? { stale: 60, revalidate: 300, expire: 3600 } : { stale: 30, revalidate: 30, expire: 120 });
  return result;
}
