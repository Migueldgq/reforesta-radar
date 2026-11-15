"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import type { Opportunity, OpportunityKind } from "@/lib/opportunity";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { daysLeft, fmtEuros, tidy, TRIAGE_ORDER, type Triage } from "./model";
import { useRadar } from "./store";
import { Deadline, EmptyState, ScoreChip, TriageSelect } from "./ui";

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

  return (
    <div className="rounded-lg border">
      {/* Tablet / desktop */}
      <div className="hidden md:block">
        <Table className="table-fixed">
          <caption className="sr-only">Convocatorias filtradas. Pulsa una fila para ver el detalle.</caption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {th("score", "Encaje", "w-[68px] pl-2")}
              {th("titulo", "Convocatoria")}
              {th("kind", "Tipo", "hidden w-[100px] xl:table-cell")}
              {th("source", "Fuente", "w-[104px]")}
              {th("region", "Territorio", "hidden w-[112px] lg:table-cell")}
              {th("deadline", "Plazo", "w-[132px]")}
              {th("budget", "Importe", "w-[96px]", "right")}
              {th("triage", "Seguimiento", "w-[148px] pr-4")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((o) => (
              <Row key={o.id} o={o} onOpen={() => openDetail(o.id)} />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards */}
      <ul className="divide-y md:hidden">
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

function Row({ o, onOpen }: { o: Opportunity; onOpen: () => void }) {
  const title = tidy(o.titulo);
  return (
    <TableRow onClick={onOpen} className="cursor-pointer">
      <TableCell className="py-3 pl-4">
        <ScoreChip fit={o.fit} />
      </TableCell>
      <TableCell className="py-3 whitespace-normal">
        <button
          type="button"
          title={title}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="block w-full cursor-pointer rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="line-clamp-2 leading-snug font-medium break-words">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{tidy(o.organismo)}</span>
        </button>
      </TableCell>
      <TableCell className="hidden py-3 xl:table-cell">
        <Badge variant="outline" className="font-normal">
          {KIND_SHORT[o.kind]}
        </Badge>
      </TableCell>
      <TableCell className="truncate py-3 text-muted-foreground" title={o.sourceLabel}>
        {o.sourceLabel}
      </TableCell>
      <TableCell className="hidden truncate py-3 text-muted-foreground lg:table-cell" title={o.region}>
        {o.region}
      </TableCell>
      <TableCell className="py-3">
        <Deadline o={o} />
      </TableCell>
      <TableCell className="py-3 text-right whitespace-normal">
        <Amount o={o} />
      </TableCell>
      <TableCell className="py-3 pr-4" onClick={(e) => e.stopPropagation()}>
        <TriageSelect o={o} />
      </TableCell>
    </TableRow>
  );
}

function MobileCard({ o, onOpen }: { o: Opportunity; onOpen: () => void }) {
  return (
    <li className="relative flex gap-3 px-4 py-4">
      <ScoreChip fit={o.fit} />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="truncate text-xs text-muted-foreground">
          {KIND_SHORT[o.kind]} · {o.sourceLabel} · {o.region}
        </p>
        <button type="button" onClick={onOpen} className="block text-left after:absolute after:inset-0 after:content-['']">
          <span className="line-clamp-3 leading-snug font-medium">{tidy(o.titulo)}</span>
        </button>
        <p className="truncate text-xs text-muted-foreground">{tidy(o.organismo)}</p>
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
