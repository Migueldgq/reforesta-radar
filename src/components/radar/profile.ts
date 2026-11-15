/**
 * The team's own adjustments on top of the server's fit score ("Perfil").
 * One per team, saved through the API (`/api/settings`). `applyProfile` is pure: it always starts from the
 * untouched server item, so applying it twice from the raw item gives the same result.
 */
import type { Opportunity, OpportunityKind } from "@/lib/opportunity";
import * as DefaultProfile from "@/lib/reforesta-profile";
import { WORK_LINE_LABELS } from "@/lib/reforesta-profile";
import { hasTerm, normalizeText, tierFor } from "@/lib/scoring";
import type { WorkLine } from "@/lib/types";

export interface ExtraKeyword {
  term: string;
  weight: number; // +5…+25
  line?: WorkLine;
}
export interface ExcludedTerm {
  term: string;
  penalty: number; // >= HIDE_PENALTY hides the item entirely
}
export interface UserProfile {
  extraKeywords: ExtraKeyword[];
  excludedTerms: ExcludedTerm[];
  linePriority: Record<WorkLine, number>; // −10…+10
  regionAdjust: Record<string, number>; // region name → −10…+10
  kinds: OpportunityKind[];
  minBudget: number | null;
  hideMunicipalOutsideRegions: boolean;
}

export const ALL_KINDS: OpportunityKind[] = ["subvencion", "licitacion", "boletin", "europa", "empresa"];
export const WORK_LINES = Object.keys(WORK_LINE_LABELS) as WorkLine[];
export const HIDE_PENALTY = 100;
export const PREFIX = "Vuestro perfil:";

export const DEFAULT_USER_PROFILE: UserProfile = {
  extraKeywords: [],
  excludedTerms: [],
  linePriority: { restauracion: 0, conservacion: 0, educacion: 0, agroambiental: 0 },
  regionAdjust: {},
  kinds: [...ALL_KINDS],
  minBudget: null,
  hideMunicipalOutsideRegions: false,
};

/** Server-side geographic baseline, if the scoring profile defines one (read defensively). */
type GeoFit = { regions?: Record<string, { delta: number; reason?: string }>; closedCap?: number };
export const SERVER_GEO: GeoFit | null = ((DefaultProfile as Record<string, unknown>).GEO_FIT as GeoFit | undefined) ?? null;

export function isNeutral(p: UserProfile): boolean {
  return (
    p.extraKeywords.length === 0 &&
    p.excludedTerms.length === 0 &&
    WORK_LINES.every((l) => !p.linePriority[l]) &&
    Object.values(p.regionAdjust).every((v) => !v) &&
    ALL_KINDS.every((k) => p.kinds.includes(k)) &&
    !p.minBudget &&
    !p.hideMunicipalOutsideRegions
  );
}

/* ---------- Schema-tolerant parsing ---------- */

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isLine = (v: unknown): v is WorkLine => typeof v === "string" && (WORK_LINES as string[]).includes(v);

/** Accepts anything (old versions, hand-edited JSON) and returns a valid profile; unknown fields are dropped. */
export function parseProfile(input: unknown): UserProfile {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const extraKeywords: ExtraKeyword[] = arr(o.extraKeywords).flatMap((k) => {
    const r = (k ?? {}) as Record<string, unknown>;
    const term = typeof r.term === "string" ? r.term.trim() : "";
    const weight = num(r.weight);
    if (!term || weight == null) return [];
    return [{ term, weight: clamp(Math.round(weight), 5, 25), ...(isLine(r.line) ? { line: r.line } : {}) }];
  });
  const excludedTerms: ExcludedTerm[] = arr(o.excludedTerms).flatMap((k) => {
    const r = (k ?? {}) as Record<string, unknown>;
    const term = typeof r.term === "string" ? r.term.trim() : "";
    const penalty = num(r.penalty);
    if (!term || penalty == null) return [];
    return [{ term, penalty: clamp(Math.round(penalty), 1, HIDE_PENALTY) }];
  });
  const lp = (o.linePriority ?? {}) as Record<string, unknown>;
  const linePriority = { ...DEFAULT_USER_PROFILE.linePriority };
  for (const l of WORK_LINES) linePriority[l] = clamp(num(lp[l]) ?? 0, -10, 10);
  const regionAdjust: Record<string, number> = {};
  for (const [k, v] of Object.entries((o.regionAdjust ?? {}) as Record<string, unknown>)) {
    const n = num(v);
    if (n) regionAdjust[k] = clamp(n, -10, 10);
  }
  const kinds = Array.isArray(o.kinds) ? ALL_KINDS.filter((k) => (o.kinds as unknown[]).includes(k)) : [...ALL_KINDS];
  const mb = num(o.minBudget);
  return {
    extraKeywords,
    excludedTerms,
    linePriority,
    regionAdjust,
    kinds,
    minBudget: mb && mb > 0 ? mb : null,
    hideMunicipalOutsideRegions: o.hideMunicipalOutsideRegions === true,
  };
}

