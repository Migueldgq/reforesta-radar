"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BarList, type BarRow } from "./charts";
import { INSET_BORDER, MAP_HEIGHT, MAP_REGIONS, MAP_WIDTH, type MapRegion } from "./spain-map-data";

/** A region drawn as a small circle ("M x,y a8,8 …"): Ceuta and Melilla. */
const DOT = /^M([\d.]+),([\d.]+)a8,8 /;

/** Region strings in the data that belong to the same shape (the sources are not consistent). */
const ALIASES: Record<string, string[]> = {
  Asturias: ["Asturias", "Principado de Asturias"],
};
const keysOf = (name: string) => ALIASES[name] ?? [name];
const SHAPE_KEYS = new Set(MAP_REGIONS.flatMap((r) => keysOf(r.name)));

/** Five sequential classes of the primary hue over the card surface; zero stays neutral. */
const STEPS = [22, 40, 58, 78, 100];
const stepFill = (i: number) => `color-mix(in oklab, var(--primary) ${STEPS[i]}%, var(--card))`;
const classOf = (count: number, max: number) => Math.min(STEPS.length - 1, Math.floor((count / max) * STEPS.length - 1e-9));

const plural = (n: number) => `${n} ${n === 1 ? "convocatoria" : "convocatorias"}`;

export function TerritoryPanel({
  rows,
  open,
  selected,
  onToggle,
  total,
}: {
  /** The Territorio aggregation (counts follow every other active filter). */
  rows: BarRow[];
  /** Open-now counts per region key, over the same subset. */
  open: Map<string, number>;
  selected: string[];
  onToggle: (key: string) => void;
  total: number;
}) {
  const [asList, setAsList] = useState(false);
  const switcher = (
    <button
      type="button"
      onClick={() => setAsList((v) => !v)}
      className="relative cursor-pointer rounded px-1.5 text-xs font-medium text-primary after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] hover:underline"
    >
      {asList ? "Ver mapa" : "Ver lista"}
    </button>
  );
  if (asList)
    return (
      <div className="relative min-w-0">
        <div className="absolute top-5 right-4 z-10">{switcher}</div>
        <BarList title="Territorio" rows={rows} selected={selected} onToggle={onToggle} total={total} maxRows={8} />
      </div>
    );
  return <SpainMap rows={rows} open={open} selected={selected} onToggle={onToggle} switcher={switcher} />;
}

