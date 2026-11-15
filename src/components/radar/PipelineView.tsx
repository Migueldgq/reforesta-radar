"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, GripVertical, ListChecks, MessageSquare } from "lucide-react";
import { useRef, useState } from "react";
import type { Opportunity } from "@/lib/opportunity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { daysLeft, ESTIMATE_TIP, fmtDate, tidy, TRIAGE_LABELS, type Triage } from "./model";
import type { BoardItem } from "@/lib/team";
import { stub, useRadar } from "./store";
import { Deadline, GoneNote, PersonAvatar, ScoreChip, TriageSelect } from "./ui";

/* ---------- Seguimiento ---------- */

const COLUMNS: { key: Triage; hint: string }[] = [
  { key: "estudio", hint: "Alguien la está leyendo" },
  { key: "presentar", hint: "Decidido: vamos a por ella" },
  { key: "presentada", hint: "Enviada, a la espera" },
  { key: "descartada", hint: "No encaja o no llegamos" },
];

type Row = { id: string; entry: BoardItem; o: Opportunity | undefined };

export function PipelineView() {
  const { board, boardLoaded, byId } = useRadar();
  const rows: Row[] = Object.values(board)
    .filter((e) => e.status !== "nueva")
    .map((entry) => ({ id: entry.opportunityId, entry, o: entry.gone ? undefined : byId.get(entry.opportunityId) }));
  const dl = (r: Row) => {
    const d = r.o ? daysLeft(r.o) : null;
    return d == null || d < 0 ? Infinity : d;
  };
  rows.sort((a, b) => dl(a) - dl(b));

  const active = rows.filter((r) => r.entry.status === "estudio" || r.entry.status === "presentar");
  const next = active.find((r) => dl(r) !== Infinity);

  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Seguimiento</h1>
        <p className="text-muted-foreground">Lo que estáis mirando, por fecha de cierre. Arrastra una tarjeta o cambia su estado. Lo ve todo el equipo.</p>
      </div>

      {!boardLoaded ? (
        <p className="text-sm text-muted-foreground" role="status">
          Cargando el tablero del equipo…
        </p>
      ) : rows.length === 0 ? (
        <Card className="items-center gap-3 border-dashed px-6 py-16 text-center shadow-none">
          <ListChecks className="size-6 text-muted-foreground" aria-hidden />
          <p className="font-medium">El equipo todavía no sigue ninguna convocatoria</p>
          <p className="max-w-md text-muted-foreground">En Inicio, cambia el estado de una convocatoria a «En estudio» o «A presentar» y aparecerá aquí.</p>
          <Button asChild size="sm" className="mt-2">
            <Link href="/">
              Ir a Inicio <ArrowRight aria-hidden />
            </Link>
          </Button>
        </Card>
      ) : (
        <>
          {next && <NextUp row={next} />}
          <Board rows={rows} />
        </>
      )}
    </div>
  );
}