/** Where this browser kept the profile before it became the team's (read once by the first-login import). */
export const PROFILE_KEY = "reforesta-radar:perfil:v1";

/* ---------- Applying the profile ---------- */

const signed = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

/** Regions the team counts as "theirs": positive server baseline or positive own adjustment. */
export function territoriesOf(p: UserProfile): Set<string> {
  const s = new Set<string>();
  for (const [r, v] of Object.entries(SERVER_GEO?.regions ?? {})) if (v.delta > 0 && (p.regionAdjust[r] ?? 0) >= 0) s.add(r);
  for (const [r, v] of Object.entries(p.regionAdjust)) if (v > 0) s.add(r);
  return s;
}

function haystack(o: Opportunity): string {
  return normalizeText([o.titulo, o.organismo, o.summary ?? "", ...o.beneficiarios].join(" | "));
}

/** Why an item is removed by the profile, or null if it stays. */
export function hiddenReason(o: Opportunity, p: UserProfile, territories = territoriesOf(p), hay = haystack(o)): string | null {
  if (!p.kinds.includes(o.kind)) return "tipo";
  if (p.minBudget && o.budget != null && o.budget < p.minBudget) return "importe";
  if (p.hideMunicipalOutsideRegions && o.nivelAdmin === "Local" && !territories.has(o.region)) return "municipal";
  if (p.excludedTerms.some((t) => t.penalty >= HIDE_PENALTY && hasTerm(hay, normalizeText(t.term)))) return "descartada";
  return null;
}

/** Returns a copy with the team's adjustments on top of the server fit (or the same object if nothing applies). */
export function applyProfile(o: Opportunity, p: UserProfile, hay = haystack(o)): Opportunity {
  let delta = 0;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const lines = new Set(o.fit.workLines);

  for (const k of p.extraKeywords) {
    if (!hasTerm(hay, normalizeText(k.term))) continue;
    delta += k.weight;
    if (k.line) lines.add(k.line);
    reasons.push(`${PREFIX} menciona «${k.term}» (${signed(k.weight)}).`);
  }
  for (const t of p.excludedTerms) {
    if (t.penalty >= HIDE_PENALTY || !hasTerm(hay, normalizeText(t.term))) continue;
    delta -= t.penalty;
    warnings.push(`${PREFIX} menciona «${t.term}», que descartáis (${signed(-t.penalty)}).`);
  }
  for (const l of WORK_LINES) {
    const v = p.linePriority[l];
    if (!v || !o.fit.workLines.includes(l)) continue;
    delta += v;
    (v > 0 ? reasons : warnings).push(`${PREFIX} prioridad ${v > 0 ? "alta" : "baja"} a ${WORK_LINE_LABELS[l]} (${signed(v)}).`);
  }
  const r = p.regionAdjust[o.region];
  if (r) {
    delta += r;
    (r > 0 ? reasons : warnings).push(`${PREFIX} territorio ${o.region} (${signed(r)}).`);
  }

  if (reasons.length === 0 && warnings.length === 0) return o;

  let score = Math.round(Math.min(100, Math.max(0, o.fit.score + delta)));
  // Like the server: closed calls (next edition) never climb into "alto" through a bonus.
  const cap = SERVER_GEO?.closedCap ?? 55;
  if (o.fit.deadlineState === "cerrada" && score > o.fit.score) score = Math.max(o.fit.score, Math.min(score, cap));
  return {
    ...o,
    fit: {
      ...o.fit,
      score,
      tier: tierFor(score),
      workLines: Array.from(lines),
      reasons: [...o.fit.reasons, ...reasons],
      warnings: [...o.fit.warnings, ...warnings],
    },
  };
}

/** Whole list: drops hidden items and adjusts the rest. Neutral profile → same array. */
export function applyProfileAll(items: Opportunity[], p: UserProfile): Opportunity[] {
  if (isNeutral(p)) return items;
  const territories = territoriesOf(p);
  const out: Opportunity[] = [];
  for (const o of items) {
    const hay = haystack(o);
    if (hiddenReason(o, p, territories, hay)) continue;
    out.push(applyProfile(o, p, hay));
  }
  return out;
}
