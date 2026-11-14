"use client";

import { Check } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

/* ---------- Tooltip (one per chart, positioned inside a relative container) ---------- */

interface Tip {
  w: number;
  x: number;
  y: number;
  content: ReactNode;
}

function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (el: HTMLElement, content: ReactNode) => {
    const box = ref.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!box) return;
    setTip({ w: box.width, x: r.left - box.left + r.width / 2, y: r.top - box.top, content });
  };
  const node = tip ? (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 w-max max-w-[260px] -translate-x-1/2 -translate-y-full rounded-lg bg-stone-900 px-3 py-2 text-xs leading-snug text-stone-100 shadow-lg"
      style={{
        left: Math.min(Math.max(tip.x, 130), tip.w - 130),
        top: tip.y - 8,
      }}
    >
      {tip.content}
    </div>
  ) : null;
  return { ref, show, hide: () => setTip(null), node };
}

/* ---------- Horizontal bar list: click to toggle (multi-select) ---------- */

export interface BarRow {
  key: string;
  label: string;
  count: number;
}

export function BarList({
  title,
  hint,
  rows,
  selected,
  onToggle,
  total,
  maxRows = 6,
  sort = true,
}: {
  title: string;
  hint?: string;
  rows: BarRow[];
  selected: string[];
  onToggle: (key: string) => void;
  total: number;
  maxRows?: number;
  sort?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { ref, show, hide, node } = useTip();
  const visibleRows = rows.filter((r) => r.count > 0 || selected.includes(r.key));
  const sorted = sort ? [...visibleRows].sort((a, b) => b.count - a.count) : visibleRows;
  const shown = expanded ? sorted : sorted.slice(0, maxRows);
  // Selected rows stay visible even when collapsed.
  for (const r of sorted) if (selected.includes(r.key) && !shown.includes(r)) shown.push(r);
  const max = Math.max(1, ...sorted.map((r) => r.count));
  const hasSel = selected.length > 0;

  return (
    <div ref={ref} className="relative flex flex-col gap-3 p-5" onPointerLeave={hide}>
      <ChartTitle title={title} hint={hint} />
      {sorted.length === 0 ? (
        <p className="py-4 text-sm text-stone-400">Nada con los filtros actuales.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {shown.map((r) => {
            const on = selected.includes(r.key);
            const pct = total ? Math.round((r.count / total) * 100) : 0;
            return (
              <li key={r.key}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(r.key)}
                  onPointerEnter={(e) =>
                    show(e.currentTarget, (
                      <>
                        <span className="block text-sm font-semibold tabular-nums text-white">
                          {r.count} {r.count === 1 ? "convocatoria" : "convocatorias"}
                        </span>
                        <span className="text-stone-300">
                          {r.label} · {pct}% de lo visible
                        </span>
                        <span className="mt-1 block text-stone-400">{on ? "Clic para quitar el filtro" : "Clic para filtrar"}</span>
                      </>
                    ))
                  }
                  onFocus={(e) => show(e.currentTarget, `${r.label}: ${r.count}`)}
                  onBlur={hide}
                  className="group grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-stone-50"
                >
                  <span className={cx("flex min-w-0 items-center gap-1.5 text-[13px]", on ? "font-semibold text-stone-900" : "text-stone-700")}>
                    {on && <Check className="h-3.5 w-3.5 shrink-0 text-brand-800" strokeWidth={3} aria-hidden />}
                    <span className="truncate">{r.label}</span>
                  </span>
                  <span className={cx("text-[13px] tabular-nums", on ? "font-semibold text-stone-900" : "text-stone-500")}>{r.count}</span>
                  <span className="col-span-2 block h-1.5 w-full rounded-full bg-stone-100">
                    <span
                      className={cx(
                        "block h-full rounded-full transition-[width,opacity,background-color] duration-300",
                        on ? "bg-brand-800" : "bg-brand-500 group-hover:bg-brand-700",
                        hasSel && !on && "opacity-30",
                      )}
                      style={{ width: `${Math.max(2, (r.count / max) * 100)}%` }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {sorted.length > maxRows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start cursor-pointer rounded px-1.5 text-xs font-medium text-brand-800 hover:underline"
        >
          {expanded ? "Ver menos" : `Ver las ${sorted.length}`}
        </button>
      )}
      {node}
    </div>
  );
}

function ChartTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
      {hint && <span className="text-xs text-stone-400">{hint}</span>}
    </div>
  );
}

/* ---------- Weekly deadlines: vertical bars, one per week ---------- */

export interface WeekBin {
  start: number;
  label: string;
  range: string;
  count: number;
  top: string[];
}

export function WeekBars({
  bins,
  selected,
  onSelect,
  later,
}: {
  bins: WeekBin[];
  selected: number | null;
  onSelect: (start: number | null) => void;
  later: number;
}) {
  const { ref, show, hide, node } = useTip();
  const max = Math.max(1, ...bins.map((b) => b.count));
  const total = bins.reduce((s, b) => s + b.count, 0);
  const H = 96;

  return (
    <div ref={ref} className="relative flex flex-col gap-4 p-5" onPointerLeave={hide}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-stone-900">Cuándo cierran</h3>
          <p className="text-xs text-stone-500">
            {total} cierran en las próximas 12 semanas{later > 0 ? ` · ${later} más adelante` : ""}. Pulsa una semana para verlas.
          </p>
        </div>
      </div>
      <div className="relative">
        <ol className="grid grid-cols-12 items-end gap-1 sm:gap-2" style={{ height: H + 40 }}>
          {bins.map((b, i) => {
            const on = selected === b.start;
            const h = b.count ? Math.max(4, (b.count / max) * H) : 0;
            return (
              <li key={b.start} className="h-full">
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`Semana del ${b.range}: ${b.count} convocatorias cierran`}
                  onClick={() => onSelect(on ? null : b.start)}
                  onPointerEnter={(e) =>
                    show((e.currentTarget.querySelector("[data-count]") as HTMLElement) ?? e.currentTarget, (
                      <>
                        <span className="block text-sm font-semibold tabular-nums text-white">
                          {b.count} {b.count === 1 ? "cierra" : "cierran"}
                        </span>
                        <span className="text-stone-300">Semana del {b.range}</span>
                        {b.top.length > 0 && (
                          <ul className="mt-1.5 space-y-0.5 border-t border-stone-700 pt-1.5 text-stone-300">
                            {b.top.map((t, j) => (
                              <li key={j} className="line-clamp-1">
                                {t}
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    ))
                  }
                  onFocus={(e) => show(e.currentTarget, `Semana del ${b.range}: ${b.count}`)}
                  onBlur={hide}
                  className="group flex h-full w-full cursor-pointer flex-col items-center justify-end gap-1 rounded-md pt-0 transition-colors hover:bg-stone-50"
                >
                  <span data-count className={cx("text-xs tabular-nums", on ? "font-semibold text-stone-900" : "text-stone-500", b.count === 0 && "text-stone-300")}>
                    {b.count}
                  </span>
                  <span
                    data-bar
                    className={cx(
                      "block w-full max-w-9 rounded-t-[4px] transition-[height,opacity,background-color] duration-300",
                      on ? "bg-brand-800" : "bg-brand-500 group-hover:bg-brand-700",
                      selected != null && !on && "opacity-30",
                    )}
                    style={{ height: h }}
                  />
                  <span className="h-px w-full bg-stone-300" aria-hidden />
                  <span
                    className={cx(
                      "pb-1 text-[11px] leading-tight whitespace-nowrap",
                      on ? "font-semibold text-stone-900" : "text-stone-500",
                      i % 2 === 1 && "max-sm:invisible",
                    )}
                  >
                    {i === 0 ? "Esta" : b.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      {node}
    </div>
  );
}

/* ---------- Stat tile: a headline number that is also a filter ---------- */

export function StatTile({
  label,
  value,
  caption,
  on,
  onClick,
  icon,
}: {
  label: string;
  value: number;
  caption: string;
  on: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "group relative flex cursor-pointer flex-col gap-1.5 rounded-2xl border p-4 text-left transition-all",
        on
          ? "border-brand-800 bg-brand-800 text-white shadow-[0_8px_24px_-12px_rgba(27,67,50,0.6)]"
          : "border-stone-200/80 bg-white hover:border-stone-300 hover:shadow-sm",
      )}
    >
      <span className={cx("flex items-center justify-between gap-2 text-[13px] font-medium", on ? "text-brand-100" : "text-stone-600")}>
        <span className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        {on && <Check className="h-4 w-4" strokeWidth={3} aria-hidden />}
      </span>
      <span className={cx("text-[28px] leading-none font-semibold tabular-nums tracking-tight sm:text-[32px]", on ? "text-white" : "text-stone-900")}>{value}</span>
      <span className={cx("text-xs", on ? "text-brand-100" : "text-stone-500")}>{on ? "Filtro activo · pulsa para quitarlo" : caption}</span>
    </button>
  );
}
