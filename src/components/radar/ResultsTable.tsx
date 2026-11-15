"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { Opportunity, OpportunityKind } from "@/lib/opportunity";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtEuros, parseDay, reforestaWins, sourceLabelOf, territoryOf, tidy, TRIAGE_ORDER, type Triage } from "./model";
import { useRadar } from "./store";
import { AiDoubtChip, Deadline, EmptyState, ScoreChip, TriageSelect, WonMarker } from "./ui";

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

const hasBudget = (o: Opportunity) => o.budget != null && o.budget > 0;

/**
 * Rows without a value go last whichever the direction: 0 = has one (sorted), 1 = Importe as text only, 2 = nothing.
 */
function group(o: Opportunity, col: Col): number {
  if (col === "budget") return hasBudget(o) ? 0 : o.amountText ? 1 : 2;
  if (col === "deadline") return parseDay(o.deadline) != null ? 0 : 1;
  return 0;
}

/** Only called for two rows in group 0. */
function compare(a: Opportunity, b: Opportunity, col: Col, triageOf: (id: string) => Triage): number {
  switch (col) {
    case "score":
      return a.fit.score - b.fit.score;
    case "titulo":
      return coll.compare(a.titulo, b.titulo);
    case "kind":
      return coll.compare(KIND_SHORT[a.kind], KIND_SHORT[b.kind]);
    case "source":
      return coll.compare(sourceLabelOf(a), sourceLabelOf(b));
    case "region":
      return coll.compare(territoryOf(a), territoryOf(b));
    case "deadline":
      // The actual date, year included (closed calls on "Todas" sort among the rest by their date).
      return parseDay(a.deadline)! - parseDay(b.deadline)!;
    case "budget":
      return a.budget! - b.budget!;
    case "triage":
      return TRIAGE_ORDER.indexOf(triageOf(a.id)) - TRIAGE_ORDER.indexOf(triageOf(b.id));
  }
}

