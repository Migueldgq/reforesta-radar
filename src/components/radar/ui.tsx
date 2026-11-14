"use client";

import {
  AlarmClock,
  CalendarClock,
  CalendarDays,
  CircleCheck,
  CircleDashed,
  CircleDot,
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
import { Button as UIButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { daysLeft, fmtDate, fmtDayShort, isClosed, parseDay, todayUTC, TIER_LABELS, TRIAGE_LABELS, TRIAGE_ORDER, workLineLabel, type Triage } from "./model";
import { useRadar } from "./store";

/** @deprecated use `cn` from "@/lib/utils". Kept while other views migrate. */
export const cx = (...c: (string | false | null | undefined)[]) => cn(...c);

const badge = "gap-1 font-medium whitespace-nowrap [&>svg]:size-3.5";

export function FitChip({ fit, compact = false }: { fit: FitAnalysis; compact?: boolean }) {
  const Icon = fit.tier === "alto" ? CircleCheck : fit.tier === "medio" ? CircleDot : CircleDashed;
  return (
    <Badge
      variant={fit.tier === "alto" ? "default" : fit.tier === "medio" ? "secondary" : "outline"}
      className={cn(badge, fit.tier === "bajo" && "text-muted-foreground")}
      title={`${TIER_LABELS[fit.tier]} · ${fit.score} de 100`}
    >
      <Icon aria-hidden />
      <span className="tabular-nums">{fit.score}</span>
      {!compact && <span className="font-normal">{TIER_LABELS[fit.tier].replace("Encaje ", "")}</span>}
    </Badge>
  );
}

export function DeadlineChip({ o }: { o: Opportunity }) {
  const d = daysLeft(o);
  const opens = parseDay(o.opensAt);
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

export function TriageSelect({ o, size = "sm" }: { o: Opportunity; size?: "sm" | "md" }) {
  const { triageOf, setTriage } = useRadar();
  const value = triageOf(o.id);
  return (
    <Select value={value} onValueChange={(v) => setTriage(o, v as Triage)}>
      <SelectTrigger
        size={size === "sm" ? "sm" : "default"}
        aria-label="Estado de seguimiento"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn("w-[136px] bg-background", value !== "nueva" && "border-primary/40 text-primary font-medium")}
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

/** @deprecated use shadcn Card. Kept while other views migrate. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cn("gap-0 py-0 shadow-none", className)}>{children}</Card>;
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
        <UIButton onClick={onRetry}>
          <RotateCw aria-hidden /> Reintentar
        </UIButton>
      </div>
    </Card>
  );
}

/** @deprecated use shadcn Button. Kept while other views migrate. */
export function Button({
  variant = "primary",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return <UIButton type="button" variant={variant === "primary" ? "default" : variant === "secondary" ? "outline" : "ghost"} {...rest} />;
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
