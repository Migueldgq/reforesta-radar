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
import { daysLeft, fmtDate, isClosed, parseDay, todayUTC, TIER_LABELS, TRIAGE_LABELS, TRIAGE_ORDER, workLineLabel, type Triage } from "./model";
import { useRadar } from "./store";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const chip = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function FitChip({ fit, compact = false }: { fit: FitAnalysis; compact?: boolean }) {
  const Icon = fit.tier === "alto" ? CircleCheck : fit.tier === "medio" ? CircleDot : CircleDashed;
  const tone =
    fit.tier === "alto"
      ? "bg-brand-50 text-brand-800 ring-1 ring-brand-200"
      : fit.tier === "medio"
        ? "bg-stone-100 text-stone-700 ring-1 ring-stone-200"
        : "bg-white text-stone-500 ring-1 ring-stone-200";
  return (
    <span className={cx(chip, tone)} title={`${TIER_LABELS[fit.tier]} · ${fit.score} de 100`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="tabular-nums font-semibold">{fit.score}</span>
      {!compact && <span className="font-normal">{TIER_LABELS[fit.tier].replace("Encaje ", "")}</span>}
    </span>
  );
}

export function DeadlineChip({ o }: { o: Opportunity }) {
  const d = daysLeft(o);
  const opens = parseDay(o.opensAt);
  if (isClosed(o))
    return (
      <span className={cx(chip, "bg-stone-100 text-stone-500")}>
        <CircleSlash className="h-3.5 w-3.5" aria-hidden />
        Cerrada
      </span>
    );
  if (opens != null && opens > todayUTC())
    return (
      <span className={cx(chip, "bg-sky-50 text-sky-900 ring-1 ring-sky-200")} title={`Abre el ${fmtDate(o.opensAt)}`}>
        <CalendarClock className="h-3.5 w-3.5" aria-hidden />
        Abre el {fmtDate(o.opensAt)?.replace(/ de \d{4}$/, "")}
      </span>
    );
  if (d == null)
    return (
      <span className={cx(chip, "bg-stone-100 text-stone-600")} title={o.deadlineText ?? undefined}>
        <CalendarDays className="h-3.5 w-3.5" aria-hidden />
        {o.kind === "empresa" ? "Todo el año" : "Sin fecha fija"}
      </span>
    );
  const text = d === 0 ? "Cierra hoy" : d === 1 ? "Cierra mañana" : `Quedan ${d} días`;
  if (d <= 7)
    return (
      <span className={cx(chip, "bg-red-50 text-red-800 ring-1 ring-red-200")} title={fmtDate(o.deadline) ?? undefined}>
        <AlarmClock className="h-3.5 w-3.5" aria-hidden />
        {text}
      </span>
    );
  if (d <= 30)
    return (
      <span className={cx(chip, "bg-amber-50 text-amber-900 ring-1 ring-amber-200")} title={fmtDate(o.deadline) ?? undefined}>
        <Clock className="h-3.5 w-3.5" aria-hidden />
        {text}
      </span>
    );
  return (
    <span className={cx(chip, "bg-stone-100 text-stone-700")} title={fmtDate(o.deadline) ?? undefined}>
      <CalendarDays className="h-3.5 w-3.5" aria-hidden />
      {text}
    </span>
  );
}

export function WorkLines({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <span className="text-xs text-stone-500">
      {lines.map((l) => workLineLabel(l)).join(" · ")}
    </span>
  );
}

export function TriageSelect({ o, size = "sm" }: { o: Opportunity; size?: "sm" | "md" }) {
  const { triageOf, setTriage } = useRadar();
  const value = triageOf(o.id);
  return (
    <label className="relative inline-flex">
      <span className="sr-only">Estado de seguimiento</span>
      <select
        value={value}
        onChange={(e) => setTriage(o, e.target.value as Triage)}
        onClick={(e) => e.stopPropagation()}
        className={cx(
          "appearance-none cursor-pointer rounded-lg border bg-white pr-7 font-medium text-stone-800 hover:border-stone-400 transition-colors",
          size === "sm" ? "h-8 pl-2.5 text-xs" : "h-10 pl-3 text-sm",
          value === "nueva" ? "border-stone-200 text-stone-600" : "border-brand-300 bg-brand-50 text-brand-900",
        )}
      >
        {TRIAGE_ORDER.map((t) => (
          <option key={t} value={t}>
            {TRIAGE_LABELS[t]}
          </option>
        ))}
      </select>
      <svg aria-hidden viewBox="0 0 12 12" className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-stone-500">
        <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-2xl border border-stone-200/80 bg-white", className)}>{children}</section>;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <SearchX className="h-6 w-6 text-stone-400" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium text-stone-900">{title}</p>
        {body && <p className="text-sm text-stone-500 max-w-md">{body}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Panel className="mx-auto max-w-lg">
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <TriangleAlert className="h-6 w-6 text-amber-700" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium text-stone-900">No hemos podido cargar las convocatorias</p>
          <p className="text-sm text-stone-500">
            Puede que alguna fuente oficial esté tardando en responder. Vuelve a intentarlo en unos segundos.
          </p>
          <p className="text-xs text-stone-400">Detalle técnico: {message}</p>
        </div>
        <Button onClick={onRetry}>
          <RotateCw className="h-4 w-4" aria-hidden /> Reintentar
        </Button>
      </div>
    </Panel>
  );
}

export function Button({
  children,
  variant = "primary",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-brand-800 text-white hover:bg-brand-900",
        variant === "secondary" && "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50",
        variant === "ghost" && "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-[28px]">{title}</h1>
        {sub && <p className="text-sm text-stone-500">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}
