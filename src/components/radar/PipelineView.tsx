"use client";

import Link from "next/link";
import { ArrowRight, GripVertical, ListChecks } from "lucide-react";
import { useRef, useState } from "react";
import type { Opportunity } from "@/lib/opportunity";
import { daysLeft, fmtDate, tidy, TRIAGE_LABELS, type Triage } from "./model";
import { useRadar, type TriageEntry } from "./store";
import { cx, DeadlineChip, FitChip, PageHeader, Panel, TriageSelect } from "./ui";

const COLUMNS: { key: Triage; hint: string }[] = [
  { key: "estudio", hint: "Alguien la está leyendo" },
  { key: "presentar", hint: "Decidido: vamos a por ella" },
  { key: "presentada", hint: "Ya enviada, a la espera" },
  { key: "descartada", hint: "No encaja o no llegamos" },
];

type Row = { id: string; entry: TriageEntry; o: Opportunity | undefined };

function stub(id: string, e: TriageEntry): Opportunity {
  return {
    id,
    titulo: e.titulo,
    organismo: e.organismo,
    deadline: e.deadline,
  } as Opportunity;
}

export function PipelineView() {
  const { triage, byId } = useRadar();
  const rows: Row[] = Object.entries(triage).map(([id, entry]) => ({ id, entry, o: byId.get(id) }));
  const dl = (r: Row) => {
    const d = r.o ? daysLeft(r.o) : null;
    return d == null || d < 0 ? Infinity : d;
  };
  rows.sort((a, b) => dl(a) - dl(b));

  const active = rows.filter((r) => r.entry.status === "estudio" || r.entry.status === "presentar");
  const next = active.find((r) => dl(r) !== Infinity);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Seguimiento" sub="Las convocatorias que habéis decidido mirar, ordenadas por fecha de cierre. Se guarda en este navegador." />

      {rows.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <ListChecks className="h-6 w-6 text-stone-400" aria-hidden />
            <p className="font-medium text-stone-900">Todavía no seguís ninguna convocatoria</p>
            <p className="max-w-md text-sm text-stone-500">
              En Inicio, cambia el estado de cualquier convocatoria a «En estudio» o «A presentar» y aparecerá aquí.
            </p>
            <Link href="/" className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-800 px-3.5 text-sm font-medium text-white hover:bg-brand-900">
              Ir a convocatorias <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </Panel>
      ) : (
        <>
          {next && (
            <NextUp row={next} />
          )}
          <Board rows={rows} />
        </>
      )}
    </div>
  );
}

function NextUp({ row }: { row: Row }) {
  const { openDetail } = useRadar();
  const o = row.o!;
  return (
    <button
      type="button"
      onClick={() => openDetail(o.id)}
      className="flex cursor-pointer flex-col gap-2 rounded-2xl bg-brand-800 p-5 text-left text-white shadow-[0_10px_30px_-16px_rgba(27,67,50,0.7)] transition-colors hover:bg-brand-900 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-medium tracking-wide text-brand-200 uppercase">Lo siguiente que cierra · {TRIAGE_LABELS[row.entry.status]}</p>
        <p className="line-clamp-2 text-base font-semibold">{tidy(o.titulo)}</p>
        <p className="text-sm text-brand-100">
          {tidy(o.organismo)} · cierra el {fmtDate(o.deadline)}
        </p>
      </div>
      <span className="shrink-0 text-3xl font-semibold tabular-nums">
        {daysLeft(o)} <span className="text-base font-normal text-brand-100">días</span>
      </span>
    </button>
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
    const onHandle = !!target.closest("[data-handle]");
    if (e.pointerType !== "mouse" && !onHandle) return; // touch: only the handle drags, so the page still scrolls
    if (!onHandle && target.closest("select, a")) return;
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
      if (to && to !== drag.from && row) setTriage(row.o ?? stub(row.id, row.entry), to);
    }
    setDrag(null);
    setOver(null);
  };

  const dragged = drag ? rows.find((r) => r.id === drag.id) : undefined;

  return (
    <div
      className="grid gap-6 md:grid-cols-2 xl:grid-cols-4"
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
          <section key={c.key} data-col={c.key} aria-labelledby={`col-${c.key}`} className="flex flex-col gap-3">
            <header className="flex items-baseline justify-between border-b border-stone-200 pb-2">
              <div>
                <h2 id={`col-${c.key}`} className="text-sm font-semibold text-stone-900">
                  {TRIAGE_LABELS[c.key]}
                </h2>
                <p className="text-xs text-stone-500">{c.hint}</p>
              </div>
              <span className="text-sm font-semibold tabular-nums text-stone-500">{list.length}</span>
            </header>
            <div
              className={cx(
                "flex min-h-24 flex-1 flex-col gap-3 rounded-xl transition-colors",
                drag && "outline-2 outline-offset-4 outline-transparent outline-dashed",
                isOver && "bg-brand-50/70 outline-brand-400",
              )}
            >
              {isOver && (
                <p className="rounded-xl border border-dashed border-brand-400 px-3 py-4 text-center text-xs font-medium text-brand-800">Suelta aquí</p>
              )}
              {list.length === 0 && !isOver && (
                <p className="rounded-xl border border-dashed border-stone-200 px-3 py-6 text-center text-xs text-stone-400">
                  {drag ? "Suelta aquí" : "Vacío"}
                </p>
              )}
              {list.map((r) => (
                <Card
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
          <div className="rounded-xl shadow-[0_18px_40px_-12px_rgba(28,25,23,0.35)] motion-safe:rotate-[1.5deg]">
            <Card row={dragged} muted={false} ghost={false} floating />
          </div>
        </div>
      )}
    </div>
  );
}

function Card({
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
  const o = row.o ?? stub(row.id, row.entry);
  return (
    <article
      onPointerDown={onPointerDown}
      className={cx(
        "group relative space-y-2.5 rounded-xl border border-stone-200/80 bg-white p-3.5 pl-3 transition-[box-shadow,opacity] select-none md:cursor-grab",
        !floating && "hover:shadow-sm",
        muted && "opacity-70",
        ghost && "opacity-30",
        floating && "cursor-grabbing",
      )}
    >
      <div className="flex gap-2">
        <span
          data-handle
          title="Arrastra para cambiar de columna"
          className="relative z-10 -my-1 grid w-5 shrink-0 cursor-grab touch-none place-items-start pt-1 text-stone-300 group-hover:text-stone-500"
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-2.5">
          <h3 className="text-sm leading-snug font-medium text-stone-900">
            {row.o ? (
              <button type="button" onClick={() => openDetail(o.id)} className="cursor-pointer text-left after:absolute after:inset-0 after:content-[''] hover:text-brand-900">
                <span className="line-clamp-3">{tidy(o.titulo)}</span>
              </button>
            ) : (
              <span className="line-clamp-3">{tidy(o.titulo)}</span>
            )}
          </h3>
          <p className="truncate text-xs text-stone-500">{tidy(o.organismo)}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {row.o ? <DeadlineChip o={row.o} /> : <span className="text-xs text-stone-400">Ya no aparece en las fuentes</span>}
            {row.o && <FitChip fit={row.o.fit} compact />}
          </div>
          <div className="relative z-10">
            <TriageSelect o={o} />
          </div>
        </div>
      </div>
    </article>
  );
}
