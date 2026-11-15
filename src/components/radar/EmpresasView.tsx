"use client";

import { ArrowUpRight, BadgeCheck, FileText, MapPin, TriangleAlert } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { Opportunity } from "@/lib/opportunity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDayShort, fmtEuros, parseDay } from "./model";
import { Deadline, ScoreChip, TriageSelect } from "./ui";
import { useRadar } from "./store";

const STEPS = [
  "Elegid dos o tres programas: arriba están los abiertos y los que mejor encajan.",
  "Marcadlos «En estudio» para que aparezcan en Seguimiento y nadie los pierda de vista.",
  "Antes de preparar nada, abrid las bases: aquí solo hay un resumen de los requisitos.",
];

/** "15 nov 2026" */
function fmtChecked(s: string): string {
  const t = parseDay(s);
  return t == null ? s : `${fmtDayShort(t)} ${new Date(t).getUTCFullYear()}`;
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1">
      {items.map((x) => (
        <li key={x} className="flex gap-2 leading-relaxed">
          <span className="mt-[0.6em] size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
          <span>{x}</span>
        </li>
      ))}
    </ul>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <h4 className="text-xs font-medium text-muted-foreground">{children}</h4>;
}

function ProgrammeCard({ o, onOpen }: { o: Opportunity; onOpen: () => void }) {
  const r = o.rsc;
  const amount = o.amountText ?? fmtEuros(o.budget) ?? "Importe variable";
  const title = o.titulo.startsWith(`${o.organismo} — `) ? o.titulo.slice(o.organismo.length + 3) : o.titulo;
  return (
    <Card className="gap-5 p-5 shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64 space-y-1">
          <p className="text-xs text-muted-foreground">{o.organismo}</p>
          <h3 className="text-base leading-snug font-medium">
            <button type="button" onClick={onOpen} className="cursor-pointer text-left hover:underline">
              {title}
            </button>
          </h3>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {o.tipo && <Badge variant="outline">{o.tipo}</Badge>}
            {r?.territory && (
              <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-900 [&>svg]:size-3.5">
                <MapPin aria-hidden />
                Solo {r.territory}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <Deadline o={o} />
          <ScoreChip fit={o.fit} size="sm" />
        </div>
      </div>

      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <div className="space-y-0.5">
          <dt className="text-xs text-muted-foreground">{r?.kind === "premio" ? "Dotación del premio" : "Importe"}</dt>
          <dd className="leading-relaxed">{amount}</dd>
        </div>
        {r && (
          <div className="space-y-0.5">
            <dt className="text-xs text-muted-foreground">Último plazo</dt>
            <dd className="leading-relaxed">{r.window}</dd>
          </div>
        )}
      </dl>

      {r ? (
        <>
          <div className="grid gap-5 md:grid-cols-2 md:gap-8">
            <div className="space-y-1">
              <Label>Por qué puede encajar</Label>
              <p className="leading-relaxed">{r.whyReforesta}</p>
            </div>
            {r.limits.length > 0 && (
              <div className="space-y-1">
                <Label>Qué lo limita</Label>
                <List items={r.limits} />
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label>Requisitos</Label>
            <List items={r.requirements} />
          </div>
          {r.unverified && (
            <div className="space-y-1.5">
              <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-900 [&>svg]:size-3.5">
                <TriangleAlert aria-hidden />
                Sin comprobar
              </Badge>
              <p className="text-sm leading-relaxed text-muted-foreground">{r.unverified}</p>
            </div>
          )}
        </>
      ) : (
        o.summary && <p className="leading-relaxed">{o.summary}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <TriageSelect o={o} />
          {r && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <BadgeCheck className="size-3.5 text-primary" aria-hidden />
              Comprobado el {fmtChecked(r.verifiedOn)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {o.basesUrl && (
            <Button asChild variant="ghost" size="sm">
              <a href={o.basesUrl} target="_blank" rel="noreferrer">
                <FileText aria-hidden /> Ver bases
              </a>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <a href={o.url} target="_blank" rel="noreferrer">
              Abrir convocatoria <ArrowUpRight aria-hidden />
            </a>
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function EmpresasView() {
  const { data, loading, error, reload, triageOf, openDetail } = useRadar();
  const items = useMemo(
    () => (data?.items ?? []).filter((o) => o.kind === "empresa").sort((a, b) => b.fit.score - a.fit.score),
    [data],
  );
  const inPipeline = items.filter((o) => triageOf(o.id) !== "nueva" && triageOf(o.id) !== "descartada").length;

  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Empresas y fundaciones</h1>
        <p className="max-w-3xl text-muted-foreground">
          Programas de fundaciones y empresas que financian proyectos ambientales de ONG en España. El canal está a cero; el objetivo es cerrar las 2–4
          primeras empresas.
        </p>
        <p className="max-w-3xl text-muted-foreground">
          Esta lista no es automática: la hacemos a mano y comprobamos cada dato en la web de la entidad. Cada ficha dice cuándo se comprobó.
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
            {items.map((o) => (
              <li key={o.id}>
                <ProgrammeCard o={o} onOpen={() => openDetail(o.id)} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Importes y plazos copiados de la web o las bases de cada entidad. Pueden cambiar en la próxima edición: confirmadlos antes de presentar nada.
          </p>
        </section>
      )}
    </div>
  );
}
