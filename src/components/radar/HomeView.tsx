"use client";

import { AlarmClock, ArrowRight, Check, ChevronDown, DoorOpen, Loader2, Repeat, Target, TriangleAlert, UsersRound, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { PersonRef } from "@/lib/team";
import Link from "next/link";
import { isNeutral } from "./profile";
import type { Opportunity, OpportunityKind } from "@/lib/opportunity";
import {
  BUDGET_BUCKETS,
  DEFAULT_FILTERS,
  dimValues,
  EMPTY_DIMS,
  sameOrgs,
  fmtAgo,
  fmtDayShort,
  haystackOf,
  isClosed,
  isNextEdition,
  isOpenNow,
  KIND_LABELS,
  matches,
  NO_LINE,
  noOpenHighFit,
  parseDay,
  PLAZO_KEYS,
  PLAZO_LABELS,
  PLAZO_VIEW_LABELS,
  plazoViewOf,
  tidy,
  TIER_LABELS,
  TRIAGE_LABELS,
  TRIAGE_ORDER,
  WEEK_MS,
  weekStarts,
  withPlazoView,
  workLineLabel,
  type Dim,
  type PlazoView,
  type Skip,
  type Triage,
} from "./model";
import { savedBy, useRadar } from "./store";
import { BarList, WeekBars, type BarRow, type WeekBin } from "./charts";
import { TerritoryPanel } from "./SpainMap";
import { FilterBar, weekChipLabel, type BarDim } from "./filters";
import { ResultsTable } from "./ResultsTable";
import { ErrorState, PageHeader } from "./ui";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const WORK_LINE_KEYS = ["restauracion", "conservacion", "educacion", "agroambiental", NO_LINE];
const KIND_KEYS: OpportunityKind[] = ["subvencion", "europa", "boletin", "licitacion", "empresa"];

const SHORT_VIEW_LABELS: Record<PlazoView, string> = { ahora: "Pedir ahora", ediciones: "Ediciones", todas: "Todas" };

const DIM_TITLES: Record<Dim, string> = {
  plazo: "Plazo",
  source: "Fuente",
  organismo: "Organismo",
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
    case "organismo":
      return tidy(key);
    default:
      return key;
  }
}

export function HomeView() {
  const { data, loading, error, reload } = useRadar();
  if (loading && !data) return <LoadingHome />;
  if (error && !data) return <ErrorState message={error} onRetry={() => reload()} />;
  if (!data) return null;
  // First run: the sources are still being read (the store polls until the ingest finishes).
  if (data.ingest?.running && (data.items.length === 0 || !data.lastIngestAt)) return <LoadingHome firstRun />;
  return (
    <>
      {data.ingestStale && data.lastIngestAt && <IngestStaleAlert lastIngestAt={data.lastIngestAt} />}
      <Dashboard items={data.items} fetchedAt={data.fetchedAt} sourceCount={data.sources.length} />
    </>
  );
}

function IngestStaleAlert({ lastIngestAt }: { lastIngestAt: string }) {
  const [now] = useState(Date.now);
  const h = Math.floor((now - Date.parse(lastIngestAt)) / 3_600_000);
  return (
    <Alert role="status" className="mb-6">
      <TriangleAlert />
      <AlertDescription>
        Los datos son de hace {h >= 48 ? `${Math.floor(h / 24)} días` : `${h} h`}: la carga diaria no ha terminado bien
        desde entonces. Avisad a quien mantiene el radar.
      </AlertDescription>
    </Alert>
  );
}

