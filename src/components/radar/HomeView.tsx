"use client";

import { AlarmClock, ChartNoAxesColumn, Compass, DoorOpen, Loader2, Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Opportunity, OpportunityKind } from "@/lib/opportunity";
import {
  BUDGET_BUCKETS,
  DEFAULT_FILTERS,
  dimValues,
  EMPTY_DIMS,
  filtersToQuery,
  fmtAgo,
  fmtDayShort,
  haystackOf,
  KIND_LABELS,
  matches,
  NO_LINE,
  parseDay,
  PLAZO_KEYS,
  PLAZO_LABELS,
  tidy,
  TIER_LABELS,
  TRIAGE_LABELS,
  TRIAGE_ORDER,
  WEEK_MS,
  weekStarts,
  workLineLabel,
  type Dim,
  type Skip,
  type Triage,
} from "./model";
import { useRadar } from "./store";
import { BarList, StatTile, WeekBars, type BarRow, type WeekBin } from "./charts";
import { FilterBar, weekChipLabel, type BarDim } from "./filters";
import { ResultsTable } from "./ResultsTable";
import { cx, ErrorState, PageHeader } from "./ui";

const WORK_LINE_KEYS = ["restauracion", "conservacion", "educacion", "agroambiental", NO_LINE];
const KIND_KEYS: OpportunityKind[] = ["subvencion", "europa", "boletin", "licitacion", "empresa"];

const DIM_TITLES: Record<Dim, string> = {
  plazo: "Plazo",
  source: "Fuente",
  region: "Territorio",
  workLine: "Línea",
  kind: "Tipo",
  tier: "Encaje",
  budget: "Importe",
  triage: "Seguimiento",
};

function dimLabel(dim: Dim, key: string): string {
  switch (dim) {
    case "workLine":
      return workLineLabel(key);
    case "kind":
      return KIND_LABELS[key as OpportunityKind] ?? key;
    case "tier":
      return TIER_LABELS[key as "alto"] ?? key;
    case "budget":
      return BUDGET_BUCKETS.find((b) => b.key === key)?.label ?? key;
    case "triage":
      return TRIAGE_LABELS[key as Triage] ?? key;
    case "plazo":
      return PLAZO_LABELS[key] ?? key;
    default:
      return key;
  }
}

export function HomeView() {
  const { data, loading, error, reload } = useRadar();
  if (loading && !data) return <LoadingHome />;
  if (error && !data) return <ErrorState message={error} onRetry={() => reload()} />;
  if (!data) return null;
  return <Dashboard items={data.items} fetchedAt={data.fetchedAt} sourceCount={data.sources.length} />;
}

