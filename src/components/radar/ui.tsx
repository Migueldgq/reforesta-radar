"use client";

import {
  AlarmClock,
  Award,
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
import { daysLeft, fmtDate, fmtDayShort, fmtEuros, isClosed, isNextEdition, joinEs, openingNote, parseDay, reforestaWins, todayUTC, TIER_LABELS, TRIAGE_LABELS, TRIAGE_ORDER, workLineLabel, type Triage } from "./model";
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

const CHIP_TONE = {
  muted: "text-muted-foreground",
  plain: "",
  sky: "border-sky-200 bg-sky-50 text-sky-900",
  red: "border-red-200 bg-red-50 text-red-800",
  amber: "border-amber-200 bg-amber-50 text-amber-900",
} as const;

/** Short date for the secondary line; the year only when it is not this one. */
function fmtDayNote(t: number): string {
  const y = new Date(t).getUTCFullYear();
  return y === new Date(todayUTC()).getUTCFullYear() ? fmtDayShort(t) : `${fmtDayShort(t)} ${y}`;
}

/**
 * Deadline state in two levels: a one-word-ish chip (icon + short label, never wraps)
 * and a quiet secondary line with the date that explains it.
 */
function deadlineState(o: Opportunity) {
  const d = daysLeft(o);
  const end = parseDay(o.deadline);
  const opens = parseDay(o.opensAt);
  const closes = end != null ? `Cierra el ${fmtDayNote(end)}` : null;
  const closed = end != null ? `Cerró el ${fmtDayNote(end)}` : null;
  if (isNextEdition(o)) {
    // When it usually opens is more useful than when the last one closed; that date stays in the tooltip.
    const opening = openingNote(o);
    const full = o.history?.typicalOpening?.text;
    const note = [full, closed].filter(Boolean).join(" · ") || undefined;
    return { Icon: RotateCw, label: "Próxima edición", tone: "muted", title: "Convocatoria periódica: prepara la siguiente edición", detail: opening ?? closed, note } as const;
  }
  if (isClosed(o)) return { Icon: CircleSlash, label: "Cerrada", tone: "muted", title: undefined, detail: closed } as const;
  if (opens != null && opens > todayUTC())
    return { Icon: CalendarClock, label: `Abre el ${fmtDayNote(opens)}`, tone: "sky", title: `Abre el ${fmtDate(o.opensAt)}`, detail: closes } as const;
  if (d == null)
    return { Icon: CalendarDays, label: o.kind === "empresa" ? "Todo el año" : "Sin fecha", tone: "muted", title: o.deadlineText ?? undefined, detail: null } as const;
  const label = d === 0 ? "Cierra hoy" : d === 1 ? "Mañana" : `${d} días`;
  const title = fmtDate(o.deadline) ?? undefined;
  const detail = d === 0 ? null : closes;
  if (d <= 7) return { Icon: AlarmClock, label, tone: "red", title, detail } as const;
  if (d <= 30) return { Icon: Clock, label, tone: "amber", title, detail } as const;
  return { Icon: CalendarDays, label, tone: "plain", title, detail } as const;
}

/** The state chip alone: icon + short label on one line. */
export function DeadlineChip({ o }: { o: Opportunity }) {
  const { Icon, label, tone, title } = deadlineState(o);
  return (
    <Badge variant="outline" className={cn(badge, CHIP_TONE[tone])} title={title}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

/** The chip with its date note underneath, for lists and cards. */
export function Deadline({ o, className }: { o: Opportunity; className?: string }) {
  const s = deadlineState(o);
  return (
    <div className={cn("flex min-w-0 flex-col items-start gap-1", className)}>
      <DeadlineChip o={o} />
      {s.detail && (
        <span className="line-clamp-2 pl-0.5 text-xs leading-snug whitespace-normal text-muted-foreground tabular-nums" title={"note" in s ? s.note : undefined}>
          {s.detail}
        </span>
      )}
    </div>
  );
}

/** Quiet marker for calls Reforesta already won in a past edition. Renders nothing otherwise. */
export function WonMarker({ o, className }: { o: Opportunity; className?: string }) {
  const wins = reforestaWins(o);
  if (!wins.length) return null;
  const title = `Reforesta la ganó en ${joinEs(wins.map((w) => (w.importe ? `${w.year} (${fmtEuros(w.importe)})` : String(w.year))))}`;
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap text-primary", className)}>
      <Award className="size-3.5 shrink-0" aria-hidden />
      Ya la ganasteis
      <span className="sr-only">: {title}</span>
    </span>
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
          <p className="text-sm text-muted-foreground">El servidor del radar no responde ahora mismo. Vuelve a intentarlo en unos segundos.</p>
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
