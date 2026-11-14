"use client";

import { Check, ChevronDown, Compass, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { DEFAULT_FILTERS, EMPTY_DIMS, fmtDayShort, type Dim } from "./model";
import { useRadar } from "./store";
import { cx } from "./ui";

export interface Option {
  key: string;
  label: string;
  count: number;
}

/* ---------- Multi-select dropdown ---------- */

export function MultiSelect({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        root.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const n = selected.length;
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm whitespace-nowrap transition-colors",
          n ? "border-brand-300 bg-brand-50 font-medium text-brand-900" : "border-stone-200 bg-white text-stone-700 hover:border-stone-300",
        )}
      >
        {label}
        {n > 0 && <span className="rounded-full bg-brand-800 px-1.5 text-[11px] leading-[18px] font-semibold text-white tabular-nums">{n}</span>}
        <ChevronDown className={cx("h-3.5 w-3.5 text-stone-400 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div
          id={id}
          role="group"
          aria-label={label}
          className="absolute top-full left-0 z-40 mt-1.5 w-72 max-w-[calc(100vw-32px)] rounded-xl border border-stone-200 bg-white p-1.5 shadow-[0_12px_32px_-12px_rgba(28,25,23,0.25)]"
        >
          <ul className="max-h-72 overflow-y-auto">
            {options.map((o) => {
              const on = selected.includes(o.key);
              return (
                <li key={o.key}>
                  <label
                    className={cx(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-stone-50",
                      o.count === 0 && !on && "text-stone-400",
                    )}
                  >
                    <input type="checkbox" checked={on} onChange={() => onToggle(o.key)} className="peer sr-only" />
                    <span
                      aria-hidden
                      className={cx(
                        "grid h-4 w-4 shrink-0 place-items-center rounded border peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-800",
                        on ? "border-brand-800 bg-brand-800 text-white" : "border-stone-300 bg-white",
                      )}
                    >
                      {on && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    <span className="text-xs text-stone-400 tabular-nums">{o.count}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {n > 0 && (
            <div className="mt-1 border-t border-stone-100 px-1 pt-1.5">
              <button type="button" onClick={onClear} className="cursor-pointer rounded-md px-1.5 py-1 text-xs font-medium text-brand-800 hover:bg-brand-50">
                Quitar selección
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Filter bar (one row of controls + a row of active chips) ---------- */

export interface BarDim {
  dim: Dim;
  label: string;
  options: Option[];
}

export function FilterBar({
  dims,
  chips,
  total,
  fueraCount,
}: {
  dims: BarDim[];
  chips: { key: string; label: string; remove: () => void }[];
  total: number;
  fueraCount: number;
}) {
  const { filters, setFilters } = useRadar();
  const ref = useRef<HTMLDivElement>(null);

  // Expose the bar height so the table header can stick right below it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--filters-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toggle = (dim: Dim, key: string) =>
    setFilters((f) => {
      const cur = f.dims[dim];
      return { ...f, dims: { ...f.dims, [dim]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] } };
    });
  const fuera = filters.flags.includes("fuera");

  return (
    <div
      ref={ref}
      className="z-20 -mx-4 border-b border-stone-200/80 bg-background/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:sticky lg:top-[var(--header-h)] lg:-mx-8 lg:px-8"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative block w-full sm:w-64">
          <span className="sr-only">Buscar</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
          <input
            type="search"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="Buscar: charcas, ailanto, Guadarrama…"
            className="h-9 w-full rounded-lg border border-stone-200 bg-white pr-3 pl-9 text-sm placeholder:text-stone-400 hover:border-stone-300 focus:border-brand-600 focus:outline-none focus-visible:outline-2"
          />
        </label>
        {dims.map((d) => (
          <MultiSelect
            key={d.dim}
            label={d.label}
            options={d.options}
            selected={filters.dims[d.dim]}
            onToggle={(k) => toggle(d.dim, k)}
            onClear={() => setFilters((f) => ({ ...f, dims: { ...f.dims, [d.dim]: [] } }))}
          />
        ))}
        <button
          type="button"
          aria-pressed={fuera}
          onClick={() => setFilters((f) => ({ ...f, flags: fuera ? f.flags.filter((x) => x !== "fuera") : [...f.flags, "fuera"] }))}
          className={cx(
            "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm whitespace-nowrap transition-colors",
            fuera ? "border-brand-800 bg-brand-800 font-medium text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-300",
          )}
        >
          <Compass className="h-4 w-4" aria-hidden />
          Fuera de tus 4 fuentes
          <span className={cx("text-xs tabular-nums", fuera ? "text-brand-100" : "text-stone-400")}>{fueraCount}</span>
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm text-stone-600">
          <strong className="font-semibold tabular-nums text-stone-900">{total}</strong> {total === 1 ? "convocatoria" : "convocatorias"}
        </span>
        {filters.hideClosed && !filters.dims.plazo.includes("cerrada") ? (
          <Chip label="Ocultando cerradas" muted onRemove={() => setFilters((f) => ({ ...f, hideClosed: false }))} />
        ) : (
          !filters.dims.plazo.includes("cerrada") && (
            <button
              type="button"
              onClick={() => setFilters((f) => ({ ...f, hideClosed: true }))}
              className="cursor-pointer rounded-full border border-dashed border-stone-300 px-2.5 py-0.5 text-xs text-stone-600 hover:border-stone-400 hover:text-stone-900"
            >
              Incluye cerradas · ocultarlas
            </button>
          )
        )}
        {chips.map((c) => (
          <Chip key={c.key} label={c.label} onRemove={c.remove} />
        ))}
        {chips.length > 0 && (
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...DEFAULT_FILTERS, hideClosed: f.hideClosed, dims: EMPTY_DIMS }))}
            className="cursor-pointer rounded-md px-2 py-0.5 text-xs font-medium text-brand-800 hover:bg-brand-50"
          >
            Limpiar
          </button>
        )}
      </div>
    </div>
  );
}

export function Chip({ label, onRemove, muted = false }: { label: string; onRemove: () => void; muted?: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex max-w-full items-center gap-0.5 rounded-full py-0.5 pr-0.5 pl-2.5 text-xs font-medium",
        muted ? "bg-stone-200/70 text-stone-700" : "bg-brand-800 text-white",
      )}
    >
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Quitar filtro: ${label}`}
        className={cx("grid h-5 w-5 cursor-pointer place-items-center rounded-full", muted ? "hover:bg-stone-300" : "hover:bg-brand-700")}
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}

export function weekChipLabel(w: number) {
  return `Cierran la semana del ${fmtDayShort(w)}`;
}
