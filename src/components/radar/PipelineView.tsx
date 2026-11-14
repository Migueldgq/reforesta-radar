"use client";

import Link from "next/link";
import { ArrowRight, ListChecks } from "lucide-react";
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
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map((c) => {
              const list = rows.filter((r) => r.entry.status === c.key);
              return (
                <section key={c.key} aria-labelledby={`col-${c.key}`} className="flex flex-col gap-3">
                  <header className="flex items-baseline justify-between border-b border-stone-200 pb-2">
                    <div>
                      <h2 id={`col-${c.key}`} className="text-sm font-semibold text-stone-900">
                        {TRIAGE_LABELS[c.key]}
                      </h2>
                      <p className="text-xs text-stone-500">{c.hint}</p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-stone-500">{list.length}</span>
                  </header>
                  {list.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-stone-200 px-3 py-6 text-center text-xs text-stone-400">Vacío</p>
                  ) : (
                    list.map((r) => <Card key={r.id} row={r} muted={c.key === "descartada"} />)
                  )}
                </section>
              );
            })}
          </div>
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

function Card({ row, muted }: { row: Row; muted: boolean }) {
  const { openDetail } = useRadar();
  const o = row.o ?? stub(row.id, row.entry);
  return (
    <article className={cx("relative space-y-2.5 rounded-xl border border-stone-200/80 bg-white p-3.5 transition-shadow hover:shadow-sm", muted && "opacity-70")}>
      <h3 className="text-sm leading-snug font-medium text-stone-900">
        {row.o ? (
          <button type="button" onClick={() => openDetail(o.id)} className="cursor-pointer text-left hover:text-brand-900 hover:underline">
            <span className="line-clamp-3">{tidy(o.titulo)}</span>
          </button>
        ) : (
          <span className="line-clamp-3">{o.titulo}</span>
        )}
      </h3>
      <p className="truncate text-xs text-stone-500">{tidy(o.organismo)}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {row.o ? <DeadlineChip o={row.o} /> : <span className="text-xs text-stone-400">Ya no aparece en las fuentes</span>}
        {row.o && <FitChip fit={row.o.fit} compact />}
      </div>
      <TriageSelect o={o} />
    </article>
  );
}
