"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  Gavel,
  RefreshCw,
  ScrollText,
} from "lucide-react";
import type { BoeItem } from "@/lib/types";
import { ScoreBadge, WorkLinePill } from "./BadgeHelpers";

interface BoeTabProps {
  onAnalyzePdfUrl: (pdfUrl: string, fileName: string) => void;
}

export function BoeTab({ onAnalyzePdfUrl }: BoeTabProps) {
  const [items, setItems] = useState<BoeItem[]>([]);
  const [scannedDays, setScannedDays] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyLicitaciones, setOnlyLicitaciones] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function loadBoe(refresh = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/boe${refresh ? "?refresh=1" : ""}`);
      if (!res.ok) throw new Error("No se pudo conectar con la API del BOE.");
      const data = (await res.json()) as {
        items: BoeItem[];
        scannedDays: number;
      };
      setItems(data.items);
      setScannedDays(data.scannedDays);
      setSelectedId(data.items[0]?.identificador ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando BOE");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/boe");
        if (!res.ok) throw new Error("No se pudo conectar con la API del BOE.");
        const data = (await res.json()) as {
          items: BoeItem[];
          scannedDays: number;
        };
        if (!active) return;
        setItems(data.items);
        setScannedDays(data.scannedDays);
        setSelectedId(data.items[0]?.identificador ?? null);
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : "Error cargando BOE");
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
    return onlyLicitaciones ? items.filter((i) => i.esLicitacion) : items;
  }, [items, onlyLicitaciones]);

  const selected = useMemo(() => {
    return (
      filtered.find((i) => i.identificador === selectedId) ??
      filtered[0] ??
      null
    );
  }, [filtered, selectedId]);

  const licitacionesCount = items.filter((i) => i.esLicitacion).length;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#E6E4DD] bg-white p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Gavel className="h-5 w-5 text-[#1B4332]" />
            <h2 className="text-base font-semibold text-stone-900">
              BOE en vivo · Licitaciones (Sección V.A) y Disposiciones (últimos{" "}
              {scannedDays} días)
            </h2>
          </div>
          <p className="text-xs text-stone-600">
            Escaneo directo de la API de Datos Abiertos del BOE (`boe.es`).
            Detecta contratos de servicios forestales, restauración y
            subvenciones publicadas en el boletín oficial.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <label className="inline-flex items-center gap-2 rounded-xl border border-[#E6E4DD] bg-[#F8F7F4] px-3 py-2 text-xs font-medium text-stone-800 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyLicitaciones}
              onChange={(e) => setOnlyLicitaciones(e.target.checked)}
              className="rounded accent-[#1B4332]"
            />
            Solo licitaciones ({licitacionesCount})
          </label>
          <button
            type="button"
            onClick={() => loadBoe(true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1B4332] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#2D6A4F] transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Reescanear BOE
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 space-y-3">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="rounded-xl border border-[#E6E4DD] bg-white p-4 space-y-3 animate-pulse"
              >
                <div className="flex gap-2">
                  <div className="h-5 w-16 rounded-full bg-stone-200" />
                  <div className="h-5 w-28 rounded-full bg-stone-100" />
                </div>
                <div className="h-4 w-11/12 rounded bg-stone-200" />
                <div className="h-3 w-2/3 rounded bg-stone-100" />
              </div>
            ))}
          </div>
          <div className="lg:col-span-5 rounded-xl border border-[#E6E4DD] bg-white p-5 space-y-4 animate-pulse">
            <div className="h-5 w-3/4 rounded bg-stone-200" />
            <div className="h-20 rounded-xl bg-stone-100" />
            <div className="h-16 rounded-xl bg-stone-100" />
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#E6E4DD] bg-white p-12 text-center space-y-2">
          <p className="text-sm font-medium text-stone-800">
            No se encontraron anuncios con este filtro en los últimos{" "}
            {scannedDays} días.
          </p>
          <p className="text-xs text-stone-500">
            Prueba a desactivar &ldquo;Solo licitaciones&rdquo; para ver también
            disposiciones y extractos.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-7 space-y-2.5">
            {filtered.map((item) => {
              const isSelected = selected?.identificador === item.identificador;

              return (
                <button
                  key={item.identificador}
                  type="button"
                  onClick={() => setSelectedId(item.identificador)}
                  className={`w-full text-left rounded-xl border p-4 transition duration-150 cursor-pointer space-y-2.5 ${
                    isSelected
                      ? "border-[#1B4332] bg-white ring-1 ring-[#1B4332] shadow-xs"
                      : "border-[#E6E4DD] bg-white hover:border-stone-300"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ScoreBadge
                        score={item.fit.score}
                        tier={item.fit.tier}
                      />
                      {item.esLicitacion ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-800">
                          <Gavel className="h-3 w-3" />
                          Licitación · BOE V.A
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-medium text-stone-700">
                          <ScrollText className="h-3 w-3" />
                          BOE Sec. {item.seccionCodigo}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-stone-500 flex items-center gap-1 tabular-nums">
                      <Calendar className="h-3.5 w-3.5" />
                      {item.fechaPublicacion}
                    </span>
                  </div>

                  <h3 className="text-sm font-semibold text-stone-900 leading-snug line-clamp-2">
                    {item.titulo}
                  </h3>

                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-stone-500">
                    <span className="font-medium text-stone-700">
                      {item.departamento}
                    </span>
                    <span>·</span>
                    <span className="font-mono text-[11px]">
                      {item.identificador}
                    </span>
                  </div>

                  {item.fit.workLines.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {item.fit.workLines.map((line) => (
                        <WorkLinePill key={line} line={line} />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {selected && (
            <aside className="lg:col-span-5 lg:sticky lg:top-6 rounded-2xl border border-[#E6E4DD] bg-white p-5 shadow-sm space-y-4">
              <div className="space-y-2 border-b border-stone-100 pb-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono text-stone-500">
                    {selected.identificador} · {selected.fechaPublicacion}
                  </span>
                  <ScoreBadge
                    score={selected.fit.score}
                    tier={selected.fit.tier}
                  />
                </div>
                <h3 className="text-base font-semibold text-stone-900 leading-snug">
                  {selected.titulo}
                </h3>
                <p className="text-xs font-medium text-stone-600">
                  {selected.departamento}
                  {selected.epigrafe ? ` · ${selected.epigrafe}` : ""}
                </p>
              </div>

              <div className="rounded-xl bg-[#F4F8F5] border border-emerald-100 p-3.5 space-y-1.5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[#1B4332] flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />
                  Por qué aparece en el radar
                </h4>
                <ul className="space-y-1 text-xs text-stone-700 leading-relaxed">
                  {selected.fit.reasons.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              </div>

              {selected.fit.warnings.length > 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 space-y-1.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-900 flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" />
                    Qué vigilar
                  </h4>
                  <ul className="space-y-1 text-xs text-amber-950 leading-relaxed">
                    {selected.fit.warnings.map((w, i) => (
                      <li key={i}>• {w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2 border-t border-stone-100">
                {selected.urlPdf && (
                  <button
                    type="button"
                    onClick={() =>
                      onAnalyzePdfUrl(
                        selected.urlPdf!,
                        `${selected.identificador}.pdf`
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#1B4332] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#2D6A4F] transition cursor-pointer"
                  >
                    <FileSearch className="h-3.5 w-3.5" />
                    Analizar PDF del BOE
                  </button>
                )}
                {selected.urlPdf && (
                  <a
                    href={selected.urlPdf}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-xs font-medium text-stone-800 hover:bg-stone-50 transition"
                  >
                    Ver PDF oficial
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                {selected.urlHtml && (
                  <a
                    href={selected.urlHtml}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-xs font-medium text-stone-800 hover:bg-stone-50 transition"
                  >
                    Ficha BOE
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
