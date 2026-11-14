"use client";

import { useState } from "react";
import { Building2, ExternalLink, Lightbulb, Sparkles } from "lucide-react";
import { WORK_LINE_LABELS } from "@/lib/reforesta-profile";
import { RSC_OPPORTUNITIES } from "@/lib/rsc-opportunities";
import type { WorkLine } from "@/lib/types";
import { WorkLinePill } from "./BadgeHelpers";

export function RscTab() {
  const [lineFilter, setLineFilter] = useState<WorkLine | "all">("all");

  const filtered =
    lineFilter === "all"
      ? RSC_OPPORTUNITIES
      : RSC_OPPORTUNITIES.filter((o) => o.focus.includes(lineFilter));

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-stone-900 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-[#2D6A4F]" />
              Canal RSC &amp; Fundaciones Privadas (de 0 a 2–4 empresas)
            </h2>
            <p className="text-sm text-stone-600">
              Hoy este canal está a cero y solo llegan las empresas que os buscan. Aquí
              tienes convocatorias privadas y programas RSC activos en España con el{" "}
              <strong>ángulo exacto</strong> para presentarles propuesta.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-medium text-emerald-900 shrink-0">
            <Sparkles className="h-3.5 w-3.5" />
            {filtered.length} programas prioritarios
          </span>
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-stone-100">
          <button
            type="button"
            onClick={() => setLineFilter("all")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition cursor-pointer ${
              lineFilter === "all"
                ? "bg-[#1B4332] text-white"
                : "bg-stone-100 text-stone-700 hover:bg-stone-200"
            }`}
          >
            Todas las líneas
          </button>
          {(Object.keys(WORK_LINE_LABELS) as WorkLine[]).map((line) => (
            <button
              key={line}
              type="button"
              onClick={() => setLineFilter(line)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition cursor-pointer ${
                lineFilter === line
                  ? "bg-[#1B4332] text-white"
                  : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              }`}
            >
              {WORK_LINE_LABELS[line]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((item) => (
          <article
            key={item.id}
            className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm flex flex-col justify-between gap-4"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="inline-block rounded-md bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600 mb-1.5">
                    {item.type} · {item.cadence}
                  </span>
                  <h3 className="text-base font-semibold text-stone-900">
                    {item.entity}
                  </h3>
                  <p className="text-sm text-stone-600">{item.program}</p>
                </div>
                <span className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-900 shrink-0">
                  {item.typicalAmount}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {item.focus.map((f) => (
                  <WorkLinePill key={f} line={f} />
                ))}
              </div>

              <p className="text-sm text-stone-700 leading-relaxed">
                {item.whyReforesta}
              </p>

              <div className="rounded-xl bg-[#F4F8F5] border border-emerald-100 p-3 text-xs text-stone-800 space-y-1">
                <div className="font-semibold text-[#1B4332] flex items-center gap-1.5">
                  <Lightbulb className="h-3.5 w-3.5" />
                  Qué proponerles el lunes
                </div>
                <p className="leading-relaxed">{item.pitchAngle}</p>
              </div>
            </div>

            <div className="pt-2 border-t border-stone-100 flex justify-end">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1B4332] hover:underline"
              >
                Abrir web del programa
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
