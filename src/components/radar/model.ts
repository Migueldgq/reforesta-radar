import type { Opportunity, OpportunityKind } from "@/lib/opportunity";
import type { FitAnalysis, WorkLine } from "@/lib/types";
import { WORK_LINE_LABELS } from "@/lib/reforesta-profile";

/* ---------- Triage ---------- */

export type Triage = "nueva" | "estudio" | "presentar" | "presentada" | "descartada";

export const TRIAGE_ORDER: Triage[] = ["nueva", "estudio", "presentar", "presentada", "descartada"];

export const TRIAGE_LABELS: Record<Triage, string> = {
  nueva: "Sin revisar",
  estudio: "En estudio",
  presentar: "A presentar",
  presentada: "Presentada",
  descartada: "Descartada",
};

/* ---------- Labels ---------- */

export const KIND_LABELS: Record<OpportunityKind, string> = {
  subvencion: "Subvenciones",
  licitacion: "Licitaciones",
  boletin: "Anuncios en boletines",
  europa: "Fondos europeos",
  empresa: "Empresas y fundaciones",
};

export const TIER_LABELS: Record<FitAnalysis["tier"], string> = {
  alto: "Encaje alto",
  medio: "Encaje medio",
  bajo: "Encaje bajo",
};

export const NO_LINE = "ninguna";

export function workLineLabel(key: string): string {
  if (key === NO_LINE) return "Sin línea clara";
  return WORK_LINE_LABELS[key as WorkLine] ?? key;
}

export const BUDGET_BUCKETS = [
  { key: "b1", label: "Menos de 50.000 €", min: 0, max: 50_000 },
  { key: "b2", label: "50.000 – 250.000 €", min: 50_000, max: 250_000 },
  { key: "b3", label: "250.000 € – 1 M€", min: 250_000, max: 1_000_000 },
  { key: "b4", label: "Más de 1 M€", min: 1_000_000, max: Infinity },
  { key: "b0", label: "Sin importe publicado", min: -1, max: -1 },
] as const;

export function budgetBucket(o: Opportunity): string {
  if (o.budget == null || o.budget <= 0) return "b0";
  return BUDGET_BUCKETS.find((b) => o.budget! >= b.min && o.budget! < b.max)?.key ?? "b0";
}

/* ---------- Dates ---------- */

const DAY = 86_400_000;