function Dashboard({ items, fetchedAt, sourceCount }: { items: Opportunity[]; fetchedAt: string; sourceCount: number }) {
  const { filters, setFilters, markPush, triageOf, refreshing, error, offline, profile, teamOrgs, settings } = useRadar();
  const teamOrgsOn = teamOrgs.length > 0 && sameOrgs(filters.dims.organismo, teamOrgs);
  const orgsSaved = savedBy(settings, "organisms");
  const [more, setMore] = useState(false);
  const hay = useMemo(() => new Map(items.map((o) => [o.id, haystackOf(o)])), [items]);

  // Same rule the store uses to open on "Próximas ediciones": the whole radar, not the filtered list.
  // (The store keeps the filters, the page and the open call in the URL.)
  const quiet = useMemo(() => noOpenHighFit(items), [items]);

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
  const clearAll = () => setFilters((f) => ({ ...DEFAULT_FILTERS, hideClosed: f.hideClosed, dims: EMPTY_DIMS }));

  const rows = {
    plazo: agg("plazo", PLAZO_KEYS),
    tier: agg("tier", ["alto", "medio", "bajo"]),
    kind: agg("kind", KIND_KEYS),
    source: sortByCount(agg("source")),
    // Selected organisms stay listed (count 0) even when none of their calls match the other filters.
    organismo: sortByCount(agg("organismo", filters.dims.organismo)),
    region: sortByCount(agg("region")),
    workLine: agg("workLine", WORK_LINE_KEYS),
    budget: agg("budget", BUDGET_BUCKETS.map((b) => b.key)),
    triage: agg("triage", TRIAGE_ORDER),
  };
  const countOf = (r: BarRow[], k: string) => r.find((x) => x.key === k)?.count ?? 0;
  const openByRegion = new Map<string, number>();
  for (const o of subset("region")) if (isOpenNow(o)) for (const v of dimValues(o, "region", triageOf(o.id))) openByRegion.set(v, (openByRegion.get(v) ?? 0) + 1);

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
    {
      dim: "organismo",
      label: "Organismo",
      options: rows.organismo,
      wide: true,
      note: (
        <>
          <span className="block font-medium text-foreground">Este filtro se guarda para todo el equipo</span>
          {orgsSaved && <span className="block">{savedLine(orgsSaved)}</span>}
        </>
      ),
    },
    { dim: "region", label: "Territorio", options: rows.region },
    { dim: "workLine", label: "Línea de trabajo", options: rows.workLine },
    { dim: "plazo", label: "Plazo", options: rows.plazo },
    { dim: "tier", label: "Encaje", options: rows.tier },
  ];
  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (filters.q.trim()) chips.push({ key: "q", label: `Texto: “${filters.q.trim()}”`, remove: () => setFilters((f) => ({ ...f, q: "" })) });
  if (filters.week != null)
    chips.push({ key: "week", label: weekChipLabel(filters.week), remove: () => setFilters((f) => ({ ...f, week: null })) });
  for (const dim of Object.keys(filters.dims) as Dim[])
    for (const k of filters.dims[dim]) chips.push({ key: `${dim}:${k}`, label: `${DIM_TITLES[dim]}: ${dimLabel(dim, k)}`, remove: () => toggleDim(dim, k) });

  // Plazo view (segmented control above the table): counts ignore the current plazo choice.
  const anyPlazo = subset("plazo");
  const view = plazoViewOf(filters);
  const viewCounts: Record<PlazoView, number> = {
    ahora: anyPlazo.filter((o) => !isClosed(o)).length,
    ediciones: anyPlazo.filter(isNextEdition).length,
    todas: anyPlazo.length,
  };
  const setView = (v: PlazoView) => {
    markPush();
    setFilters((f) => withPlazoView(f, v));
  };
  // A tile shows exactly its own filter on "Para pedir ahora", so the list then has the tile's number of rows.
  const togglePlazoTile = (k: "abierta" | "30d") => {
    markPush();
    setFilters((f) =>
      f.dims.plazo.includes(k) && plazoViewOf(f) === "ahora"
        ? { ...f, dims: { ...f.dims, plazo: f.dims.plazo.filter((x) => x !== k) } }
        : { ...withPlazoView(f, "ahora"), dims: { ...f.dims, plazo: [k] } },
    );
  };
  // High fit across every deadline state: today the strongest matches may all be closed recurring grants.
  const allPlazo = withPlazoView(filters, "todas");
  const altoAll = items.filter((o) => o.fit.tier === "alto" && matches(o, allPlazo, triageOf(o.id), hay.get(o.id)!, "tier"));
  const altoOpen = altoAll.filter((o) => !isClosed(o)).length;
  const altoNext = altoAll.filter(isNextEdition).length;
  const toggleAlto = () => {
    markPush();
    setFilters((f) =>
      f.dims.tier.includes("alto")
        ? withPlazoView({ ...f, dims: { ...f.dims, tier: f.dims.tier.filter((k) => k !== "alto") } }, "ahora")
        : withPlazoView({ ...f, dims: { ...f.dims, tier: ["alto"] } }, "todas"),
    );
  };

  const stats = [
    { label: PLAZO_LABELS.abierta, icon: DoorOpen, value: countOf(rows.plazo, "abierta"), caption: "Se pueden pedir hoy", on: view === "ahora" && filters.dims.plazo.includes("abierta"), toggle: () => togglePlazoTile("abierta") },
    { label: PLAZO_LABELS["30d"], icon: AlarmClock, value: countOf(rows.plazo, "30d"), caption: "Hay que decidir pronto", on: view === "ahora" && filters.dims.plazo.includes("30d"), toggle: () => togglePlazoTile("30d") },
    { label: "Encaje alto", icon: Target, value: altoAll.length, caption: altoOpen ? "Se parecen a lo que hacéis" : "Ninguna abierta hoy · ver próximas ediciones", on: filters.dims.tier.includes("alto"), toggle: toggleAlto },
    { label: "Próximas ediciones", icon: Repeat, value: viewCounts.ediciones, caption: "Cerradas que suelen volver", on: view === "ediciones", toggle: () => setView(view === "ediciones" ? "ahora" : "ediciones") },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Convocatorias"
        sub={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {items.length} oportunidades de {sourceCount} fuentes · datos de {fmtAgo(fetchedAt)}
            </span>
            {!isNeutral(profile) && <Link href="/perfil" className="inline-flex h-5 items-center rounded-full border px-2 text-xs text-foreground hover:bg-accent">Perfil ajustado</Link>}
            {error && !refreshing && !offline && <span className="text-xs text-amber-800">No se pudo actualizar; mostrando la última copia.</span>}
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <button
            key={s.label}
            type="button"
            aria-pressed={s.on}
            data-tile={s.label}
            onClick={s.toggle}
            className={cn(
              "flex cursor-pointer flex-col gap-2 rounded-lg border bg-card p-4 text-left transition-colors outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:p-5",
              s.on && "border-primary ring-1 ring-primary",
            )}
          >
            <span className="flex items-start justify-between gap-2 text-xs text-muted-foreground sm:text-sm">
              {/* Two lines kept for every tile where some label wraps, so the numbers line up. */}
              <span className="min-h-[2lh] xl:min-h-0">{s.label}</span>
              {s.on ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : <s.icon className="size-4 shrink-0 max-sm:hidden" aria-hidden />}
            </span>
            <span className="text-3xl font-semibold tracking-tight tabular-nums">{s.value}</span>
            <span className="text-xs text-muted-foreground">{s.on ? "Filtro activo · pulsa para quitarlo" : s.caption}</span>
          </button>
        ))}
      </div>

      <Card className="gap-0 py-0" aria-label="Resumen gráfico">
        {/* On "Próximas ediciones" every call has closed already: a chart of closing dates would say nothing true. */}
        <div className={cn("grid divide-y lg:divide-x lg:divide-y-0", view === "ediciones" ? "lg:grid-cols-[1fr_1.5fr]" : "lg:grid-cols-[1.6fr_1fr_1.5fr]")}>
          {view !== "ediciones" && <WeekBars bins={bins} later={later} selected={filters.week} onSelect={(w) => setFilters((f) => ({ ...f, week: w }))} />}
          <BarList title="Línea de trabajo" rows={rows.workLine} selected={filters.dims.workLine} onToggle={(k) => toggleDim("workLine", k)} total={total} maxRows={4} />
          <TerritoryPanel rows={rows.region} open={openByRegion} selected={filters.dims.region} onToggle={(k) => toggleDim("region", k)} total={total} />
        </div>
        <Collapsible open={more} onOpenChange={setMore}>
          <CollapsibleContent>
            <div className="grid divide-y border-t md:grid-cols-2 md:divide-y-0 lg:grid-cols-4 lg:divide-x">
              <BarList title="Fuente" rows={rows.source} selected={filters.dims.source} onToggle={(k) => toggleDim("source", k)} total={total} maxRows={4} />
              <BarList title="Tipo" rows={rows.kind} sort={false} selected={filters.dims.kind} onToggle={(k) => toggleDim("kind", k)} total={total} maxRows={5} />
              <BarList title="Importe total" rows={rows.budget} sort={false} selected={filters.dims.budget} onToggle={(k) => toggleDim("budget", k)} total={total} maxRows={5} />
              <BarList title="Vuestro seguimiento" rows={rows.triage} sort={false} selected={filters.dims.triage} onToggle={(k) => toggleDim("triage", k)} total={total} maxRows={5} />
            </div>
          </CollapsibleContent>
          <div className="border-t px-3 py-2">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                <ChevronDown className={cn("transition-transform", more && "rotate-180")} aria-hidden />
                {more ? "Menos gráficos" : "Más gráficos"}
              </Button>
            </CollapsibleTrigger>
          </div>
        </Collapsible>
      </Card>

      <section aria-label="Convocatorias" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as PlazoView)} className="max-w-full overflow-x-auto">
            <TabsList aria-label="Plazo">
              {(Object.keys(PLAZO_VIEW_LABELS) as PlazoView[]).map((v) => (
                <TabsTrigger key={v} value={v} className="px-2 sm:px-3" aria-controls="lista-convocatorias">
                  <span className="max-sm:hidden">{PLAZO_VIEW_LABELS[v]}</span>
                  <span className="sm:hidden">{SHORT_VIEW_LABELS[v]}</span>
                  <span className="text-muted-foreground tabular-nums">{viewCounts[v]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {quiet && view !== "todas" ? (
            <QuietNotice view={view} onSwitch={() => setView(view === "ahora" ? "ediciones" : "ahora")} />
          ) : view === "ahora" && altoOpen === 0 && altoNext > 0 && (
            <p className="text-sm text-muted-foreground">
              Hoy no hay convocatorias abiertas de encaje alto.{" "}
              <button
                type="button"
                onClick={() => setFilters((f) => withPlazoView({ ...f, dims: { ...f.dims, tier: ["alto"] } }, "ediciones"))}
                className="cursor-pointer font-medium text-primary underline-offset-4 hover:underline"
              >
                Mira las próximas ediciones ({altoNext})
              </button>{" "}
              para prepararlas con tiempo.
            </p>
          )}
        </div>
        {teamOrgsOn && <TeamOrgsNotice count={teamOrgs.length} saved={orgsSaved} onClear={() => setFilters((f) => ({ ...f, dims: { ...f.dims, organismo: [] } }))} />}
        <FilterBar dims={barDims} chips={chips} total={total} />
        <div id="lista-convocatorias" className={cn("transition-opacity", refreshing && "opacity-90")}>
          <ResultsTable items={visible} onClear={clearAll} />
        </div>
      </section>
    </div>
  );
}

/** "Guardado por Ana el 15 de noviembre, a las 9:02." */
function savedLine({ by, at }: { by: PersonRef | null; at: string }): string {
  const d = new Date(at);
  const day = d.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
  const time = d.toLocaleTimeString("es-ES", { hour: "numeric", minute: "2-digit" });
  return `Guardado por ${by?.name || "alguien del equipo"} el ${day}, a las ${time}.`;
}

/** The team's saved organism filter is on: say so on Inicio, with a one-click way out (for everyone). */
function TeamOrgsNotice({ count, saved, onClear }: { count: number; saved: { by: PersonRef | null; at: string } | null; onClear: () => void }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      <UsersRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        Filtro del equipo: solo {count === 1 ? "1 organismo" : `${count} organismos`}. Lo ve así todo el equipo.
        {saved && <span className="text-muted-foreground"> {savedLine(saved)}</span>}
      </span>
      <Button variant="ghost" size="sm" className="h-8" onClick={onClear} aria-label="Quitar el filtro de organismos para todo el equipo">
        <X aria-hidden /> Quitar
      </Button>
    </div>
  );
}

/** Shown while no open call fits well: explains why the home opens on the next editions and links both tabs. */
function QuietNotice({ view, onSwitch }: { view: "ahora" | "ediciones"; onSwitch: () => void }) {
  // The pseudo-element makes the tap area taller than the line of text without changing the look.
  const link = "relative inline-flex cursor-pointer items-center gap-1 font-medium text-primary underline-offset-4 after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] hover:underline";
  if (view === "ediciones")
    return (
      <Alert role="status">
        <Repeat aria-hidden />
        <AlertDescription>
          <p>
            Ahora mismo no hay convocatorias abiertas con encaje alto. Te enseñamos las que mejor encajan y suelen repetirse
            cada año, para prepararlas con tiempo.
          </p>
          <button type="button" onClick={onSwitch} className={link}>
            Ver las abiertas
          </button>
        </AlertDescription>
      </Alert>
    );
  return (
    <Alert role="status">
      <Target aria-hidden />
      <AlertDescription>
        <p>Ahora mismo ninguna convocatoria abierta con fecha de cierre tiene encaje alto.</p>
        <button type="button" onClick={onSwitch} className={link}>
          Las mejores están en Próximas ediciones
          <ArrowRight className="size-3.5" aria-hidden />
        </button>
      </AlertDescription>
    </Alert>
  );
}

/* ---------- Loading (first visit only; later visits paint the saved copy instantly) ---------- */

function LoadingHome({ firstRun = false }: { firstRun?: boolean }) {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <PageHeader title="Convocatorias" />
      <div className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm" role="status">
        <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
        <span>
          {firstRun
            ? "Primera carga en marcha: estamos leyendo las fuentes oficiales. Suele tardar unos 2 minutos. La lista aparecerá aquí sola."
            : "Cargando las convocatorias…"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-4 rounded-lg border p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-14" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border p-5">
        <Skeleton className="h-3 w-32" />
        <div className="mt-6 flex h-[120px] items-end gap-2 lg:w-[55%]">
          {[40, 70, 30, 90, 55, 20, 65, 45, 80, 35, 50, 25].map((h, i) => (
            <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
      <div className="space-y-4 rounded-lg border p-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
