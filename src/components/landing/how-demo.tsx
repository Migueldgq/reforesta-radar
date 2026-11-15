import type { CSSProperties } from "react";
import { CircleCheck } from "lucide-react";
import { tidy } from "@/components/radar/model";
import type { LandingData } from "./data";

/*
 * Three small scenes for "Encuentra → Prioriza → Sigue". Final state is the default render;
 * landing.css only rewinds them (under html.lp-ready and no-preference) until their step scrolls in.
 */

const v = (o: Record<string, string | number>) => o as CSSProperties;

export function FindScene({ data }: { data: LandingData | null }) {
  const names = data
    ? [...data.sources].sort((a, b) => b.count - a.count).slice(0, 5).map((s) => s.name.split(" · ")[0])
    : ["BDNS", "BOE", "UE", "BOCM", "DOG"];
  return (
    <div className="lp-scene grid h-full grid-cols-[auto_1fr] items-center gap-4" aria-hidden>
      <ul className="space-y-1.5">
        {names.map((n, i) => (
          <li key={n} className="lp-src rounded-full border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground" style={v({ "--i": i })}>
            {n}
          </li>
        ))}
      </ul>
      <div className="rounded-lg border bg-background p-2.5">
        <p className="text-[10px] font-medium text-muted-foreground">Una lista</p>
        <ul className="mt-2 space-y-1.5">
          {names.map((n, i) => (
            <li key={n} className="lp-line flex items-center gap-2" style={v({ "--i": i })}>
              <span className="h-1.5 flex-1 rounded-full bg-border" />
              <span className="max-w-16 truncate text-[10px] text-muted-foreground">{n}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const ROW = 40; // px per row in the sort scene (row 32 + gap 8)
const START_ORDER = [2, 0, 3, 1]; // shown unsorted first, then slides into score order

export function RankScene({ data }: { data: LandingData | null }) {
  const rows = (data?.topOpen.slice(0, 4) ?? []).map((o) => ({ id: o.id, score: o.fit.score, title: tidy(o.titulo) }));
  const items = rows.length === 4 ? rows : [88, 74, 61, 45].map((score, i) => ({ id: String(i), score, title: "" }));
  return (
    <div className="lp-scene relative h-full" aria-hidden>
      {items.map((r, sorted) => (
        <div
          key={r.id}
          className="lp-rank absolute inset-x-0 top-0 flex h-8 items-center gap-2 rounded-md border bg-background px-2"
          style={v({ "--from": `${START_ORDER.indexOf(sorted) * ROW}px`, "--to": `${sorted * ROW}px` })}
        >
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground tabular-nums">
            <CircleCheck className="size-3" />
            {rows.length === 4 ? r.score : ""}
          </span>
          {r.title ? (
            <span className="truncate text-[11px]">{r.title}</span>
          ) : (
            <span className="h-1.5 flex-1 rounded-full bg-border" />
          )}
        </div>
      ))}
    </div>
  );
}

const COLS = ["En estudio", "A presentar", "Presentada", "Descartada"];

export function TrackScene({ data }: { data: LandingData | null }) {
  const title = data?.topOpen[0] ? tidy(data.topOpen[0].titulo) : "";
  return (
    <div className="lp-scene relative grid h-full grid-cols-4 gap-1.5" aria-hidden>
      {COLS.map((c) => (
        <div key={c} className="rounded-md border border-dashed p-1.5">
          <p className="truncate text-[9px] font-medium text-muted-foreground">{c}</p>
        </div>
      ))}
      <div className="lp-card absolute top-6 left-0 w-[calc((100%-1.125rem)/4)] rounded-md border bg-background p-1.5 shadow-sm">
        <span className="block h-1.5 w-8 rounded-full bg-primary" />
        {title ? <span className="mt-1.5 line-clamp-3 text-[9px] leading-tight">{title}</span> : <span className="mt-1.5 block h-1.5 rounded-full bg-border" />}
      </div>
    </div>
  );
}
