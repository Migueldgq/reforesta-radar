"use client";

import { ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtEuros } from "./model";
import { ScoreChip, TriageSelect } from "./ui";
import { useRadar } from "./store";

const STEPS = [
  "Elegid dos o tres programas de la lista: arriba están los que más se parecen a lo que hacéis.",
  "Marcadlos «En estudio» para que aparezcan en Seguimiento y nadie los pierda de vista.",
  "Escribid un primer correo corto usando el ángulo sugerido de cada programa.",
];

export function EmpresasView() {
  const { data, loading, error, reload, triageOf, openDetail } = useRadar();
  const items = useMemo(
    () => (data?.items ?? []).filter((o) => o.kind === "empresa").sort((a, b) => b.fit.score - a.fit.score),
    [data],
  );
  const inPipeline = items.filter((o) => triageOf(o.id) !== "nueva" && triageOf(o.id) !== "descartada").length;

  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Empresas y fundaciones</h1>
        <p className="max-w-3xl text-muted-foreground">
          El canal corporativo: programas de RSC y fundaciones privadas. Hoy está a cero; el objetivo es cerrar las 2–4 primeras empresas. Aquí no se espera a
          una convocatoria, se les escribe.
        </p>
      </div>

      <section aria-labelledby="como-empezar" className="space-y-3">
        <h2 id="como-empezar" className="font-medium">
          Cómo empezar
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3 sm:gap-6">
          {STEPS.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium tabular-nums">{i + 1}</span>
              <p className="text-muted-foreground">{s}</p>
            </li>
          ))}
        </ol>
      </section>

      {loading && !data ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : error && !data ? (
        <Card className="items-start gap-3 px-6 py-6 shadow-none">
          <p className="font-medium">No se han podido cargar los programas</p>
          <p className="text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={() => reload()}>
            Reintentar
          </Button>
        </Card>
      ) : items.length === 0 ? (
        <Card className="items-center gap-2 border-dashed px-6 py-12 text-center shadow-none">
          <p className="font-medium">No hay programas de empresa cargados</p>
          <p className="text-muted-foreground">Revisa en Fuentes si la fuente de RSC ha respondido.</p>
        </Card>
      ) : (
        <section aria-labelledby="programas" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="programas" className="font-medium">
              {items.length} programas <span className="font-normal text-muted-foreground">· mejor encaje primero</span>
            </h2>
            <p className="text-xs text-muted-foreground tabular-nums">
              {inPipeline} en marcha · objetivo: 2–4 empresas
            </p>
          </div>
          <ul className="space-y-3">
            {items.map((o) => {
              const amount = o.amountText ?? fmtEuros(o.budget) ?? "Importe variable";
              return (
                <li key={o.id}>
                  <Card className="gap-5 p-5 shadow-none">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs text-muted-foreground">{o.organismo}</p>
                        <h3 className="text-base leading-snug font-medium">
                          <button type="button" onClick={() => openDetail(o.id)} className="cursor-pointer text-left hover:underline">
                            {o.titulo.startsWith(`${o.organismo} — `) ? o.titulo.slice(o.organismo.length + 3) : o.titulo}
                          </button>
                        </h3>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {o.tipo && <Badge variant="outline">{o.tipo}</Badge>}
                        <ScoreChip fit={o.fit} size="sm" />
                      </div>
                    </div>

                    <dl className="flex flex-wrap gap-x-8 gap-y-2">
                      <div>
                        <dt className="text-xs text-muted-foreground">Importe orientativo</dt>
                        <dd className="tabular-nums">{amount}</dd>
                      </div>
                      {o.rsc?.cadence && (
                        <div>
                          <dt className="text-xs text-muted-foreground">Cuándo</dt>
                          <dd>{o.rsc.cadence}</dd>
                        </div>
                      )}
                    </dl>

                    {o.rsc ? (
                      <div className="grid gap-4 md:grid-cols-2 md:gap-8">
                        <div className="space-y-1">
                          <h4 className="text-xs font-medium text-muted-foreground">Por qué encaja con Reforesta</h4>
                          <p className="leading-relaxed">{o.rsc.whyReforesta}</p>
                        </div>
                        <div className="space-y-1">
                          <h4 className="text-xs font-medium text-muted-foreground">Ángulo para el primer contacto</h4>
                          <p className="leading-relaxed">{o.rsc.pitchAngle}</p>
                        </div>
                      </div>
                    ) : (
                      o.summary && <p className="leading-relaxed">{o.summary}</p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                      <TriageSelect o={o} />
                      <Button asChild variant="outline" size="sm">
                        <a href={o.url} target="_blank" rel="noreferrer">
                          Abrir web <ExternalLink aria-hidden />
                        </a>
                      </Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">Los importes son orientativos, sacados de ediciones anteriores. Confirmadlos en la web de cada programa.</p>
        </section>
      )}
    </div>
  );
}
