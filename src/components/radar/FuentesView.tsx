"use client";

import { ArrowUpRight, CircleAlert, CircleCheck, CircleX, Loader2, RotateCw } from "lucide-react";
import type { SourceHealth } from "@/lib/types";
import { fmtAgo } from "./model";
import { useRadar } from "./store";
import { Button, cx, ErrorState, PageHeader, Panel } from "./ui";

const STATUS: Record<SourceHealth["status"], { label: string; icon: typeof CircleCheck; tone: string }> = {
  ok: { label: "Funciona", icon: CircleCheck, tone: "bg-brand-50 text-brand-800 ring-brand-200" },
  partial: { label: "Parcial", icon: CircleAlert, tone: "bg-amber-50 text-amber-900 ring-amber-200" },
  error: { label: "Sin respuesta", icon: CircleX, tone: "bg-red-50 text-red-800 ring-red-200" },
};

export function FuentesView() {
  const { data, loading, refreshing, error, reload } = useRadar();
  const busy = loading || refreshing;
  const sources = data?.sources ?? [];
  const ok = sources.filter((s) => s.status === "ok").length;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Fuentes"
        sub={
          data ? (
            <>
              Consultamos {sources.length} fuentes oficiales y privadas; {ok} responden con normalidad. Última consulta {fmtAgo(data.fetchedAt)}
              {data.cached ? " (copia guardada)" : ""}.
            </>
          ) : (
            "De dónde salen los datos."
          )
        }
        actions={
          <Button variant="secondary" onClick={() => reload(true)} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCw className="h-4 w-4" aria-hidden />}
            {busy ? "Consultando…" : "Volver a consultar ahora"}
          </Button>
        }
      />

      {error && !data ? (
        <ErrorState message={error} onRetry={() => reload()} />
      ) : !data ? (
        <Panel>
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton h-12 w-full" />
            ))}
          </div>
        </Panel>
      ) : (
        <Panel className={cx("overflow-hidden transition-opacity", refreshing && "opacity-60")}>
          <ul className="divide-y divide-stone-100">
            {sources.map((s) => {
              const st = STATUS[s.status];
              return (
                <li key={s.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium text-stone-900">{s.name}</span>
                      <span className="text-xs text-stone-500">{s.category}</span>
                    </p>
                    {s.note && <p className="mt-0.5 text-sm text-stone-500">{s.note}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1", st.tone)}>
                      <st.icon className="h-3.5 w-3.5" aria-hidden />
                      {st.label}
                    </span>
                    <span className="text-sm tabular-nums text-stone-700">
                      <strong className="font-semibold">{s.count}</strong> <span className="text-stone-500">resultados</span>
                    </span>
                  </div>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 justify-self-start text-xs font-medium text-brand-800 hover:underline sm:justify-self-end"
                  >
                    Abrir fuente <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                  </a>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
      <p className="text-xs leading-relaxed text-stone-500">
        Los datos se guardan unos minutos para que la aplicación vaya rápida. «Volver a consultar ahora» pregunta otra vez a todas las fuentes; puede tardar
        hasta medio minuto.
      </p>
    </div>
  );
}
