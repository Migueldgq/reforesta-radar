"use client";

import { CircleAlert, CircleCheck, CircleMinus, CircleX, ExternalLink, Loader2, RotateCw } from "lucide-react";
import type { SourceHealth } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { fmtAgo } from "./model";
import { useRadar } from "./store";

function StatusBadge({ s }: { s: SourceHealth }) {
  if (s.status === "error")
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        <CircleX aria-hidden />
        Error
      </Badge>
    );
  if (s.status === "partial")
    return (
      <Badge variant="outline">
        <CircleAlert aria-hidden />
        Parcial
      </Badge>
    );
  if (s.count === 0)
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <CircleMinus aria-hidden />
        Sin novedades
      </Badge>
    );
  return (
    <Badge variant="secondary">
      <CircleCheck aria-hidden className="text-primary" />
      Correcta
    </Badge>
  );
}

function SourceLink({ s }: { s: SourceHealth }) {
  return (
    <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground">
      <a href={s.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${s.name} en una pestaña nueva`} title="Abrir la fuente">
        <ExternalLink aria-hidden />
      </a>
    </Button>
  );
}

export function FuentesView() {
  const { data, loading, refreshing, error, reload } = useRadar();
  const busy = loading || refreshing;
  const sources = data?.sources ?? [];

  return (
    <div className="flex w-full max-w-4xl flex-col gap-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Fuentes</h1>
        <p className="text-sm text-muted-foreground">De dónde salen los datos y cuándo se consultaron por última vez.</p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {data ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{sources.length}</span> fuentes ·{" "}
            <span className="font-medium text-foreground tabular-nums">{data.items.length}</span> convocatorias · última consulta{" "}
            {fmtAgo(data.fetchedAt)}
          </p>
        ) : (
          <Skeleton className="h-5 w-72 max-w-full" />
        )}
        <Button variant="outline" onClick={() => reload(true)} disabled={busy} className="self-start sm:self-auto">
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />}
          {busy ? "Consultando…" : "Volver a consultar"}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle className="line-clamp-none">No hemos podido consultar las fuentes</AlertTitle>
          <AlertDescription className="gap-3 text-muted-foreground!">
            <p>{error}</p>
            {!data && (
              <Button variant="outline" size="sm" onClick={() => reload()}>
                <RotateCw aria-hidden />
                Reintentar
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {!data && !error && (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {data && (
        <div className={cn("transition-opacity", refreshing && "opacity-60")} aria-busy={refreshing || undefined}>
          {/* Desktop / tablet: table */}
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Fuente</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Resultados</TableHead>
                  <TableHead>Nota</TableHead>
                  <TableHead className="w-12 pr-4">
                    <span className="sr-only">Enlace</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="py-3 pl-4 align-top">
                      <div className="font-medium text-foreground">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.category}</div>
                    </TableCell>
                    <TableCell className="py-3 align-top">
                      <StatusBadge s={s} />
                    </TableCell>
                    <TableCell className="py-3 text-right align-top tabular-nums">{s.count}</TableCell>
                    <TableCell className="max-w-xs py-3 align-top text-sm whitespace-normal text-muted-foreground">{s.note || "—"}</TableCell>
                    <TableCell className="py-2 pr-4 text-right align-top">
                      <SourceLink s={s} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: stacked cards */}
          <ul className="flex flex-col gap-3 md:hidden">
            {sources.map((s) => (
              <li key={s.id}>
                <Card className="gap-3 px-4 py-4 shadow-none">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.category}</p>
                    </div>
                    <SourceLink s={s} />
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge s={s} />
                    <span className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground tabular-nums">{s.count}</span> {s.count === 1 ? "resultado" : "resultados"}
                    </span>
                  </div>
                  {s.note && <p className="text-sm text-muted-foreground">{s.note}</p>}
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Guardamos una copia de los datos durante unos minutos para que la aplicación vaya rápida y la renovamos en segundo plano. Si una fuente falla, se
        mantienen sus últimos datos buenos. «Volver a consultar» pregunta otra vez a todas las fuentes y puede tardar hasta medio minuto.
      </p>
    </div>
  );
}
