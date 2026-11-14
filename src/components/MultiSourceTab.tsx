"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  FileSearch,
  Globe2,
  MapPin,
  RefreshCw,
  XCircle,
} from "lucide-react";
import type {
  ExternalSourceId,
  ExternalSourceItem,
  SourceHealth,
} from "@/lib/types";
import { ScoreBadge, WorkLinePill } from "./BadgeHelpers";

interface MultiSourceTabProps {
  onAnalyzePdfUrl: (pdfUrl: string, fileName: string) => void;
}

export function MultiSourceTab({ onAnalyzePdfUrl }: MultiSourceTabProps) {
  const [items, setItems] = useState<ExternalSourceItem[]>([]);
  const [sourcesStatus, setSourcesStatus] = useState<SourceHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<ExternalSourceId | "all">(
    "all"
  );

  async function refreshSources() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fuentes?refresh=1");
      if (!res.ok) throw new Error("Error consultando fuentes externas.");
      const data = (await res.json()) as {
        items: ExternalSourceItem[];
        sourcesStatus: SourceHealth[];
      };
      setItems(data.items);
      setSourcesStatus(data.sourcesStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando fuentes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/fuentes");
        if (!res.ok) throw new Error("Error consultando fuentes externas.");
        const data = (await res.json()) as {
          items: ExternalSourceItem[];
          sourcesStatus: SourceHealth[];
        };
        if (!active) return;
        setItems(data.items);
        setSourcesStatus(data.sourcesStatus);
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : "Error cargando fuentes");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    return sourceFilter === "all"
      ? items
      : items.filter((i) => i.sourceId === sourceFilter);
  }, [items, sourceFilter]);

  return (
    <div className="space-y-4">
      {/* Header + Scraper Health */}
      <section className="rounded-xl border border-[#E6E4DD] bg-white p-4 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-base font-semibold text-stone-900 flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-[#1B4332]" />
              Scrapers activos: Boletines Autonómicos (BOCM, DOG), UE (LIFE) y F.
              Biodiversidad
            </h2>
            <p className="text-xs text-stone-600">
              Ingesta automática en vivo desde XML/HTML de boletines oficiales y
              API SEDIA de la Comisión Europea.
            </p>
          </div>
          <button
            type="button"
            onClick={refreshSources}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B4332] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#2D6A4F] transition cursor-pointer disabled:opacity-50 shrink-0"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Reescanear fuentes
          </button>
        </div>

        {/* Status chips */}
        {sourcesStatus.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2 border-t border-stone-100">
            {sourcesStatus.map((src) => (
              <div
                key={src.id}
                className="rounded-lg border border-[#E6E4DD] bg-[#F8F7F4] p-3 flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {src.status === "ok" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                    )}
                    <span className="text-xs font-semibold text-stone-900 truncate">
                      {src.name}
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-500 mt-1 line-clamp-2">
                    {src.note}
                  </p>
                </div>
                <span className="rounded-full bg-white border border-[#E6E4DD] px-2 py-0.5 text-[11px] font-semibold text-stone-800 tabular-nums shrink-0">
                  {src.count}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Filter pills */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-stone-100">
          <button
            type="button"
            onClick={() => setSourceFilter("all")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition cursor-pointer ${
              sourceFilter === "all"
                ? "bg-[#1B4332] text-white"
                : "bg-stone-100 text-stone-700 hover:bg-stone-200"
            }`}
          >
            Todas ({items.length})
          </button>
          {(
            [
              ["eu-life", "UE · LIFE / Funding & Tenders"],
              ["bocm", "BOCM Madrid"],
              ["dog", "DOG Galicia"],
              ["fundacion-biodiversidad", "Fundación Biodiversidad"],
            ] as [ExternalSourceId, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSourceFilter(id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition cursor-pointer ${
                sourceFilter === id
                  ? "bg-[#1B4332] text-white"
                  : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="rounded-xl border border-[#E6E4DD] bg-white p-4 space-y-2.5 animate-pulse"
            >
              <div className="h-4 w-1/3 rounded bg-stone-200" />
              <div className="h-4 w-5/6 rounded bg-stone-200" />
              <div className="h-3 w-1/2 rounded bg-stone-100" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-[#E6E4DD] bg-white p-10 text-center text-sm text-stone-600">
          No hay resultados ambientales en esta fuente en el último boletín
          publicado. Prueba a seleccionar &ldquo;Todas&rdquo;.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filtered.map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-[#E6E4DD] bg-white p-4 shadow-xs flex flex-col justify-between gap-3"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="rounded-md bg-[#F0EFEA] px-2 py-0.5 text-[11px] font-semibold text-stone-800">
                    {item.sourceLabel}
                  </span>
                  <ScoreBadge score={item.fit.score} tier={item.fit.tier} />
                </div>

                <h3 className="text-sm font-semibold text-stone-900 leading-snug">
                  {item.titulo}
                </h3>

                <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
                  <span className="font-medium text-stone-800">
                    {item.organismo}
                  </span>
                  <span className="text-stone-300">•</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-stone-400" />
                    {item.region}
                  </span>
                  <span className="text-stone-300">•</span>
                  <span className="tabular-nums">{item.date}</span>
                </div>

                {item.fit.workLines.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {item.fit.workLines.map((line) => (
                      <WorkLinePill key={line} line={line} />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-stone-100">
                {item.pdfUrl ? (
                  <button
                    type="button"
                    onClick={() =>
                      onAnalyzePdfUrl(item.pdfUrl!, `${item.id}.pdf`)
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B4332] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2D6A4F] transition cursor-pointer"
                  >
                    <FileSearch className="h-3.5 w-3.5" />
                    Analizar PDF
                  </button>
                ) : (
                  <span className="text-[11px] text-stone-400">
                    Portal web oficial
                  </span>
                )}

                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#1B4332] hover:underline"
                >
                  Abrir fuente
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