export function todayUTC(): number {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

export function parseDay(s: string | null): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

export function daysLeft(o: Opportunity): number | null {
  const d = parseDay(o.deadline);
  if (d == null) return o.fit.daysRemaining;
  return Math.round((d - todayUTC()) / DAY);
}

export function isClosed(o: Opportunity): boolean {
  const d = daysLeft(o);
  if (d != null) return d < 0;
  return o.fit.deadlineState === "cerrada";
}

/** Closed competitive grant open to non-profits: likely to come back, so it is a lead for the next edition (mirrors scoring.ts). */
export function isNextEdition(o: Opportunity): boolean {
  return isClosed(o) && o.kind === "subvencion" && o.fit.isCompetitive && o.fit.isOngEligible !== false;
}

export function isOpenNow(o: Opportunity): boolean {
  if (isClosed(o)) return false;
  const open = parseDay(o.opensAt);
  if (open != null && open > todayUTC()) return false;
  if (o.fit.deadlineState === "proxima") return false;
  return daysLeft(o) != null || o.fit.deadlineState === "abierta";
}

export function mondayOf(t: number): number {
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return t - dow * DAY;
}

export function weekStarts(n: number): number[] {
  const start = mondayOf(todayUTC());
  return Array.from({ length: n }, (_, i) => start + i * 7 * DAY);
}

export const WEEK_MS = 7 * DAY;

const fmtShort = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtLong = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function fmtDayShort(t: number): string {
  return fmtShort.format(t).replace(".", "");
}

export function fmtDate(s: string | null): string | null {
  const t = parseDay(s);
  return t == null ? null : fmtLong.format(t);
}

export function fmtEuros(n: number | null): string | null {
  if (n == null || n <= 0) return null;
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} M€`;
  }
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

export function fmtAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

/** "Datos de hoy, 9:02" / "Datos de ayer, 9:02" / "Datos del 12 nov" (local time). */
export function fmtFreshness(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  );
  const time = d.toLocaleTimeString("es-ES", { hour: "numeric", minute: "2-digit" });
  if (days <= 0) return `Datos de hoy, ${time}`;
  if (days === 1) return `Datos de ayer, ${time}`;
  return `Datos del ${d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "")}`;
}

/* ---------- Filters ---------- */

export type Dim = "source" | "organismo" | "region" | "workLine" | "kind" | "tier" | "budget" | "triage" | "plazo";

export interface Filters {
  q: string;
  hideClosed: boolean;
  week: number | null;
  dims: Record<Dim, string[]>;
}

export const EMPTY_DIMS: Record<Dim, string[]> = {
  plazo: [],
  source: [],
  organismo: [],
  region: [],
  workLine: [],
  kind: [],
  tier: [],
  budget: [],
  triage: [],
};

export const DEFAULT_FILTERS: Filters = { q: "", hideClosed: true, week: null, dims: EMPTY_DIMS };

export function dimValues(o: Opportunity, dim: Dim, triage: Triage): string[] {
  switch (dim) {
    case "source":
      return [o.sourceLabel];
    case "organismo":
      return [o.organismo.trim().replace(/\s+/g, " ")];
    case "region":
      return [o.region || "Sin territorio"];
    case "workLine":
      return o.fit.workLines.length ? o.fit.workLines : [NO_LINE];
    case "kind":
      return [o.kind];
    case "tier":
      return [o.fit.tier];
    case "budget":
      return [budgetBucket(o)];
    case "triage":
      return [triage];
    case "plazo":
      return plazoValues(o);
  }
}

export const PLAZO_KEYS = ["abierta", "30d", "proxima", "sin_fecha", "cerrada", "edicion"] as const;
export const PLAZO_LABELS: Record<string, string> = {
  abierta: "Abiertas ahora",
  "30d": "Cierran en 30 días o menos",
  proxima: "Abren pronto",
  sin_fecha: "Sin fecha fija",
  cerrada: "Cerradas",
  edicion: "Próximas ediciones",
};

export function plazoValues(o: Opportunity): string[] {
  if (isClosed(o)) return isNextEdition(o) ? ["cerrada", "edicion"] : ["cerrada"];
  const d = daysLeft(o);
  const v: string[] = [];
  const open = isOpenNow(o);
  if (open) v.push("abierta");
  else v.push("proxima");
  if (d != null && d >= 0 && d <= 30) v.push("30d");
  if (d == null) v.push("sin_fecha");
  return v;
}

export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export type Skip = Dim | "week" | null;

export function matches(
  o: Opportunity,
  f: Filters,
  triage: Triage,
  haystack: string,
  skip: Skip = null,
): boolean {
  if (f.hideClosed && skip !== "plazo" && !f.dims.plazo.some((k) => k === "cerrada" || k === "edicion") && isClosed(o)) return false;
  if (f.week != null && skip !== "week") {
    const d = parseDay(o.deadline);
    if (d == null || d < f.week || d >= f.week + WEEK_MS) return false;
  }
  for (const dim of Object.keys(f.dims) as Dim[]) {
    if (dim === skip) continue;
    const sel = f.dims[dim];
    if (sel.length === 0) continue;
    const vals = dimValues(o, dim, triage);
    if (!vals.some((v) => sel.includes(v))) return false;
  }
  if (f.q.trim()) {
    const terms = normalize(f.q).split(/\s+/).filter(Boolean);
    if (!terms.every((t) => haystack.includes(t))) return false;
  }
  return true;
}

export function haystackOf(o: Opportunity): string {
  return normalize([o.titulo, o.organismo, o.summary ?? "", o.sourceLabel, o.region, o.tipo ?? ""].join(" "));
}

export type SortKey = "fit" | "deadline" | "budget" | "recent";

export const SORT_LABELS: Record<SortKey, string> = {
  fit: "Mejor encaje",
  deadline: "Cierre más próximo",
  budget: "Mayor importe",
  recent: "Más recientes",
};

export function sortItems(items: Opportunity[], key: SortKey): Opportunity[] {
  const dl = (o: Opportunity) => {
    const d = daysLeft(o);
    return d == null || d < 0 ? Infinity : d;
  };
  const arr = [...items];
  switch (key) {
    case "fit":
      return arr.sort((a, b) => b.fit.score - a.fit.score || dl(a) - dl(b));
    case "deadline":
      return arr.sort((a, b) => dl(a) - dl(b) || b.fit.score - a.fit.score);
    case "budget":
      return arr.sort((a, b) => (b.budget ?? -1) - (a.budget ?? -1));
    case "recent":
      return arr.sort((a, b) => (parseDay(b.publishedAt) ?? 0) - (parseDay(a.publishedAt) ?? 0));
  }
}

/** Tame ALL-CAPS official titles/organisms into sentence case for reading. */
export function tidy(s: string): string {
  const letters = s.replace(/[^A-Za-zÁÉÍÓÚÑÜÀÈÒÇ]/g, "");
  if (letters.length < 6) return s;
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÑÜÀÈÒÇ]/g, "").length;
  if (upper / letters.length < 0.7) return s;
  const low = s.toLowerCase();
  return low.replace(/(^|[.·]\s*)(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase());
}

/* ---------- Plazo view: the segmented control above the table ---------- */

export type PlazoView = "ahora" | "ediciones" | "todas";

export const PLAZO_VIEW_LABELS: Record<PlazoView, string> = {
  ahora: "Para pedir ahora",
  ediciones: "Próximas ediciones",
  todas: "Todas",
};

export function plazoViewOf(f: Filters): PlazoView {
  if (f.dims.plazo.includes("edicion")) return "ediciones";
  return f.hideClosed && !f.dims.plazo.includes("cerrada") ? "ahora" : "todas";
}

export function withPlazoView(f: Filters, v: PlazoView): Filters {
  const rest = f.dims.plazo.filter((k) => k !== "cerrada" && k !== "edicion");
  const plazo = v === "ediciones" ? ["edicion"] : v === "todas" ? [] : rest;
  return { ...f, hideClosed: v === "ahora", dims: { ...f.dims, plazo } };
}

/** Open or opening soon, with a known closing date ("Sin fecha fija" calls are often old and already closed). */
function isDatedOpen(o: Opportunity): boolean {
  return !isClosed(o) && daysLeft(o) != null;
}

/** No dated open call fits well, but some next editions do. Judged on every call, never on the current filters. */
export function noOpenHighFit(items: Opportunity[]): boolean {
  const alto = items.filter((o) => o.fit.tier === "alto");
  return !alto.some(isDatedOpen) && alto.some(isNextEdition);
}

/* ---------- Filters <-> URL query (shareable links) ---------- */

const URL_DIMS: Dim[] = ["plazo", "kind", "source", "organismo", "region", "workLine", "tier", "budget", "triage"];

/** `vista=ahora` pins "Para pedir ahora" when the home would otherwise open on "Próximas ediciones". */
export function urlPinsAhora(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("vista") === "ahora";
}

export function filtersToQuery(f: Filters, pinAhora = false): string {
  const p = new URLSearchParams();
  if (pinAhora) p.set("vista", "ahora");
  if (f.q.trim()) p.set("q", f.q.trim());
  for (const d of URL_DIMS) if (f.dims[d].length) p.set(d, f.dims[d].join("|"));
  if (!f.hideClosed) p.set("cerradas", "1");
  if (f.week != null) p.set("semana", new Date(f.week).toISOString().slice(0, 10));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function filtersFromUrl(): Filters | null {
  if (typeof window === "undefined" || window.location.pathname !== "/" || !window.location.search) return null;
  const p = new URLSearchParams(window.location.search);
  const dims = { ...EMPTY_DIMS };
  for (const d of URL_DIMS) {
    const v = p.get(d);
    if (v) dims[d] = v.split("|").filter(Boolean);
  }
  return {
    q: p.get("q") ?? "",
    hideClosed: p.get("cerradas") !== "1",
    week: parseDay(p.get("semana")),
    dims,
  };
}
