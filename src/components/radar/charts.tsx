"use client";

import { Check } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

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
      className="pointer-events-none absolute z-20 w-max max-w-[260px] -translate-x-1/2 -translate-y-full rounded-md bg-foreground px-3 py-2 text-xs leading-snug text-background"
      style={{ left: Math.min(Math.max(tip.x, 130), tip.w - 130), top: tip.y - 8 }}
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
  rows,
  selected,
  onToggle,
  total,
  maxRows = 6,
  sort = true,
}: {
  title: string;
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
    <div ref={ref} className="relative flex min-w-0 flex-col gap-3 p-5" onPointerLeave={hide}>
      <h3 className="text-sm font-medium">{title}</h3>
      {sorted.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">Nada con los filtros actuales.</p>
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
                    show(
                      e.currentTarget,
                      <>
                        <span className="block font-medium tabular-nums">
                          {r.count} {r.count === 1 ? "convocatoria" : "convocatorias"}
                        </span>
                        <span className="opacity-70">
                          {r.label} · {pct}% de lo visible
                        </span>
                      </>,
                    )
                  }
                  onFocus={(e) => show(e.currentTarget, `${r.label}: ${r.count}`)}
                  onBlur={hide}
                  className="group grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-1.5 py-1 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className={cn("flex min-w-0 items-center gap-1.5 text-[13px]", on ? "font-medium" : "text-muted-foreground")}>
                    {on && <Check className="size-3.5 shrink-0 text-primary" strokeWidth={3} aria-hidden />}
                    <span className="truncate">{r.label}</span>
                  </span>
                  <span className={cn("text-[13px] tabular-nums", on ? "font-medium" : "text-muted-foreground")}>{r.count}</span>
                  <span className="col-span-2 block h-1.5 w-full rounded-full bg-muted">
                    <span
                      className={cn("block h-full rounded-full bg-primary transition-[width,opacity] duration-300", hasSel && !on && "opacity-25")}
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
        <button type="button" onClick={() => setExpanded((v) => !v)} className="cursor-pointer self-start rounded px-1.5 text-xs font-medium text-primary hover:underline">
          {expanded ? "Ver menos" : `Ver las ${sorted.length}`}
        </button>
      )}
      {node}
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
  const H = 88;

  return (
    <div ref={ref} className="relative flex min-w-0 flex-col gap-4 p-5" onPointerLeave={hide}>
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium">Cuándo cierran</h3>
        <p className="text-xs text-muted-foreground">
          {total} en las próximas 12 semanas{later > 0 ? ` · ${later} más adelante` : ""}. Pulsa una semana para filtrar.
        </p>
      </div>
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
                  show(
                    (e.currentTarget.querySelector("[data-count]") as HTMLElement) ?? e.currentTarget,
                    <>
                      <span className="block font-medium tabular-nums">
                        {b.count} {b.count === 1 ? "cierra" : "cierran"}
                      </span>
                      <span className="opacity-70">Semana del {b.range}</span>
                      {b.top.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 border-t border-background/20 pt-1.5 opacity-70">
                          {b.top.map((t, j) => (
                            <li key={j} className="line-clamp-1">
                              {t}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>,
                  )
                }
                onFocus={(e) => show(e.currentTarget, `Semana del ${b.range}: ${b.count}`)}
                onBlur={hide}
                className="group flex h-full w-full cursor-pointer flex-col items-center justify-end gap-1 rounded-md transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span data-count className={cn("text-xs tabular-nums", on ? "font-medium" : "text-muted-foreground", b.count === 0 && "opacity-40")}>
                  {b.count}
                </span>
                <span
                  className={cn("block w-full max-w-8 rounded-t-sm bg-primary transition-[height,opacity] duration-300", selected != null && !on && "opacity-25")}
                  style={{ height: h }}
                />
                <span className="h-px w-full bg-border" aria-hidden />
                <span className={cn("pb-1 text-[11px] leading-tight whitespace-nowrap", on ? "font-medium" : "text-muted-foreground", i % 2 === 1 && "max-sm:invisible")}>
                  {i === 0 ? "Esta" : b.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {node}
    </div>
  );
}
