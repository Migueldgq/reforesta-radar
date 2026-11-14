"use client";

import { ArrowUpRight, Building2 } from "lucide-react";
import { useMemo } from "react";
import { fmtEuros, workLineLabel } from "./model";
import { useRadar } from "./store";
import { EmptyState, ErrorState, PageHeader, Panel, TriageSelect } from "./ui";

export function EmpresasView() {
  const { data, loading, error, reload, triageOf, openDetail } = useRadar();
  const items = useMemo(
    () => (data?.items ?? []).filter((o) => o.kind === "empresa").sort((a, b) => b.fit.score - a.fit.score),
    [data],
  );
  const inPipeline = items.filter((o) => triageOf(o.id) !== "nueva" && triageOf(o.id) !== "descartada").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Empresas y fundaciones"
        sub="Programas de RSC y fundaciones privadas que financian proyectos como los vuestros. Aquí no se espera a que publiquen: se les escribe."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Step n={1} title="Elegid tres" body="Las de arriba son las que más se parecen a lo que hacéis." />
        <Step n={2} title="Marcadlas «En estudio»" body="Así aparecen en Seguimiento y nadie las pierde de vista." />
        <Step n={3} title="Una página por empresa" body="Usad el ángulo sugerido para un primer correo o llamada." />
      </div>

      {loading && !data ? (
        <Panel>
          <div className="space-y-4 p-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-16 w-full" />
            ))}
          </div>
        </Panel>
      ) : error && !data ? (
        <ErrorState message={error} onRetry={() => reload()} />
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState title="No hay programas de empresa cargados" body="Revisa en Fuentes si la fuente de RSC ha respondido." />
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-stone-200/80 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-stone-900">
              {items.length} programas <span className="font-normal text-stone-500">· mejor encaje primero</span>
            </h2>
            <span className="text-xs text-stone-500 tabular-nums">
              {inPipeline} en marcha · objetivo del año: 2–4 empresas
            </span>
          </div>
          <ul className="divide-y divide-stone-100">
            {items.map((o) => (
              <li key={o.id} className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                <div className="min-w-0 space-y-1">
                  <p className="flex items-center gap-1.5 text-xs text-stone-500">
                    <Building2 className="h-3.5 w-3.5" aria-hidden /> {o.organismo}
                  </p>
                  <h3 className="text-[15px] leading-snug font-medium text-stone-900">
                    <button type="button" onClick={() => openDetail(o.id)} className="cursor-pointer text-left hover:text-brand-900 hover:underline">
                      {o.titulo}
                    </button>
                  </h3>
                  <p className="text-sm text-stone-700 tabular-nums">{fmtEuros(o.budget) ?? o.amountText ?? "Importe variable"}</p>
                  {o.rsc?.cadence && <p className="text-xs text-stone-500">{o.rsc.cadence}</p>}
                  {o.fit.workLines.length > 0 && <p className="text-xs text-stone-500">{o.fit.workLines.map(workLineLabel).join(" · ")}</p>}
                </div>
                <div className="space-y-2.5 text-sm leading-relaxed">
                  {o.rsc ? (
                    <>
                      <p className="text-stone-700">
                        <span className="block text-xs font-medium text-stone-500">Por qué vosotros</span>
                        {o.rsc.whyReforesta}
                      </p>
                      <p className="text-stone-700">
                        <span className="block text-xs font-medium text-stone-500">Cómo planteárselo</span>
                        {o.rsc.pitchAngle}
                      </p>
                    </>
                  ) : (
                    <p className="text-stone-700">{o.summary}</p>
                  )}
                </div>
                <div className="flex items-start gap-2 lg:flex-col lg:items-end">
                  <TriageSelect o={o} />
                  <a
                    href={o.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-brand-800 hover:bg-brand-50"
                  >
                    Web del programa <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-stone-200/80 bg-white p-4">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-800 ring-1 ring-brand-200">{n}</span>
      <div>
        <p className="text-sm font-semibold text-stone-900">{title}</p>
        <p className="text-xs leading-relaxed text-stone-500">{body}</p>
      </div>
    </div>
  );
}