function Dashboard({ items, fetchedAt, sourceCount }: { items: Opportunity[]; fetchedAt: string; sourceCount: number }) {
  const { filters, setFilters, triageOf, refreshing, error } = useRadar();
  const [more, setMore] = useState(false);
  const hay = useMemo(() => new Map(items.map((o) => [o.id, haystackOf(o)])), [items]);

  // Keep the filters in the URL so links can be shared.
  useEffect(() => {
    const q = filtersToQuery(filters);
    if (window.location.pathname === "/" && window.location.search !== q) window.history.replaceState(null, "", `/${q}`);
  }, [filters]);

  const subset = useMemo(
    () => (skip: Skip) => items.filter((o) => matches(o, filters, triageOf(o.id), hay.get(o.id)!, skip)),
    [items, filters, triageOf, hay],
  );
  const visible = useMemo(() => subset(null), [subset]);
  const total = visible.length;

  const agg = (dim: Dim, keys?: readonly string[]): BarRow[] => {
    const counts = new Map<string, number>();
    keys?.forEach((k) => counts.set(k, 0));
    for (const o of subset(dim)) for (const v of dimValues(o, dim, triageOf(o.id))) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()].map(([key, count]) => ({ key, label: dimLabel(dim, key), count }));
  };
  const sortByCount = (r: BarRow[]) => [...r].sort((a, b) => b.count - a.count);

  const toggleDim = (dim: Dim, key: string) =>
    setFilters((f) => {
      const cur = f.dims[dim];
      return { ...f, dims: { ...f.dims, [dim]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] } };
    });
  const toggleFuera = () =>
    setFilters((f) => ({ ...f, flags: f.flags.includes("fuera") ? f.flags.filter((x) => x !== "fuera") : [...f.flags, "fuera"] }));
  const clearAll = () => setFilters((f) => ({ ...DEFAULT_FILTERS, hideClosed: f.hideClosed, dims: EMPTY_DIMS }));

  const rows = {
    plazo: agg("plazo", PLAZO_KEYS),
    tier: agg("tier", ["alto", "medio", "bajo"]),
    kind: agg("kind", KIND_KEYS),
    source: sortByCount(agg("source")),
    region: sortByCount(agg("region")),
    workLine: agg("workLine", WORK_LINE_KEYS),
    budget: agg("budget", BUDGET_BUCKETS.map((b) => b.key)),
    triage: agg("triage", TRIAGE_ORDER),
  };
  const countOf = (r: BarRow[], k: string) => r.find((x) => x.key === k)?.count ?? 0;
  const fueraCount = subset("fuera").filter((o) => o.fit.outsideManualSources).length;

  // Weekly deadline bins
  const weeks = weekStarts(12);
  const weekSubset = subset("week");
  const bins: WeekBin[] = weeks.map((start) => {
    const inWeek = weekSubset.filter((o) => {
      const d = parseDay(o.deadline);
      return d != null && d >= start && d < start + WEEK_MS;
    });
    return {
      start,
      label: fmtDayShort(start),
      range: `${fmtDayShort(start)} al ${fmtDayShort(start + WEEK_MS - 86_400_000)}`,
      count: inWeek.length,
      top: [...inWeek].sort((a, b) => b.fit.score - a.fit.score).slice(0, 3).map((o) => tidy(o.titulo)),
    };
  });
  const later = weekSubset.filter((o) => (parseDay(o.deadline) ?? 0) >= weeks[0] + 12 * WEEK_MS).length;

  // Filter bar
  const barDims: BarDim[] = [
    { dim: "kind", label: "Tipo", options: rows.kind },
    { dim: "source", label: "Fuente", options: rows.source },
    { dim: "region", label: "Territorio", options: rows.region },
    { dim: "workLine", label: "Línea de trabajo", options: rows.workLine },
    { dim: "plazo", label: "Plazo", options: rows.plazo },
    { dim: "tier", label: "Encaje", options: rows.tier },
  ];
  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (filters.q.trim()) chips.push({ key: "q", label: `Texto: “${filters.q.trim()}”`, remove: () => setFilters((f) => ({ ...f, q: "" })) });
  if (filters.flags.includes("fuera")) chips.push({ key: "fuera", label: "Fuera de tus 4 fuentes", remove: toggleFuera });
  if (filters.week != null)
    chips.push({ key: "week", label: weekChipLabel(filters.week), remove: () => setFilters((f) => ({ ...f, week: null })) });
  for (const dim of Object.keys(filters.dims) as Dim[])
    for (const k of filters.dims[dim]) chips.push({ key: `${dim}:${k}`, label: `${DIM_TITLES[dim]}: ${dimLabel(dim, k)}`, remove: () => toggleDim(dim, k) });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Convocatorias"
        sub={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {items.length} oportunidades de {sourceCount} fuentes · datos de {fmtAgo(fetchedAt)}
            </span>
            {refreshing && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs text-stone-600 ring-1 ring-stone-200" role="status">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Actualizando…
              </span>
            )}
            {error && !refreshing && <span className="text-xs text-amber-800">No se pudo actualizar; mostrando la última copia.</span>}
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Abiertas ahora"
          icon={<DoorOpen className="h-4 w-4" aria-hidden />}
          value={countOf(rows.plazo, "abierta")}
          caption="Se pueden pedir hoy"
          on={filters.dims.plazo.includes("abierta")}
          onClick={() => toggleDim("plazo", "abierta")}
        />
        <StatTile
          label="Cierran en ≤ 30 días"
          icon={<AlarmClock className="h-4 w-4" aria-hidden />}
          value={countOf(rows.plazo, "30d")}
          caption="Hay que decidir pronto"
          on={filters.dims.plazo.includes("30d")}
          onClick={() => toggleDim("plazo", "30d")}
        />
        <StatTile
          label="Encaje alto"
          icon={<Target className="h-4 w-4" aria-hidden />}
          value={countOf(rows.tier, "alto")}
          caption="Se parecen a lo que hacéis"
          on={filters.dims.tier.includes("alto")}
          onClick={() => toggleDim("tier", "alto")}
        />
        <StatTile
          label="Fuera de tus 4 fuentes"
          icon={<Compass className="h-4 w-4" aria-hidden />}
          value={fueraCount}
          caption="Lo que hoy no estáis viendo"
          on={filters.flags.includes("fuera")}
          onClick={toggleFuera}
        />
      </div>

      <section aria-label="Resumen gráfico" className="rounded-2xl border border-stone-200/80 bg-white">
        <div className="grid divide-y divide-stone-100 lg:grid-cols-[1.7fr_1fr_1fr] lg:divide-x lg:divide-y-0">
          <WeekBars bins={bins} later={later} selected={filters.week} onSelect={(w) => setFilters((f) => ({ ...f, week: w }))} />
          <BarList title="Línea de trabajo" rows={rows.workLine} selected={filters.dims.workLine} onToggle={(k) => toggleDim("workLine", k)} total={total} maxRows={4} />
          <BarList title="Territorio" rows={rows.region} selected={filters.dims.region} onToggle={(k) => toggleDim("region", k)} total={total} maxRows={4} />
        </div>
        {more && (
          <div className="grid divide-y divide-stone-100 border-t border-stone-100 md:grid-cols-2 md:divide-y-0 lg:grid-cols-4 lg:divide-x">
            <BarList title="Fuente" rows={rows.source} selected={filters.dims.source} onToggle={(k) => toggleDim("source", k)} total={total} maxRows={4} />
            <BarList title="Tipo" rows={rows.kind} sort={false} selected={filters.dims.kind} onToggle={(k) => toggleDim("kind", k)} total={total} maxRows={5} />
            <BarList title="Importe total" rows={rows.budget} sort={false} selected={filters.dims.budget} onToggle={(k) => toggleDim("budget", k)} total={total} maxRows={5} />
            <BarList title="Vuestro seguimiento" rows={rows.triage} sort={false} selected={filters.dims.triage} onToggle={(k) => toggleDim("triage", k)} total={total} maxRows={5} />
          </div>
        )}
        <div className="border-t border-stone-100 px-4 py-2 sm:px-5">
          <button
            type="button"
            aria-expanded={more}
            onClick={() => setMore((v) => !v)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md py-1 text-xs font-medium text-stone-600 hover:text-stone-900"
          >
            <ChartNoAxesColumn className="h-3.5 w-3.5" aria-hidden />
            {more ? "Menos gráficos" : "Más gráficos: fuente, tipo, importe y seguimiento"}
          </button>
        </div>
      </section>

      <div className="flex flex-col">
        <FilterBar dims={barDims} chips={chips} total={total} fueraCount={fueraCount} />
        <div className={cx("mt-4 transition-opacity", refreshing && "opacity-90")}>
          <ResultsTable items={visible} onClear={clearAll} resetKey={JSON.stringify(filters)} />
        </div>
      </div>
    </div>
  );
}

