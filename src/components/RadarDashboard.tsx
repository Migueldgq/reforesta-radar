"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  Compass,
  ExternalLink,
  FileSearch,
  FileText,
  Gavel,
  Globe2,
  Loader2,
  MapPin,
  RefreshCw,
  RotateCcw,
  Search,
  Sprout,
  Trees,
  X,
} from "lucide-react";
import { WORK_LINE_LABELS } from "@/lib/reforesta-profile";
import type {
  ConvocatoriaItem,
  PdfAnalysisResult,
  TriageStatus,
  WorkLine,
} from "@/lib/types";
import {
  DeadlineBadge,
  formatCurrency,
  ScoreBadge,
  TRIAGE_LABELS,
  WorkLinePill,
} from "./BadgeHelpers";
import { BoeTab } from "./BoeTab";
import { MultiSourceTab } from "./MultiSourceTab";
import { PdfAnalyzerTab, PdfResultCard } from "./PdfAnalyzerTab";
import { RscTab } from "./RscTab";

type TabId = "radar" | "boe" | "fuentes" | "pdf" | "rsc";
type DeadlineFilter = "all" | "open" | "closed";

interface RadarApiResponse {
  items: ConvocatoriaItem[];
  stats: {
    total: number;
    highFit: number;
    outsideManual: number;
    openOrUpcoming: number;
  };
  cached: boolean;
  fetchedAt: string;
}

const TRIAGE_STORAGE_KEY = "reforesta-triage-v1";