function NextUp({ row }: { row: Row }) {
  const { openDetail } = useRadar();
  const o = row.o!;
  const d = daysLeft(o) ?? 0;
  return (
    <Card className="relative flex-row items-center gap-4 px-5 py-4 shadow-none transition-colors hover:bg-muted/40">
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-xs text-muted-foreground">Lo siguiente que cierra · {TRIAGE_LABELS[row.entry.status]}</p>
        <h2 className="font-medium leading-snug">
          <button
            type="button"
            data-opener={o.id}
            onClick={(e) => openDetail(o.id, e.currentTarget)}
            className="cursor-pointer text-left outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
          >
            <span className="line-clamp-2">{tidy(o.titulo)}</span>
          </button>
        </h2>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
          <span className="truncate">{o.organismo}</span>
          {o.deadlineEstimated ? (
            <Badge variant="outline" title={ESTIMATE_TIP}>
              <CalendarDays aria-hidden /> Hacia el {fmtDate(o.deadline)} · fecha estimada
            </Badge>
          ) : (
            <Badge variant="outline">
              <CalendarDays aria-hidden /> {fmtDate(o.deadline)}
            </Badge>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right" title={o.deadlineEstimated ? ESTIMATE_TIP : undefined}>
        <p className="text-3xl font-semibold tabular-nums leading-none">
          {o.deadlineEstimated && <span className="text-muted-foreground">≈ </span>}
          {d}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {d === 1 ? "día" : "días"}
          {o.deadlineEstimated && " (estimado)"}
        </p>
      </div>
    </Card>
  );
}

/* ---------- Drag and drop board (pointer events: mouse drags the whole card, touch uses the handle) ---------- */

interface Drag {
  id: string;
  from: Triage;
  x: number;
  y: number;
  dx: number;
  dy: number;
  w: number;
}

const THRESHOLD = 6;

function Board({ rows }: { rows: Row[] }) {
  const { setTriage } = useRadar();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<Triage | null>(null);
  const pending = useRef<{ id: string; from: Triage; x: number; y: number; el: HTMLElement; pointerId: number } | null>(null);
  const suppressClick = useRef(false);

  const columnAt = (x: number, y: number): Triage | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-col]");
    return (el?.dataset.col as Triage | undefined) ?? null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLElement>, row: Row) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target)) return; // events bubbling from the portalled select menu
    const onHandle = !!target.closest("[data-handle]");
    if (e.pointerType !== "mouse" && !onHandle) return; // touch: only the handle drags, so the page still scrolls
    if (!onHandle && target.closest("select, a, [data-slot=select-trigger]")) return;
    pending.current = { id: row.id, from: row.entry.status, x: e.clientX, y: e.clientY, el: e.currentTarget, pointerId: e.pointerId };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pending.current;
    if (!p) return;
    if (!drag) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < THRESHOLD) return;
      const r = p.el.getBoundingClientRect();
      try {
        p.el.setPointerCapture(p.pointerId);
      } catch {
        /* ignore */
      }
      setDrag({ id: p.id, from: p.from, x: e.clientX, y: e.clientY, dx: p.x - r.left, dy: p.y - r.top, w: r.width });
      return;
    }
    setDrag({ ...drag, x: e.clientX, y: e.clientY });
    setOver(columnAt(e.clientX, e.clientY));
  };

  const end = (e: React.PointerEvent) => {
    const p = pending.current;
    pending.current = null;
    if (drag && p) {
      suppressClick.current = true;
      const to = columnAt(e.clientX, e.clientY);
      const row = rows.find((r) => r.id === drag.id);
      if (to && to !== drag.from && row) setTriage(row.o ?? stub(row.entry), to);
    }
    setDrag(null);
    setOver(null);
  };

  const dragged = drag ? rows.find((r) => r.id === drag.id) : undefined;

  return (
    <div
      className="-mx-1 grid gap-6 px-1 pb-2 md:auto-cols-[minmax(250px,1fr)] md:grid-flow-col md:gap-4 md:overflow-x-auto"
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {COLUMNS.map((c) => {
        const list = rows.filter((r) => r.entry.status === c.key);
        const isOver = !!drag && over === c.key && drag.from !== c.key;
        return (
          <section key={c.key} data-col={c.key} aria-labelledby={`col-${c.key}`} className="flex min-w-0 flex-col gap-3">
            <header className="space-y-0.5 px-1">
              <div className="flex items-center gap-2">
                <h2 id={`col-${c.key}`} className="font-medium">
                  {TRIAGE_LABELS[c.key]}
                </h2>
                <Badge variant="secondary" className="tabular-nums">
                  {list.length}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{c.hint}</p>
            </header>
            <div
              className={cn(
                "flex min-h-28 flex-1 flex-col gap-2 rounded-xl border border-transparent p-1 transition-colors",
                isOver && "border-dashed border-border bg-muted",
              )}
            >
              {isOver && (
                <p className={cn("py-2 text-center text-xs text-muted-foreground", list.length === 0 && "grid flex-1 place-items-center")}>Suelta aquí</p>
              )}
              {list.length === 0 && !isOver && (
                <p className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">{drag ? "Suelta aquí" : "Vacío"}</p>
              )}
              {list.map((r) => (
                <TrackCard
                  key={r.id}
                  row={r}
                  muted={c.key === "descartada"}
                  ghost={drag?.id === r.id}
                  onPointerDown={(e) => onPointerDown(e, r)}
                />
              ))}
            </div>
          </section>
        );
      })}
      {drag && dragged && (
        <div
          aria-hidden
          className="pointer-events-none fixed top-0 left-0 z-50"
          style={{ width: drag.w, transform: `translate(${drag.x - drag.dx}px, ${drag.y - drag.dy}px)` }}
        >
          <div className="rounded-xl shadow-lg">
            <TrackCard row={dragged} muted={false} ghost={false} floating />
          </div>
        </div>
      )}
    </div>
  );
}

function TrackCard({
  row,
  muted,
  ghost,
  floating = false,
  onPointerDown,
}: {
  row: Row;
  muted: boolean;
  ghost: boolean;
  floating?: boolean;
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
}) {
  const { openDetail } = useRadar();
  const o = row.o ?? stub(row.entry);
  const notes = row.entry.notes.length;
  return (
    <Card
      onPointerDown={onPointerDown}
      className={cn(
        "group relative gap-3 p-3.5 shadow-none transition-[background-color,opacity] select-none md:cursor-grab",
        !floating && "hover:bg-muted/40",
        // Discarded: a quieter card (no shadow of colour, dashed edge), but the text keeps its contrast.
        muted && "border-dashed bg-transparent",
        ghost && "opacity-30",
        floating && "cursor-grabbing",
      )}
    >
      <div className="space-y-1">
        <h3 className="leading-snug font-medium">
          <button
            type="button"
            data-opener={floating ? undefined : o.id}
            onClick={(e) => openDetail(o.id, e.currentTarget)}
            className={cn(
              "cursor-pointer text-left outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50",
              muted && "font-normal text-muted-foreground",
            )}
          >
            <span className="line-clamp-2">{tidy(o.titulo)}</span>
          </button>
        </h3>
        <p className="truncate text-xs text-muted-foreground">{o.organismo}</p>
      </div>
      <div className="flex flex-wrap items-start gap-1.5">
        {row.o ? <Deadline o={row.o} /> : <GoneNote />}
        {row.o && <ScoreChip fit={row.o.fit} size="sm" />}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="relative z-10">
          <TriageSelect o={o} />
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          {notes > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums" title={notes === 1 ? "1 nota" : `${notes} notas`}>
              <MessageSquare className="size-3.5" aria-hidden />
              {notes}
              <span className="sr-only">{notes === 1 ? " nota" : " notas"}</span>
            </span>
          )}
          {row.entry.assignee && <PersonAvatar name={row.entry.assignee.name} label="Responsable" />}
        </div>
        <span
          data-handle
          title="Arrastra para cambiar de columna"
          className="relative z-10 -mr-1 grid size-8 cursor-grab touch-none place-items-center rounded-md text-muted-foreground/60 group-hover:text-muted-foreground"
        >
          <GripVertical className="size-4" aria-hidden />
        </span>
      </div>
    </Card>
  );
}
