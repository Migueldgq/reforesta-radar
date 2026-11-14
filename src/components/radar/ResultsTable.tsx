"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import type { Opportunity, OpportunityKind } from "@/lib/opportunity";
import { daysLeft, fmtEuros, parseDay, tidy, TIER_LABELS, TRIAGE_ORDER, type Triage } from "./model";
import { useRadar } from "./store";
import { Button, cx, DeadlineChip, EmptyState, TriageSelect } from "./ui";

export const KIND_SHORT: Record<OpportunityKind, string> = {
  subvencion: "Subvención",
  licitacion: "Licitación",
  boletin: "Boletín",
  europa: "Europa",
  empresa: "Empresa",
};

type Col = "score" | "titulo" | "kind" | "source" | "region" | "deadline" | "budget" | "triage";
type Dir = "asc" | "desc";

const DEFAULT_DIR: Record<Col, Dir> = {
  score: "desc",
  titulo: "asc",
  kind: "asc",
  source: "asc",
  region: "asc",
  deadline: "asc",
  budget: "desc",
  triage: "asc",
};

const coll = new Intl.Collator("es", { sensitivity: "base" });

function compare(a: Opportunity, b: Opportunity, col: Col, triageOf: (id: string) => Triage): number {
  switch (col) {
    case "score":
      return a.fit.score - b.fit.score;
    case "titulo":
      return coll.compare(a.titulo, b.titulo);
    case "kind":
      return coll.compare(KIND_SHORT[a.kind], KIND_SHORT[b.kind]);
    case "source":
      return coll.compare(a.sourceLabel, b.sourceLabel);
    case "region":
      return coll.compare(a.region, b.region);
    case "deadline": {
      const da = daysLeft(a);
      const db = daysLeft(b);
      // Closed and undated go last when ascending
      const va = da == null ? 1e6 : da < 0 ? 1e5 - da : da;
      const vb = db == null ? 1e6 : db < 0 ? 1e5 - db : db;
      return va - vb;
    }
    case "budget":
      return (a.budget ?? -1) - (b.budget ?? -1);
    case "triage":
      return TRIAGE_ORDER.indexOf(triageOf(a.id)) - TRIAGE_ORDER.indexOf(triageOf(b.id));
  }
}

