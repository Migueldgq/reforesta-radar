"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  FileText,
  Loader2,
  Sparkles,
  Upload,
} from "lucide-react";
import type { PdfAnalysisResult } from "@/lib/types";
import { ScoreBadge, WorkLinePill } from "./BadgeHelpers";

export function PdfResultCard({ result }: { result: PdfAnalysisResult }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-100 pb-4">
        <div className="space-y-1 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
            <span className="inline-flex items-center gap-1 font-medium text-stone-700">
              <FileText className="h-3.5 w-3.5" />
              {result.fileName}
            </span>
            <span>·</span>
            <span>{result.totalPages} páginas analizadas</span>
            <span>·</span>
            <span>{result.charCount.toLocaleString("es-ES")} caracteres</span>
          </div>
          <h3 className="text-lg font-semibold text-stone-900 leading-snug">
            {result.title}
          </h3>
          {result.organism && (
            <p className="text-sm text-stone-600">{result.organism}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <ScoreBadge score={result.fit.score} tier={result.fit.tier} />
          {result.fit.outsideManualSources ? (
            <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800">
              Fuera de tus 4 fuentes
            </span>
          ) : (
            <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-medium text-stone-600">
              Fuente habitual: {result.fit.manualSourceMatch}
            </span>
          )}
        </div>
      </div>

      {result.fit.workLines.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {result.fit.workLines.map((line) => (
            <WorkLinePill key={line} line={line} />
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-[#F4F8F5] p-4 space-y-2 border border-emerald-100">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[#1B4332] flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            Por qué encaja con Reforesta
          </h4>
          <ul className="space-y-1.5 text-sm text-stone-700">
            {result.fit.reasons.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl bg-amber-50/70 p-4 space-y-2 border border-amber-200/70">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-900 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" />
            Qué vigilar / Dealbreakers
          </h4>
          {result.fit.warnings.length > 0 ? (
            <ul className="space-y-1.5 text-sm text-amber-950">
              {result.fit.warnings.map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-600">
              No se detectan exclusiones obvias (nominativa o solo PYMEs) en el texto extraído.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Objeto detectado
        </h4>
        <p className="text-sm text-stone-800 leading-relaxed bg-stone-50 rounded-xl p-3.5 border border-stone-200/70">
          {result.summary}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <DetailBlock
          title="Beneficiarios"
          items={result.beneficiaries}
          empty="No se detectó cláusula explícita de beneficiarios en las frases clave."
        />
        <DetailBlock
          title="Importe y financiación"
          items={result.budgetHighlights}
          empty="Revisar anexo económico en el PDF."
        />
        <DetailBlock
          title="Plazos detectados"
          items={result.deadlineHighlights}
          empty="Revisar extracto publicado en el boletín oficial."
        />
        <DetailBlock
          title="Requisitos y obligaciones"
          items={result.requirements}
          empty="Sin requisitos destacados automáticamente."
        />
      </div>

      <details className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
        <summary className="cursor-pointer font-medium text-stone-700">
          Ver extracto inicial del texto extraído
        </summary>
        <pre className="mt-2 whitespace-pre-wrap font-sans leading-relaxed text-stone-600">
          {result.excerpt}
        </pre>
      </details>
    </div>
  );
}

function DetailBlock({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <div className="rounded-xl border border-stone-200 p-4 space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
        {title}
      </h4>
      {items.length > 0 ? (
        <ul className="space-y-1.5 text-xs text-stone-700 leading-relaxed">
          {items.map((item, idx) => (
            <li key={idx}>• {item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-stone-400">{empty}</p>
      )}
    </div>
  );
}

export function PdfAnalyzerTab() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PdfAnalysisResult | null>(null);

  async function analyzeSample(sample: "madrid" | "miteco") {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error analizando el PDF");
      setResult(data as PdfAnalysisResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/analyze-pdf", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error analizando el PDF");
      setResult(data as PdfAnalysisResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-stone-900 flex items-center gap-2">
              <FileSearch className="h-5 w-5 text-[#2D6A4F]" />
              Analizador rápido de bases (PDF → Decisión en 30s)
            </h2>
            <p className="text-sm text-stone-600">
              Sube un PDF de bases reguladoras o prueba directamente con las{" "}
              <strong>2 convocatorias reales de ejemplo</strong> del reto para extraer
              beneficiarios, cuantía, plazos y encaje sin leer 40 páginas.
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#1B4332] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2D6A4F] transition shrink-0">
            <Upload className="h-4 w-4" />
            Subir PDF de bases
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 pt-4 border-t border-stone-100">
          <span className="text-xs font-medium text-stone-500 flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5 text-emerald-700" />
            Probar con PDFs reales del reto:
          </span>
          <button
            type="button"
            disabled={loading}
            onClick={() => analyzeSample("madrid")}
            className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-800 hover:bg-emerald-50 hover:border-emerald-300 transition cursor-pointer disabled:opacity-50"
          >
            Comunidad de Madrid · Orden 1689/2026
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => analyzeSample("miteco")}
            className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-800 hover:bg-emerald-50 hover:border-emerald-300 transition cursor-pointer disabled:opacity-50"
          >
            MITECO · BDNS 923290
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white p-12 text-sm text-stone-600">
          <Loader2 className="h-5 w-5 animate-spin text-[#2D6A4F]" />
          Extrayendo texto y evaluando encaje con el perfil de Reforesta...
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </div>
      )}

      {!loading && result && <PdfResultCard result={result} />}
    </div>
  );
}