function SpainMap({
  rows,
  open,
  selected,
  onToggle,
  switcher,
}: {
  rows: BarRow[];
  open: Map<string, number>;
  selected: string[];
  onToggle: (key: string) => void;
  switcher: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  // Tooltip follows the pointer (or sits on the focused shape) and flips below near the top edge.
  const [tip, setTip] = useState<{ x: number; y: number; w: number; content: ReactNode } | null>(null);
  const countOf = (key: string) => rows.find((r) => r.key === key)?.count ?? 0;
  const sum = (keys: string[], f: (k: string) => number) => keys.reduce((s, k) => s + f(k), 0);

  const regions = MAP_REGIONS.map((r) => {
    const keys = keysOf(r.name);
    return {
      ...r,
      keys,
      count: sum(keys, countOf),
      open: sum(keys, (k) => open.get(k) ?? 0),
      on: keys.some((k) => selected.includes(k)),
    };
  });
  const max = Math.max(1, ...regions.map((r) => r.count));
  const hasSel = selected.length > 0;
  // Everything with no shape (Estatal, Unión Europea, Sin determinar, anything unexpected) stays reachable as a chip.
  const others = rows.filter((r) => !SHAPE_KEYS.has(r.key) && (r.count > 0 || selected.includes(r.key))).sort((a, b) => b.count - a.count);

  const toggleRegion = (r: (typeof regions)[number]) => {
    if (r.on) r.keys.filter((k) => selected.includes(k)).forEach(onToggle);
    else r.keys.forEach(onToggle);
  };
  const onKey = (e: KeyboardEvent, r: (typeof regions)[number]) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleRegion(r);
    }
  };
  const tipFor = (r: (typeof regions)[number]) => (
    <>
      <span className="block font-medium">{r.name}</span>
      <span className="block tabular-nums">{plural(r.count)}</span>
      <span className="opacity-70 tabular-nums">
        {r.open} {r.open === 1 ? "abierta" : "abiertas"} ahora{r.on ? " · seleccionada" : ""}
      </span>
    </>
  );
  const enter = (r: (typeof regions)[number], at: { x: number; y: number }) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setActive(r.name);
    setTip({ x: at.x - box.left, y: at.y - box.top, w: box.width, content: tipFor(r) });
  };
  const centerOf = (el: Element) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  };
  const leave = () => {
    setActive(null);
    setTip(null);
  };
  const outline = (r: MapRegion, stroke: string, width: number) => (
    <path d={r.d} fill="none" stroke={stroke} strokeWidth={width} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
  );

  return (
    <div ref={ref} className="relative flex min-w-0 flex-col gap-3 p-5" onPointerLeave={leave}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Territorio</h2>
        <div className="flex items-center gap-1">
          {hasSel && (
            <button
              type="button"
              onClick={() => selected.forEach(onToggle)}
              className="relative cursor-pointer rounded px-1.5 text-xs font-medium text-muted-foreground after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] hover:text-foreground hover:underline"
            >
              Quitar selección
            </button>
          )}
          {switcher}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        className="mx-auto block h-auto w-full max-w-[420px] select-none lg:max-h-[300px]"
        role="group"
        aria-label="Mapa de convocatorias por comunidad autónoma. Pulsa una comunidad para filtrar."
      >
        <path d={INSET_BORDER} fill="none" stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {regions.map((r) => (
          <path
            key={r.id}
            d={r.d}
            role="button"
            tabIndex={0}
            aria-pressed={r.on}
            aria-label={`${r.name}: ${plural(r.count)}`}
            fill={r.count ? stepFill(classOf(r.count, max)) : "var(--muted)"}
            stroke="var(--card)"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className={cn("cursor-pointer outline-none transition-opacity duration-200", hasSel && !r.on && "opacity-35")}
            onClick={() => toggleRegion(r)}
            onKeyDown={(e) => onKey(e, r)}
            onPointerMove={(e) => enter(r, { x: e.clientX, y: e.clientY })}
            onFocus={(e) => enter(r, centerOf(e.currentTarget))}
            onBlur={leave}
          />
        ))}
        {/* Ceuta and Melilla are 8-unit dots: a larger invisible circle takes the tap (the path stays the accessible button). */}
        {regions.map((r) => {
          const dot = DOT.exec(r.d);
          return dot ? (
            <circle
              key={`hit-${r.id}`}
              cx={Number(dot[1]) + 8}
              cy={Number(dot[2])}
              r={25}
              fill="transparent"
              aria-hidden
              className="cursor-pointer"
              onClick={() => toggleRegion(r)}
              onPointerMove={(e) => enter(r, { x: e.clientX, y: e.clientY })}
            />
          ) : null;
        })}
        <g pointerEvents="none">
          {regions
            .filter((r) => r.on)
            .map((r) => (
              <g key={r.id}>
                {outline(r, "var(--card)", 5)}
                {outline(r, "var(--primary)", 2.5)}
              </g>
            ))}
          {regions
            .filter((r) => r.name === active)
            .map((r) => (
              <g key={r.id}>{outline(r, "var(--foreground)", 1.5)}</g>
            ))}
          {regions.map((r) => (
            <text
              key={r.id}
              x={r.labelX}
              y={r.labelY}
              dy="0.35em"
              textAnchor="middle"
              fontSize={20}
              className={cn("tabular-nums transition-opacity", r.count ? "fill-foreground font-medium" : "fill-muted-foreground", hasSel && !r.on && "opacity-50")}
              stroke="var(--card)"
              strokeWidth={4}
              strokeLinejoin="round"
              paintOrder="stroke"
              aria-hidden
            >
              {r.count}
            </text>
          ))}
        </g>
      </svg>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap gap-1.5">
          {others.map((r) => {
            const on = selected.includes(r.key);
            return (
              <button
                key={r.key}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(r.key)}
                className={cn(
                  "inline-flex h-6 cursor-pointer items-center rounded-full border px-2.5 text-xs tabular-nums transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  on ? "border-primary font-medium ring-1 ring-primary" : "text-muted-foreground",
                )}
              >
                {r.label} ({r.count})
              </button>
            );
          })}
        </div>
        <Legend max={max} />
      </div>
      {tip && (
        <div
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-20 w-max max-w-[220px] -translate-x-1/2 rounded-md bg-foreground px-3 py-2 text-xs leading-snug text-background",
            tip.y > 90 && "-translate-y-full",
          )}
          style={{ left: Math.min(Math.max(tip.x, 100), tip.w - 100), top: tip.y > 90 ? tip.y - 14 : tip.y + 18 }}
        >
          {tip.content}
        </div>
      )}
    </div>
  );
}

function Legend({ max }: { max: number }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums" aria-label={`Escala: de 1 a ${max} convocatorias`}>
      <span className="size-2.5 rounded-[2px] bg-muted" title="Ninguna" aria-hidden />
      <span className="mr-1">0</span>
      <span>1</span>
      <span className="flex gap-[2px]" aria-hidden>
        {STEPS.map((_, i) => (
          <span key={i} className="h-2.5 w-4 first:rounded-l-[2px] last:rounded-r-[2px]" style={{ background: stepFill(i) }} />
        ))}
      </span>
      <span>{max}</span>
    </div>
  );
}