const fmtDate = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function ResultsTable({ items, onClear, resetKey }: { items: Opportunity[]; onClear: () => void; resetKey: string }) {
  const { triageOf, openDetail } = useRadar();
  const [sort, setSort] = useState<{ col: Col; dir: Dir }>({ col: "score", dir: "desc" });
  const [size, setSize] = useState(25);
  const [pg, setPg] = useState({ k: resetKey, n: 0 });
  const page = pg.k === resetKey ? pg.n : 0;
  const setPage = (n: number) => setPg({ k: resetKey, n });

  const sorted = useMemo(() => {
    const m = sort.dir === "asc" ? 1 : -1;
    return [...items].sort((a, b) => m * compare(a, b, sort.col, triageOf) || b.fit.score - a.fit.score);
  }, [items, sort, triageOf]);

  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const p = Math.min(page, pages - 1);
  const rows = sorted.slice(p * size, p * size + size);

  const onSort = (col: Col) => {
    setSort((s) => (s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: DEFAULT_DIR[col] }));
    setPage(0);
  };

  const th = (col: Col, label: string, className = "", align: "left" | "right" = "left") => {
    const on = sort.col === col;
    const Icon = on ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
    return (
      <th
        scope="col"
        aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        className={cx(
          "sticky top-[var(--header-h)] z-10 border-b border-stone-200 bg-white/95 px-3 py-0 font-normal backdrop-blur lg:top-[calc(var(--header-h)+var(--filters-h,0px))]",
          className,
        )}
      >
        <button
          type="button"
          onClick={() => onSort(col)}
          className={cx(
            "group inline-flex h-10 w-full cursor-pointer items-center gap-1 text-xs font-medium whitespace-nowrap",
            align === "right" && "justify-end",
            on ? "text-stone-900" : "text-stone-500 hover:text-stone-800",
          )}
        >
          {label}
          <Icon className={cx("h-3.5 w-3.5", on ? "text-stone-700" : "text-stone-300 group-hover:text-stone-400")} aria-hidden />
        </button>
      </th>
    );
  };

  if (sorted.length === 0)
    return (
      <div className="rounded-2xl border border-stone-200/80 bg-white">
        <EmptyState
          title="Ninguna convocatoria cumple todos estos filtros"
          body="Quita alguno de los filtros de arriba o busca con otras palabras."
          action={
            <Button variant="secondary" onClick={onClear}>
              Limpiar filtros
            </Button>
          }
        />
      </div>
    );

  return (
    <div className="rounded-2xl border border-stone-200/80 bg-white">
      {/* Desktop / tablet: real table */}
      <table className="hidden w-full table-fixed border-separate border-spacing-0 text-sm md:table">
        <caption className="sr-only">Convocatorias filtradas. Pulsa una fila para ver el detalle.</caption>
        <thead>
          <tr>
            {th("score", "Encaje", "w-[76px] rounded-tl-2xl pl-5")}
            {th("titulo", "Convocatoria")}
            {th("kind", "Tipo", "hidden w-[108px] xl:table-cell")}
            {th("source", "Fuente", "w-[124px]")}
            {th("region", "Territorio", "hidden w-[140px] lg:table-cell")}
            {th("deadline", "Plazo", "w-[164px]")}
            {th("budget", "Importe", "w-[112px]", "right")}
            {th("triage", "Seguimiento", "w-[156px] rounded-tr-2xl pr-5")}
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <Row key={o.id} o={o} onOpen={() => openDetail(o.id)} />
          ))}
        </tbody>
      </table>

      {/* Mobile: stacked cards */}
      <ul className="divide-y divide-stone-100 md:hidden">
        {rows.map((o) => (
          <MobileCard key={o.id} o={o} onOpen={() => openDetail(o.id)} />
        ))}
      </ul>

      <Pager
        total={sorted.length}
        page={p}
        pages={pages}
        size={size}
        onPage={setPage}
        onSize={(n) => {
          setSize(n);
          setPage(0);
        }}
      />
    </div>
  );
}

function Score({ o, size = "md" }: { o: Opportunity; size?: "sm" | "md" }) {
  const t = o.fit.tier;
  return (
    <span
      title={`${TIER_LABELS[t]}: ${o.fit.score} de 100`}
      className={cx(
        "inline-grid shrink-0 place-items-center rounded-lg font-semibold tabular-nums",
        size === "md" ? "h-9 w-9 text-sm" : "h-8 w-8 text-[13px]",
        t === "alto" ? "bg-brand-800 text-white" : t === "medio" ? "bg-brand-100 text-brand-900" : "bg-stone-100 text-stone-500",
      )}
    >
      {o.fit.score}
      <span className="sr-only"> · {TIER_LABELS[t]}</span>
    </span>
  );
}

function DeadlineCell({ o }: { o: Opportunity }) {
  const d = parseDay(o.deadline);
  return (
    <div className="flex flex-col items-start gap-1">
      <DeadlineChip o={o} />
      {d != null && <span className="pl-0.5 text-xs text-stone-500 tabular-nums">{fmtDate.format(d).replace(".", "")}</span>}
    </div>
  );
}

function Amount({ o }: { o: Opportunity }) {
  const a = fmtEuros(o.budget);
  if (a) return <span className="text-stone-900 tabular-nums">{a}</span>;
  if (o.amountText) return <span className="text-xs leading-snug text-stone-600">{o.amountText}</span>;
  return <span className="text-stone-300">—</span>;
}