/* ---------- Loading (first visit only; later visits paint the saved copy instantly) ---------- */

const SOURCES_LOADING = [
  "Base de Datos Nacional de Subvenciones",
  "Boletín Oficial del Estado",
  "Boletín de la Comunidad de Madrid",
  "Diario Oficial de Galicia",
  "Fundación Biodiversidad",
  "programa LIFE de la UE",
  "fundaciones y programas de RSC",
];

function LoadingHome() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const src = SOURCES_LOADING[Math.floor(t / 2) % SOURCES_LOADING.length];
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <PageHeader title="Convocatorias" />
      <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900" role="status">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-600" />
        </span>
        <span>
          Consultando <strong className="font-semibold">{src}</strong>…{" "}
          <span className="text-brand-700">La primera carga tarda unos 20–30 segundos ({t} s).</span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[104px] rounded-2xl border border-stone-200/80 bg-white p-4">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton mt-4 h-7 w-14" />
          </div>
        ))}
      </div>
      <div className="h-[230px] rounded-2xl border border-stone-200/80 bg-white p-5">
        <div className="skeleton h-3 w-32" />
        <div className="mt-6 flex h-[140px] items-end gap-2 lg:w-[58%]">
          {[40, 70, 30, 90, 55, 20, 65, 45, 80, 35, 50, 25].map((h, i) => (
            <div key={i} className="skeleton flex-1" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-stone-200/80 bg-white p-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton mb-4 h-10 w-full last:mb-0" />
        ))}
      </div>
    </div>
  );
}
