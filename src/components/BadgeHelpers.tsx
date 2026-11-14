"use client";

import { WORK_LINE_LABELS } from "@/lib/reforesta-profile";
import type { FitAnalysis, TriageStatus, WorkLine } from "@/lib/types";

export function formatCurrency(amount: number | null): string {
  if (amount == null) return "Importe no especificado";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function ScoreBadge({ score, tier }: { score: number; tier: FitAnalysis["tier"] }) {
  const styles =
    tier === "alto"
      ? "bg-emerald-900 text-emerald-50 border-emerald-800"
      : tier === "medio"
        ? "bg-amber-100 text-amber-900 border-amber-300"
        : "bg-stone-200 text-stone-700 border-stone-300";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums ${styles}`}
      title="Puntuación de encaje con Reforesta (0-100)"
    >
      {score}/100
    </span>
  );
}

export function DeadlineBadge({ fit }: { fit: FitAnalysis }) {
  if (fit.deadlineState === "cerrada") {
    return (
      <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
        Plazo cerrado
      </span>
    );
  }
  if (fit.deadlineState === "proxima") {
    return (
      <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
        Abre pronto
      </span>
    );
  }
  if (fit.deadlineState === "abierta") {
    const label =
      fit.daysRemaining !== null && fit.daysRemaining >= 0
        ? `Abierta · ${fit.daysRemaining}d restantes`
        : "Abierta";
    const urgent = fit.daysRemaining !== null && fit.daysRemaining <= 10;
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
          urgent
            ? "bg-rose-100 text-rose-800"
            : "bg-emerald-100 text-emerald-800"
        }`}
      >
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
      Ver bases
    </span>
  );
}

export function WorkLinePill({ line }: { line: WorkLine }) {
  return (
    <span className="inline-flex items-center rounded-md bg-[#E9F2EC] px-2 py-0.5 text-[11px] font-medium text-[#1B4332]">
      {WORK_LINE_LABELS[line]}
    </span>
  );
}

export const TRIAGE_LABELS: Record<TriageStatus, { label: string; cls: string }> = {
  nueva: { label: "Nueva", cls: "bg-stone-100 text-stone-700 border-stone-200" },
  estudio: { label: "En estudio", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  presentar: {
    label: "A presentar",
    cls: "bg-emerald-50 text-emerald-800 border-emerald-300",
  },
  descartada: {
    label: "Descartada",
    cls: "bg-stone-100 text-stone-400 border-stone-200 line-through",
  },
};