export function ResultsTable({ items, onClear }: { items: Opportunity[]; onClear: () => void }) {
  // The page lives in the store (and the URL, `?pagina=`); any filter change takes it back to the first one.
  const { triageOf, openDetail, page, setPage } = useRadar();
  const [sort, setSort] = useState<{ col: Col; dir: Dir }>({ col: "score", dir: "desc" });
  const [size, setSize] = useState(25);
  const top = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => {
    const m = sort.dir === "asc" ? 1 : -1;
    return [...items].sort(
      (a, b) => group(a, sort.col) - group(b, sort.col) || (group(a, sort.col) === 0 ? m * compare(a, b, sort.col, triageOf) : 0) || b.fit.score - a.fit.score,
    );
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
      <TableHead aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("h-11 px-2", className, align === "right" && "text-right")}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSort(col)}
          className={cn("h-8 gap-1 px-2 text-xs font-medium", on ? "text-foreground" : "text-muted-foreground", align === "right" && "-mr-2")}
        >
          {label}
          <Icon className={cn("size-3.5", !on && "opacity-50")} aria-hidden />
        </Button>
      </TableHead>
    );
  };

  if (sorted.length === 0)
    return (
      <div className="rounded-lg border">
        <EmptyState
          title="Ninguna convocatoria cumple todos estos filtros"
          body="Quita alguno de los filtros de arriba o busca con otras palabras."
          action={
            <Button variant="outline" onClick={onClear}>
              Limpiar filtros
            </Button>
          }
        />
      </div>
    );

  // Columns follow the table's own width (the sidebar may be open or not), not the viewport.
  // Lowest priority goes first: Tipo, Fuente, Importe, Territorio; below 41rem, cards.
  return (
    <div ref={top} className="@container scroll-mt-16 rounded-lg border">
      {/* Wide container: table */}
      <div className="hidden @min-[41rem]:block">
        <Table className="table-fixed">
          <caption className="sr-only">Convocatorias filtradas. Pulsa una fila para ver el detalle.</caption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {th("score", "Encaje", "w-[84px] pl-2 pr-0")}
              {th("titulo", "Convocatoria")}
              {th("kind", "Tipo", "hidden w-[100px] @min-[67rem]:table-cell")}
              {th("source", "Fuente", "hidden w-[104px] @min-[60.5rem]:table-cell")}
              {th("region", "Territorio", "hidden w-[112px] @min-[48rem]:table-cell")}
              {th("deadline", "Plazo", "w-[132px]")}
              {th("budget", "Importe", "hidden w-[96px] @min-[54rem]:table-cell", "right")}
              {th("triage", "Seguimiento", "w-[148px] pr-4")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((o) => (
              <Row key={o.id} o={o} onOpen={(el) => openDetail(o.id, el)} />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Narrow container: cards */}
      <ul className="divide-y @min-[41rem]:hidden">
        {rows.map((o) => (
          <MobileCard key={o.id} o={o} onOpen={(el) => openDetail(o.id, el)} />
        ))}
      </ul>

      <Pager
        total={sorted.length}
        page={p}
        pages={pages}
        size={size}
        onPage={(n) => {
          setPage(n);
          // Back to the top of the results, where the new page starts.
          requestAnimationFrame(() => {
            if (top.current && top.current.getBoundingClientRect().top < 0) top.current.scrollIntoView({ block: "start" });
          });
        }}
        onSize={(n) => {
          setSize(n);
          setPage(0);
        }}
      />
    </div>
  );
}

function Amount({ o }: { o: Opportunity }) {
  const a = fmtEuros(o.budget);
  if (a) return <span className="tabular-nums">{a}</span>;
  if (o.amountText)
    return (
      <span className="line-clamp-2 text-xs text-muted-foreground" title={o.amountText}>
        {o.amountText}
      </span>
    );
  return <span className="text-muted-foreground">—</span>;
}

function Row({ o, onOpen }: { o: Opportunity; onOpen: (opener: HTMLElement | null) => void }) {
  const title = tidy(o.titulo);
  const amount = fmtEuros(o.budget);
  const btn = useRef<HTMLButtonElement>(null);
  const territory = territoryOf(o);
  return (
    <TableRow onClick={() => onOpen(btn.current)} className="cursor-pointer">
      <TableCell className="py-3 pl-4">
        <ScoreChip fit={o.fit} />
      </TableCell>
      <TableCell className="py-3 whitespace-normal">
        <button
          ref={btn}
          type="button"
          title={title}
          data-opener={o.id}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(e.currentTarget);
          }}
          className="block w-full cursor-pointer rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="line-clamp-2 leading-snug font-medium break-words">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {/* What the hidden columns would show */}
            {reforestaWins(o).length > 0 && (
              <>
                <WonMarker o={o} className="align-[-2px]" /> ·{" "}
              </>
            )}
            <span className="@min-[60.5rem]:hidden">{sourceLabelOf(o)} · </span>
            <span className="@min-[48rem]:hidden">{territory} · </span>
            {amount && <span className="@min-[54rem]:hidden">{amount} · </span>}
            {o.organismo}
          </span>
        </button>
        <AiDoubtChip o={o} className="mt-1.5" />
      </TableCell>
      <TableCell className="hidden py-3 @min-[67rem]:table-cell">
        <Badge variant="outline" className="font-normal">
          {KIND_SHORT[o.kind]}
        </Badge>
      </TableCell>
      <TableCell className="hidden truncate py-3 text-muted-foreground @min-[60.5rem]:table-cell" title={sourceLabelOf(o)}>
        {sourceLabelOf(o)}
      </TableCell>
      {/* Two lines rather than cutting "Comunidad de Madrid" short. */}
      <TableCell className="hidden py-3 whitespace-normal text-muted-foreground @min-[48rem]:table-cell" title={territory}>
        <span className="line-clamp-2 leading-snug break-words">{territory}</span>
      </TableCell>
      <TableCell className="py-3">
        <Deadline o={o} />
      </TableCell>
      <TableCell className="hidden py-3 text-right whitespace-normal @min-[54rem]:table-cell">
        <Amount o={o} />
      </TableCell>
      <TableCell className="py-3 pr-4" onClick={(e) => e.stopPropagation()}>
        <TriageSelect o={o} />
      </TableCell>
    </TableRow>
  );
}

function MobileCard({ o, onOpen }: { o: Opportunity; onOpen: (opener: HTMLElement | null) => void }) {
  return (
    <li className="relative flex gap-3 px-4 py-4">
      <ScoreChip fit={o.fit} />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="truncate text-xs text-muted-foreground">
          {KIND_SHORT[o.kind]} · {sourceLabelOf(o)} · {territoryOf(o)}
        </p>
        <button type="button" data-opener={o.id} onClick={(e) => onOpen(e.currentTarget)} className="block text-left after:absolute after:inset-0 after:content-['']">
          <span className="line-clamp-3 leading-snug font-medium">{tidy(o.titulo)}</span>
        </button>
        <p className="truncate text-xs text-muted-foreground">{o.organismo}</p>
        <WonMarker o={o} className="flex w-fit" />
        <AiDoubtChip o={o} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-0.5">
          <Deadline o={o} />
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
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
      <p className="text-sm text-muted-foreground tabular-nums">
        <span className="font-medium text-foreground">
          {from}–{to}
        </span>{" "}
        de {total}
      </p>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="hidden sm:inline">Filas por página</span>
          <Select value={String(size)} onValueChange={(v) => onSize(Number(v))}>
            <SelectTrigger size="sm" className="w-[72px]" aria-label="Filas por página">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">
          Página {page + 1} de {pages}
        </span>
        <nav aria-label="Páginas" className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-8" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Página anterior">
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="outline" size="icon" className="size-8" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="Página siguiente">
            <ChevronRight aria-hidden />
          </Button>
        </nav>
      </div>
    </div>
  );
}