export function RadarDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>("radar");
  const [items, setItems] = useState<ConvocatoriaItem[]>([]);
  const [stats, setStats] = useState<RadarApiResponse["stats"]>({
    total: 0,
    highFit: 0,
    outsideManual: 0,
    openOrUpcoming: 0,
  });
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [ccaaFilter, setCcaaFilter] = useState<string>("all");
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>("all");
  const [lineFilter, setLineFilter] = useState<WorkLine | "all">("all");
  const [outsideOnly, setOutsideOnly] = useState(true);
  const [competitiveOnly, setCompetitiveOnly] = useState(false);
  const [hideDiscarded, setHideDiscarded] = useState(true);

  // Selection & team triage
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [triageMap, setTriageMap] = useState<Record<string, TriageStatus>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = localStorage.getItem(TRIAGE_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Inline PDF analysis modal (for BDNS & BOE PDFs)
  const [pdfModalLoading, setPdfModalLoading] = useState(false);
  const [pdfModalError, setPdfModalError] = useState<string | null>(null);
  const [pdfModalResult, setPdfModalResult] = useState<PdfAnalysisResult | null>(
    null
  );

  const updateTriage = (codigoBDNS: string, status: TriageStatus) => {
    setTriageMap((prev) => {
      const next = { ...prev, [codigoBDNS]: status };
      try {
        localStorage.setItem(TRIAGE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const fetchConvocatorias = useCallback(
    async (opts?: { query?: string; refresh?: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (opts?.query) params.set("q", opts.query);
        if (opts?.refresh) params.set("refresh", "1");
        const res = await fetch(`/api/convocatorias?${params.toString()}`);
        if (!res.ok) throw new Error("No se pudo conectar con la API de BDNS.");
        const data = (await res.json()) as RadarApiResponse;
        setItems(data.items);
        setStats(data.stats);
        setFetchedAt(data.fetchedAt);
        if (data.items.length > 0) {
          setSelectedCode((prev) =>
            data.items.some((i) => i.codigoBDNS === prev)
              ? prev
              : data.items[0].codigoBDNS
          );
        } else {
          setSelectedCode(null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error cargando datos");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/convocatorias");
        if (!res.ok) throw new Error("No se pudo conectar con la API de BDNS.");
        const data = (await res.json()) as RadarApiResponse;
        if (!active) return;
        setItems(data.items);
        setStats(data.stats);
        setFetchedAt(data.fetchedAt);
        setSelectedCode(data.items[0]?.codigoBDNS ?? null);
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : "Error cargando datos");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Build CCAA options dynamically with counts
  const ccaaOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(
        item.comunidadAutonoma,
        (counts.get(item.comunidadAutonoma) ?? 0) + 1
      );
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (outsideOnly && !item.fit.outsideManualSources) return false;
      if (competitiveOnly && !item.fit.isCompetitive) return false;
      if (ccaaFilter !== "all" && item.comunidadAutonoma !== ccaaFilter)
        return false;
      if (
        deadlineFilter === "open" &&
        item.fit.deadlineState !== "abierta" &&
        item.fit.deadlineState !== "proxima"
      ) {
        return false;
      }
      if (deadlineFilter === "closed" && item.fit.deadlineState !== "cerrada") {
        return false;
      }
      if (lineFilter !== "all" && !item.fit.workLines.includes(lineFilter))
        return false;
      const status = triageMap[item.codigoBDNS] || "nueva";
      if (hideDiscarded && status === "descartada") return false;
      return true;
    });
  }, [
    items,
    outsideOnly,
    competitiveOnly,
    ccaaFilter,
    deadlineFilter,
    lineFilter,
    hideDiscarded,
    triageMap,
  ]);

  const selectedItem = useMemo(() => {
    return (
      filteredItems.find((i) => i.codigoBDNS === selectedCode) ??
      filteredItems[0] ??
      null
    );
  }, [filteredItems, selectedCode]);

  const hasCustomFilters =
    ccaaFilter !== "all" ||
    deadlineFilter !== "all" ||
    lineFilter !== "all" ||
    !outsideOnly ||
    competitiveOnly;

  function resetFilters() {
    setCcaaFilter("all");
    setDeadlineFilter("all");
    setLineFilter("all");
    setOutsideOnly(true);
    setCompetitiveOnly(false);
    setHideDiscarded(true);
  }

  async function runModalPdfAnalysis(payload: {
    docId?: number;
    pdfUrl?: string;
    fileName: string;
  }) {
    setPdfModalLoading(true);
    setPdfModalError(null);
    setPdfModalResult(null);
    try {
      const res = await fetch("/api/analyze-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error analizando PDF");
      setPdfModalResult(data as PdfAnalysisResult);
    } catch (e) {
      setPdfModalError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setPdfModalLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F6F5F0]">
      {/* Compact Workspace Top Bar */}
      <header className="bg-[#0F291E] text-white border-b border-emerald-950 sticky top-0 z-30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 min-w-0">
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/15 border border-emerald-300/25 text-emerald-200">
                <Trees className="h-4 w-4" />
              </div>
              <span className="text-sm sm:text-base font-semibold tracking-tight text-white">
                Reforesta Radar
              </span>
            </div>

            <nav
              aria-label="Secciones principales"
              className="hidden md:flex items-center gap-1"
            >
              <NavTab
                active={activeTab === "radar"}
                onClick={() => setActiveTab("radar")}
                icon={<Compass className="h-3.5 w-3.5" />}
                label="Subvenciones BDNS"
              />
              <NavTab
                active={activeTab === "boe"}
                onClick={() => setActiveTab("boe")}
                icon={<Gavel className="h-3.5 w-3.5" />}
                label="Licitaciones & BOE"
              />
              <NavTab
                active={activeTab === "fuentes"}
                onClick={() => setActiveTab("fuentes")}
                icon={<Globe2 className="h-3.5 w-3.5" />}
                label="Boletines & UE"
              />
              <NavTab
                active={activeTab === "pdf"}
                onClick={() => setActiveTab("pdf")}
                icon={<FileSearch className="h-3.5 w-3.5" />}
                label="Analizar PDF"
              />
              <NavTab
                active={activeTab === "rsc"}
                onClick={() => setActiveTab("rsc")}
                icon={<Building2 className="h-3.5 w-3.5" />}
                label="Empresas & RSC"
              />
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {fetchedAt && (
              <span className="hidden lg:inline text-xs text-emerald-100/70 tabular-nums">
                Sincronizado{" "}
                {new Date(fetchedAt).toLocaleTimeString("es-ES", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
            <button
              type="button"
              onClick={() =>
                fetchConvocatorias({ query: searchInput, refresh: true })
              }
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 border border-white/15 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
              Actualizar
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        <div className="md:hidden border-t border-white/10 px-4 py-2 flex gap-1.5 overflow-x-auto">
          <NavTab
            active={activeTab === "radar"}
            onClick={() => setActiveTab("radar")}
            icon={<Compass className="h-3.5 w-3.5" />}
            label="BDNS"
          />
          <NavTab
            active={activeTab === "boe"}
            onClick={() => setActiveTab("boe")}
            icon={<Gavel className="h-3.5 w-3.5" />}
            label="BOE"
          />
          <NavTab
            active={activeTab === "fuentes"}
            onClick={() => setActiveTab("fuentes")}
            icon={<Globe2 className="h-3.5 w-3.5" />}
            label="Boletines/UE"
          />
          <NavTab
            active={activeTab === "pdf"}
            onClick={() => setActiveTab("pdf")}
            icon={<FileSearch className="h-3.5 w-3.5" />}
            label="PDF"
          />
          <NavTab
            active={activeTab === "rsc"}
            onClick={() => setActiveTab("rsc")}
            icon={<Building2 className="h-3.5 w-3.5" />}
            label="RSC"
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 py-5 space-y-4">
        {/* Tab 1: Radar BDNS */}
        {activeTab === "radar" && (
          <div className="space-y-4">
            {/* Intuitive Filter Toolbar */}
            <section
              aria-label="Filtros de convocatorias"
              className="rounded-xl border border-[#E6E4DD] bg-white p-4 shadow-xs space-y-3"
            >
              <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    fetchConvocatorias({ query: searchInput, refresh: true });
                  }}
                  className="md:col-span-5 flex gap-2"
                >
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
                    <input
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Buscar por palabra clave (ej. charcas, custodia, incendio...)"
                      className="w-full rounded-lg border border-[#E6E4DD] bg-[#F8F7F4] pl-9 pr-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-[#1B4332] focus:bg-white focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-lg bg-[#1B4332] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#2D6A4F] transition cursor-pointer shrink-0"
                  >
                    Buscar
                  </button>
                </form>

                {/* Comunidad Autónoma */}
                <div className="md:col-span-3">
                  <label htmlFor="ccaa-select" className="sr-only">
                    Comunidad Autónoma
                  </label>
                  <select
                    id="ccaa-select"
                    value={ccaaFilter}
                    onChange={(e) => setCcaaFilter(e.target.value)}
                    className="w-full rounded-lg border border-[#E6E4DD] bg-[#F8F7F4] px-3 py-2 text-sm text-stone-800 focus:border-[#1B4332] focus:bg-white focus:outline-none cursor-pointer"
                  >
                    <option value="all">
                      Todas las CCAA ({items.length})
                    </option>
                    {ccaaOptions.map(([ccaa, count]) => (
                      <option key={ccaa} value={ccaa}>
                        {ccaa} ({count})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Línea de Reforesta */}
                <div className="md:col-span-2">
                  <label htmlFor="line-select" className="sr-only">
                    Línea de trabajo
                  </label>
                  <select
                    id="line-select"
                    value={lineFilter}
                    onChange={(e) =>
                      setLineFilter(e.target.value as WorkLine | "all")
                    }
                    className="w-full rounded-lg border border-[#E6E4DD] bg-[#F8F7F4] px-3 py-2 text-sm text-stone-800 focus:border-[#1B4332] focus:bg-white focus:outline-none cursor-pointer"
                  >
                    <option value="all">Todas las líneas</option>
                    {(Object.keys(WORK_LINE_LABELS) as WorkLine[]).map(
                      (line) => (
                        <option key={line} value={line}>
                          {WORK_LINE_LABELS[line]}
                        </option>
                      )
                    )}
                  </select>
                </div>

                {/* Estado del plazo */}
                <div className="md:col-span-2">
                  <label htmlFor="deadline-select" className="sr-only">
                    Estado del plazo
                  </label>
                  <select
                    id="deadline-select"
                    value={deadlineFilter}
                    onChange={(e) =>
                      setDeadlineFilter(e.target.value as DeadlineFilter)
                    }
                    className="w-full rounded-lg border border-[#E6E4DD] bg-[#F8F7F4] px-3 py-2 text-sm text-stone-800 focus:border-[#1B4332] focus:bg-white focus:outline-none cursor-pointer"
                  >
                    <option value="all">Cualquier plazo</option>
                    <option value="open">Abiertas o próximas</option>
                    <option value="closed">Plazo cerrado</option>
                  </select>
                </div>
              </div>

              {/* Secondary quick toggles + live count */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-stone-100 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-stone-800 font-medium">
                    <input
                      type="checkbox"
                      checked={outsideOnly}
                      onChange={(e) => setOutsideOnly(e.target.checked)}
                      className="rounded accent-[#1B4332]"
                    />
                    Solo fuera de tus 4 fuentes (MITECO, F. Biodiversidad, CAM,
                    Agenda 2030)
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-stone-700">
                    <input
                      type="checkbox"
                      checked={competitiveOnly}
                      onChange={(e) => setCompetitiveOnly(e.target.checked)}
                      className="rounded accent-[#1B4332]"
                    />
                    Solo concurrencia competitiva
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-stone-700">
                    <input
                      type="checkbox"
                      checked={hideDiscarded}
                      onChange={(e) => setHideDiscarded(e.target.checked)}
                      className="rounded accent-[#1B4332]"
                    />
                    Ocultar descartadas
                  </label>
                </div>

                <div className="flex items-center gap-3 text-stone-500 tabular-nums">
                  <span>
                    <strong className="text-stone-900">
                      {filteredItems.length}
                    </strong>{" "}
                    de {stats.total} convocatorias · {stats.openOrUpcoming} en
                    plazo
                  </span>
                  {hasCustomFilters && (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="inline-flex items-center gap-1 text-[#1B4332] font-medium hover:underline cursor-pointer"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Restablecer
                    </button>
                  )}
                </div>
              </div>
            </section>

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                {error}
              </div>
            )}

            {loading ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-7 space-y-2.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <div
                      key={n}
                      className="rounded-xl border border-[#E6E4DD] bg-white p-4 space-y-2.5 animate-pulse"
                    >
                      <div className="flex justify-between">
                        <div className="h-5 w-24 rounded-full bg-stone-200" />
                        <div className="h-5 w-16 rounded-full bg-stone-100" />
                      </div>
                      <div className="h-4 w-5/6 rounded bg-stone-200" />
                      <div className="h-3 w-1/2 rounded bg-stone-100" />
                    </div>
                  ))}
                </div>
                <div className="lg:col-span-5 rounded-xl border border-[#E6E4DD] bg-white p-5 space-y-4 animate-pulse">
                  <div className="h-5 w-3/4 rounded bg-stone-200" />
                  <div className="h-24 rounded-xl bg-stone-100" />
                  <div className="h-20 rounded-xl bg-stone-100" />
                </div>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="rounded-xl border border-[#E6E4DD] bg-white p-12 text-center space-y-3">
                <p className="text-sm font-semibold text-stone-900">
                  Ninguna convocatoria coincide con estos filtros.
                </p>
                <p className="text-xs text-stone-600 max-w-md mx-auto">
                  Prueba a seleccionar &ldquo;Todas las CCAA&rdquo;, desactivar
                  &ldquo;Solo fuera de tus 4 fuentes&rdquo; o buscar otro
                  término en la BDNS.
                </p>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B4332] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#2D6A4F] transition cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restablecer filtros
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                {/* Left List */}
                <div className="lg:col-span-7 space-y-2.5">
                  {filteredItems.map((item) => {
                    const isSelected =
                      selectedItem?.codigoBDNS === item.codigoBDNS;
                    const triage = triageMap[item.codigoBDNS] || "nueva";

                    return (
                      <button
                        key={item.codigoBDNS}
                        type="button"
                        onClick={() => setSelectedCode(item.codigoBDNS)}
                        className={`w-full text-left rounded-xl border p-4 transition duration-150 cursor-pointer space-y-2.5 ${
                          isSelected
                            ? "border-[#1B4332] bg-white ring-1 ring-[#1B4332] shadow-xs"
                            : "border-[#E6E4DD] bg-white hover:border-stone-300"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-sm font-semibold text-stone-900 leading-snug line-clamp-2">
                            {item.titulo}
                          </h3>
                          <ScoreBadge
                            score={item.fit.score}
                            tier={item.fit.tier}
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-stone-600">
                          <span className="font-medium text-stone-800">
                            {item.organismo}
                          </span>
                          <span className="text-stone-300">•</span>
                          <span className="inline-flex items-center gap-1 text-stone-700">
                            <MapPin className="h-3 w-3 text-stone-400" />
                            {item.comunidadAutonoma}
                          </span>
                          <span className="text-stone-300">•</span>
                          <span className="font-semibold text-stone-800 tabular-nums">
                            {formatCurrency(item.presupuestoTotal)}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <DeadlineBadge fit={item.fit} />
                            {item.fit.outsideManualSources && (
                              <span className="rounded-full bg-[#E9F2EC] px-2 py-0.5 text-[11px] font-medium text-[#1B4332]">
                                Fuera de tus 4 fuentes
                              </span>
                            )}
                            {item.fit.workLines.slice(0, 2).map((line) => (
                              <WorkLinePill key={line} line={line} />
                            ))}
                          </div>
                          {triage !== "nueva" && (
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${TRIAGE_LABELS[triage].cls}`}
                            >
                              {TRIAGE_LABELS[triage].label}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Right Detail: 30s Decision Sheet */}
                {selectedItem && (
                  <aside className="lg:col-span-5 lg:sticky lg:top-20 rounded-xl border border-[#E6E4DD] bg-white p-5 shadow-xs space-y-4">
                    <div className="space-y-2 border-b border-stone-100 pb-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono text-stone-500">
                          BDNS #{selectedItem.codigoBDNS} ·{" "}
                          {selectedItem.comunidadAutonoma}
                        </span>
                        <ScoreBadge
                          score={selectedItem.fit.score}
                          tier={selectedItem.fit.tier}
                        />
                      </div>

                      <h2 className="text-base font-semibold text-stone-900 leading-snug">
                        {selectedItem.titulo}
                      </h2>
                      <p className="text-xs font-medium text-stone-600">
                        {selectedItem.organismo}
                      </p>
                    </div>

                    {/* Triage Actions */}
                    <div className="space-y-1.5">
                      <span className="text-xs font-medium text-stone-600">
                        Decisión del equipo
                      </span>
                      <div className="grid grid-cols-3 gap-2">
                        {(
                          ["estudio", "presentar", "descartada"] as TriageStatus[]
                        ).map((st) => {
                          const current =
                            (triageMap[selectedItem.codigoBDNS] || "nueva") ===
                            st;
                          return (
                            <button
                              key={st}
                              type="button"
                              onClick={() =>
                                updateTriage(
                                  selectedItem.codigoBDNS,
                                  current ? "nueva" : st
                                )
                              }
                              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${
                                current
                                  ? "bg-[#1B4332] text-white border-[#1B4332]"
                                  : "bg-[#F8F7F4] text-stone-700 border-[#E6E4DD] hover:bg-stone-100"
                              }`}
                            >
                              {TRIAGE_LABELS[st].label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Why it fits */}
                    <div className="rounded-lg bg-[#F4F8F5] border border-emerald-200/70 p-3.5 space-y-1.5">
                      <h3 className="text-xs font-semibold text-[#1B4332] flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4" />
                        Por qué encaja con Reforesta
                      </h3>
                      <ul className="space-y-1 text-xs text-stone-700 leading-relaxed">
                        {selectedItem.fit.reasons.map((r, i) => (
                          <li key={i}>• {r}</li>
                        ))}
                      </ul>
                    </div>

                    {/* Warnings */}
                    {selectedItem.fit.warnings.length > 0 && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 p-3.5 space-y-1.5">
                        <h3 className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                          <AlertTriangle className="h-4 w-4" />
                          Qué vigilar antes de dedicarle horas
                        </h3>
                        <ul className="space-y-1 text-xs text-amber-950 leading-relaxed">
                          {selectedItem.fit.warnings.map((w, i) => (
                            <li key={i}>• {w}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Key metadata */}
                    <dl className="grid grid-cols-2 gap-2.5 text-xs">
                      <div className="rounded-lg bg-[#F8F7F4] p-3 border border-[#E6E4DD]">
                        <dt className="text-stone-500 mb-0.5">Presupuesto</dt>
                        <dd className="font-semibold text-stone-900 tabular-nums">
                          {formatCurrency(selectedItem.presupuestoTotal)}
                        </dd>
                      </div>
                      <div className="rounded-lg bg-[#F8F7F4] p-3 border border-[#E6E4DD]">
                        <dt className="text-stone-500 mb-0.5">Tipo</dt>
                        <dd className="font-semibold text-stone-900">
                          {selectedItem.tipoConvocatoria || "Consultar bases"}
                        </dd>
                      </div>
                      <div className="col-span-2 rounded-lg bg-[#F8F7F4] p-3 border border-[#E6E4DD] flex items-start gap-2">
                        <Calendar className="h-4 w-4 text-stone-400 shrink-0 mt-0.5" />
                        <div>
                          <dt className="text-stone-500">Plazo de solicitud</dt>
                          <dd className="font-medium text-stone-900 tabular-nums">
                            {selectedItem.textInicio ||
                              selectedItem.fechaInicioSolicitud ||
                              "?"}{" "}
                            →{" "}
                            {selectedItem.textFin ||
                              selectedItem.fechaFinSolicitud ||
                              "Ver extracto"}
                          </dd>
                        </div>
                      </div>
                      {selectedItem.beneficiarios.length > 0 && (
                        <div className="col-span-2 rounded-lg bg-[#F8F7F4] p-3 border border-[#E6E4DD] flex items-start gap-2">
                          <Sprout className="h-4 w-4 text-stone-400 shrink-0 mt-0.5" />
                          <div>
                            <dt className="text-stone-500">Beneficiarios</dt>
                            <dd className="font-medium text-stone-900">
                              {selectedItem.beneficiarios.join(" · ")}
                            </dd>
                          </div>
                        </div>
                      )}
                    </dl>

                    {/* Documents with 1-click PDF analysis */}
                    {selectedItem.documentos.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-xs font-semibold text-stone-700">
                          Documentos oficiales ({selectedItem.documentos.length})
                        </h3>
                        <div className="space-y-1.5">
                          {selectedItem.documentos.map((doc) => (
                            <div
                              key={doc.id}
                              className="flex items-center justify-between gap-2 rounded-lg border border-[#E6E4DD] bg-[#F8F7F4] px-3 py-2 text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText className="h-4 w-4 text-stone-500 shrink-0" />
                                <span className="truncate font-medium text-stone-800">
                                  {doc.nombre}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    runModalPdfAnalysis({
                                      docId: doc.id,
                                      fileName: doc.nombre,
                                    })
                                  }
                                  className="rounded-md bg-[#1B4332] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#2D6A4F] transition cursor-pointer"
                                >
                                  Analizar PDF
                                </button>
                                <a
                                  href={doc.urlDescarga}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-stone-500 hover:text-stone-900"
                                  title="Descargar PDF original"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Links */}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-stone-100">
                      <a
                        href={selectedItem.urlBDNS}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white hover:bg-stone-700 transition"
                      >
                        Ficha oficial BDNS
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      {selectedItem.sedeElectronica && (
                        <a
                          href={selectedItem.sedeElectronica}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#E6E4DD] bg-white px-3 py-2 text-xs font-medium text-stone-800 hover:bg-stone-50 transition"
                        >
                          Sede electrónica
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {selectedItem.urlBasesReguladoras && (
                        <a
                          href={selectedItem.urlBasesReguladoras}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#E6E4DD] bg-white px-3 py-2 text-xs font-medium text-stone-800 hover:bg-stone-50 transition"
                        >
                          Bases reguladoras
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </aside>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: BOE & Licitaciones */}
        {activeTab === "boe" && (
          <BoeTab
            onAnalyzePdfUrl={(pdfUrl, fileName) =>
              runModalPdfAnalysis({ pdfUrl, fileName })
            }
          />
        )}

        {/* Tab 3: Multi-source (BOCM, DOG, EU LIFE, F. Biodiversidad) */}
        {activeTab === "fuentes" && (
          <MultiSourceTab
            onAnalyzePdfUrl={(pdfUrl, fileName) =>
              runModalPdfAnalysis({ pdfUrl, fileName })
            }
          />
        )}

        {/* Tab 4: PDF Analyzer */}
        {activeTab === "pdf" && <PdfAnalyzerTab />}

        {/* Tab 4: RSC & Foundations */}
        {activeTab === "rsc" && <RscTab />}
      </main>

      {/* Modal for inline BDNS & BOE PDF analysis */}
      {(pdfModalLoading || pdfModalResult || pdfModalError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#F6F5F0] p-5 shadow-2xl">
            <button
              type="button"
              onClick={() => {
                setPdfModalLoading(false);
                setPdfModalResult(null);
                setPdfModalError(null);
              }}
              className="sticky top-0 float-right rounded-full bg-white p-2 text-stone-600 shadow hover:text-stone-900 cursor-pointer"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>

            {pdfModalLoading && (
              <div className="flex items-center justify-center gap-2 py-20 text-sm text-stone-700">
                <Loader2 className="h-5 w-5 animate-spin text-[#1B4332]" />
                Descargando PDF oficial y extrayendo ficha de decisión...
              </div>
            )}

            {pdfModalError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                {pdfModalError}
              </div>
            )}

            {pdfModalResult && <PdfResultCard result={pdfModalResult} />}
          </div>
        </div>
      )}
    </div>
  );
}

function NavTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition duration-150 cursor-pointer shrink-0 ${
        active
          ? "bg-white text-[#0F291E] shadow-xs"
          : "text-emerald-100/80 hover:text-white hover:bg-white/10"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