function Row({ o, onOpen }: { o: Opportunity; onOpen: () => void }) {
  const td = "border-b border-stone-100 px-3 py-3.5 align-top group-last:border-b-0";
  return (
    <tr onClick={onOpen} className="group cursor-pointer transition-colors hover:bg-stone-50/80">
      <td className={cx(td, "pl-5")}>
        <Score o={o} />
      </td>
      <td className={td}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="block w-full cursor-pointer text-left focus-visible:rounded-sm"
        >
          <span className="line-clamp-2 leading-snug font-medium text-stone-900 group-hover:text-brand-900">{tidy(o.titulo)}</span>
          <span className="mt-0.5 block truncate text-xs text-stone-500">{tidy(o.organismo)}</span>
        </button>
      </td>
      <td className={cx(td, "hidden text-stone-700 xl:table-cell")}>{KIND_SHORT[o.kind]}</td>
      <td className={cx(td, "text-stone-700")}>
        <span className="line-clamp-2">{o.sourceLabel}</span>
      </td>
      <td className={cx(td, "hidden text-stone-700 lg:table-cell")}>
        <span className="line-clamp-2">{o.region}</span>
      </td>
      <td className={td}>
        <DeadlineCell o={o} />
      </td>
      <td className={cx(td, "text-right")}>
        <Amount o={o} />
      </td>
      <td className={cx(td, "pr-5")} onClick={(e) => e.stopPropagation()}>
        <TriageSelect o={o} />
      </td>
    </tr>
  );
}

function MobileCard({ o, onOpen }: { o: Opportunity; onOpen: () => void }) {
  return (
    <li className="relative flex gap-3 px-4 py-4">
      <Score o={o} size="sm" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="truncate text-xs text-stone-500">
          {KIND_SHORT[o.kind]} · {o.sourceLabel} · {o.region}
        </p>
        <button type="button" onClick={onOpen} className="block text-left after:absolute after:inset-0 after:content-['']">
          <span className="line-clamp-3 text-[15px] leading-snug font-medium text-stone-900">{tidy(o.titulo)}</span>
        </button>
        <p className="truncate text-xs text-stone-500">{tidy(o.organismo)}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-0.5">
          <DeadlineChip o={o} />
          <span className="text-sm">
            <Amount o={o} />
          </span>
          <span className="relative z-10 ml-auto">
            <TriageSelect o={o} />
          </span>
        </div>
      </div>
    </li>
  );
}

function Pager({
  total,
  page,
  pages,
  size,
  onPage,
  onSize,
}: {
  total: number;
  page: number;
  pages: number;
  size: number;
  onPage: (p: number) => void;
  onSize: (n: number) => void;
}) {
  const from = page * size + 1;
  const to = Math.min(total, from + size - 1);
  const btn =
    "grid h-8 min-w-8 cursor-pointer place-items-center rounded-lg px-2 text-sm tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const nums: (number | "…")[] = [];
  for (let i = 0; i < pages; i++) {
    if (i === 0 || i === pages - 1 || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 px-4 py-3 sm:px-5">
      <p className="text-sm text-stone-500 tabular-nums">
        <span className="font-medium text-stone-800">
          {from}–{to}
        </span>{" "}
        de {total}
      </p>
      <nav aria-label="Páginas" className="flex items-center gap-1">
        <button type="button" className={cx(btn, "hover:bg-stone-100")} disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Página anterior">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        {nums.map((n, i) =>
          n === "…" ? (
            <span key={`e${i}`} className="px-1 text-stone-400">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              aria-current={n === page ? "page" : undefined}
              onClick={() => onPage(n)}
              className={cx(btn, n === page ? "bg-stone-900 font-medium text-white" : "text-stone-600 hover:bg-stone-100")}
            >
              {n + 1}
            </button>
          ),
        )}
        <button
          type="button"
          className={cx(btn, "hover:bg-stone-100")}
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
          aria-label="Página siguiente"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </nav>
      <label className="flex items-center gap-2 text-sm text-stone-500">
        Por página
        <select
          value={size}
          onChange={(e) => onSize(Number(e.target.value))}
          className="h-8 cursor-pointer rounded-lg border border-stone-200 bg-white px-2 text-sm text-stone-800"
        >
          {[25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

