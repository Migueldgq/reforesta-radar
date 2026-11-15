"use client";

import { CircleAlert, CircleCheck, CircleMinus, CircleSlash, CircleX, Clock, ExternalLink, Loader2, RefreshCw, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errorText } from "@/lib/api";
import { fmtWhenShort, type IngestStatus } from "@/lib/team";
import { useSession } from "@/components/auth/session";
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
  if (s.status === "disabled")
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <CircleSlash aria-hidden />
        Desactivada
      </Badge>
    );
  // The company programmes are a hand-made list: "partial" there means it is due for a review.
  if (s.status === "partial" && s.id === "rsc")
    return (
      <Badge variant="outline">
        <Clock aria-hidden />
        Por revisar
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

const OPEN = new Set(["requested", "running"]);
const POLL_MS = 5000;

/** "Actualizar ahora": admins ask for an ingest; everyone sees its state while it runs. */
function IngestPanel() {
  const { isAdmin } = useSession();
  const { reload, notify } = useRadar();
  const [st, setSt] = useState<IngestStatus | null>(null);
  const [asking, setAsking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasOpen = useRef(false);
  const pollRef = useRef<() => void>(() => {});
  const later = (ms = POLL_MS) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => pollRef.current(), ms);
  };

  const poll = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const s = await api<IngestStatus>("/api/ingest");
      setSt(s);
      const open = !!s.latest && OPEN.has(s.latest.status);
      // Finished while we watched: show the new data.
      if (wasOpen.current && !open && s.latest?.status === "done") reload();
      wasOpen.current = open;
      if (open) later();
    } catch {
      later(POLL_MS * 3);
    }
  }, [reload]);

  useEffect(() => {
    pollRef.current = () => void poll();
  }, [poll]);

  useEffect(() => {
    void Promise.resolve().then(poll);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  async function ask() {
    setAsking(true);
    try {
      setSt(await api<IngestStatus>("/api/ingest", { method: "POST" }));
      wasOpen.current = true;
      later();
    } catch (e) {
      // 409: one is already open; its body carries the current state.
      if (e instanceof ApiError && e.status === 409 && e.body && typeof e.body === "object" && "latest" in e.body) {
        setSt(e.body as IngestStatus);
        wasOpen.current = true;
        later();
      }
      notify(errorText(e), e instanceof ApiError && e.status === 409 ? "info" : "error");
    } finally {
      setAsking(false);
    }
  }

  const l = st?.latest;
  const open = !!l && OPEN.has(l.status);
  const who = l?.requestedBy ? ` por ${l.requestedBy}` : "";
  let line: React.ReactNode = null;
  if (l?.status === "requested")
    line = (
      <>
        <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden /> Actualización pedida{who} ({fmtWhenShort(l.requestedAt)}). Empezará en menos de un minuto.
      </>
    );
  else if (l?.status === "running")
    line = (
      <>
        <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden /> Consultando las fuentes (pedida{who}). Suele tardar un par de minutos; puedes seguir usando el radar.
      </>
    );
  else if (l?.status === "done")
    line = (
      <>
        <CircleCheck className="size-4 shrink-0 text-primary" aria-hidden /> Última actualización pedida{who}: terminada el {fmtWhenShort(l.finishedAt ?? l.requestedAt)}.
      </>
    );
  else if (l?.status === "failed")
    line = (
      <>
        <CircleX className="size-4 shrink-0 text-destructive" aria-hidden /> La última actualización pedida{who} falló el {fmtWhenShort(l.finishedAt ?? l.requestedAt)}
        {l.error ? `: ${l.error}` : "."} Los datos anteriores siguen ahí.
      </>
    );

  if (!isAdmin && !line) return null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2 text-sm sm:items-center" role="status" aria-live="polite">
        {line ?? <span className="text-muted-foreground">¿Ha salido algo hoy y no queréis esperar a mañana? Pedid una actualización.</span>}
      </p>
      {isAdmin && (
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => void ask()} disabled={asking || open || !st}>
          {asking || open ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
          {open ? "Actualizando…" : "Actualizar ahora"}
        </Button>
      )}
    </div>
  );
}

export function FuentesView() {
  const { data, refreshing, error, reload } = useRadar();
  const sources = data?.sources ?? [];

  return (
    <div className="flex w-full max-w-4xl flex-col gap-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Fuentes</h1>
        <p className="text-sm text-muted-foreground">
          De dónde salen los datos. Una ingesta programada consulta todas las fuentes cada mañana a las 9:00; esta
          página muestra su último resultado.
        </p>
      </header>

      <IngestPanel />

      {data ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{sources.length}</span> fuentes ·{" "}
          <span className="font-medium text-foreground tabular-nums">{data.items.length}</span> convocatorias · última ingesta{" "}
          {fmtAgo(data.lastIngestAt ?? data.fetchedAt)}
        </p>
      ) : (
        <Skeleton className="h-5 w-72 max-w-full" />
      )}

      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle className="line-clamp-none">No hemos podido cargar los datos</AlertTitle>
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
        Cada ingesta guarda los resultados en la base de datos del radar. Si una fuente falla, se mantienen sus últimos datos buenos hasta la
        siguiente. La página enseña siempre esos datos guardados: las fuentes solo se consultan en la ingesta diaria o cuando un
        administrador pide «Actualizar ahora».
      </p>
    </div>
  );
}
