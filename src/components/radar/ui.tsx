"use client";

import {
  AlarmClock,
  CalendarClock,
  CalendarDays,
  CircleSlash,
  Clock,
  RotateCw,
  SearchX,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Opportunity } from "@/lib/opportunity";
import type { FitAnalysis } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { daysLeft, fmtDate, fmtDayShort, isClosed, isNextEdition, parseDay, todayUTC, TIER_LABELS, TRIAGE_LABELS, TRIAGE_ORDER, workLineLabel, type Triage } from "./model";
import { useRadar } from "./store";

const badge = "gap-1 font-medium whitespace-nowrap [&>svg]:size-3.5";

const SCORE_SIZE = {
  sm: "h-5 min-w-7 rounded-md px-1.5 text-xs",
  md: "size-8 rounded-md text-[13px]",
  lg: "size-12 rounded-lg text-lg",
} as const;

/** The fit score, same look everywhere: solid primary for high fit, grey for medium, outlined for low. */
export function ScoreChip({ fit, size = "md" }: { fit: FitAnalysis; size?: keyof typeof SCORE_SIZE }) {
  const t = fit.tier;
  return (
    <span
      title={`${TIER_LABELS[t]}: ${fit.score} de 100`}
      className={cn(
        "inline-grid shrink-0 place-items-center font-semibold tabular-nums",
        SCORE_SIZE[size],
        t === "alto" ? "bg-primary text-primary-foreground" : t === "medio" ? "bg-secondary text-foreground" : "border text-muted-foreground",
      )}
    >
      {fit.score}
      <span className="sr-only"> · {TIER_LABELS[t]}</span>
    </span>
  );
}

export function DeadlineChip({ o }: { o: Opportunity }) {
  const d = daysLeft(o);
  const opens = parseDay(o.opensAt);
  if (isNextEdition(o)) {
    const closed = parseDay(o.deadline);
    return (
      <Badge variant="outline" className={cn(badge, "h-auto items-start text-left text-muted-foreground [&>svg]:mt-px")} title="Convocatoria periódica: prepara la siguiente edición">
        <RotateCw aria-hidden />
        <span className="flex flex-col leading-tight">
          <span>{closed != null ? `Cerró el ${fmtDayShort(closed)}` : "Cerrada"} ·</span>
          <span>próxima edición</span>
        </span>
      </Badge>
    );
  }
  if (isClosed(o))
    return (
      <Badge variant="outline" className={cn(badge, "text-muted-foreground")}>
        <CircleSlash aria-hidden />
        Cerrada
      </Badge>
    );
  if (opens != null && opens > todayUTC())
    return (
      <Badge variant="outline" className={cn(badge, "border-sky-200 bg-sky-50 text-sky-900")} title={`Abre el ${fmtDate(o.opensAt)}`}>
        <CalendarClock aria-hidden />
        Abre el {fmtDayShort(opens)}
      </Badge>
    );
  if (d == null)
    return (
      <Badge variant="outline" className={cn(badge, "text-muted-foreground")} title={o.deadlineText ?? undefined}>
        <CalendarDays aria-hidden />
        {o.kind === "empresa" ? "Todo el año" : "Sin fecha"}
      </Badge>
    );
  const text = d === 0 ? "Cierra hoy" : d === 1 ? "Mañana" : `${d} días`;
  if (d <= 7)
    return (
      <Badge variant="outline" className={cn(badge, "border-red-200 bg-red-50 text-red-800")} title={fmtDate(o.deadline) ?? undefined}>
        <AlarmClock aria-hidden />
        {text}
      </Badge>
    );
  if (d <= 30)
    return (
      <Badge variant="outline" className={cn(badge, "border-amber-200 bg-amber-50 text-amber-900")} title={fmtDate(o.deadline) ?? undefined}>
        <Clock aria-hidden />
        {text}
      </Badge>
    );
  return (
    <Badge variant="outline" className={badge} title={fmtDate(o.deadline) ?? undefined}>
      <CalendarDays aria-hidden />
      {text}
    </Badge>
  );
}

export function WorkLines({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return <span className="text-xs text-muted-foreground">{lines.map((l) => workLineLabel(l)).join(" · ")}</span>;
}

export function TriageSelect({ o, className }: { o: Pick<Opportunity, "id" | "titulo" | "organismo" | "deadline">; className?: string }) {
  const { triageOf, setTriage } = useRadar();
  const value = triageOf(o.id);
  return (
    <Select value={value} onValueChange={(v) => setTriage(o, v as Triage)}>
      <SelectTrigger
        size="sm"
        aria-label="Estado de seguimiento"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn("w-[128px] bg-background shadow-none", value !== "nueva" && "border-primary/40 font-medium text-primary", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent onClick={(e) => e.stopPropagation()}>
        {TRIAGE_ORDER.map((t) => (
          <SelectItem key={t} value={t}>
            {TRIAGE_LABELS[t]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <SearchX className="size-6 text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {body && <p className="max-w-md text-sm text-muted-foreground">{body}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="mx-auto w-full max-w-lg shadow-none">
      <div className="flex flex-col items-center gap-3 px-6 py-6 text-center">
        <TriangleAlert className="size-6 text-amber-700" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium">No hemos podido cargar las convocatorias</p>
          <p className="text-sm text-muted-foreground">Puede que alguna fuente oficial esté tardando en responder. Vuelve a intentarlo en unos segundos.</p>
          <p className="text-xs text-muted-foreground">Detalle técnico: {message}</p>
        </div>
        <Button onClick={onRetry}>
          <RotateCw aria-hidden /> Reintentar
        </Button>
      </div>
    </Card>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <div className="text-sm text-muted-foreground">{sub}</div>}
      </div>
      {actions}
    </div>
  );
}
