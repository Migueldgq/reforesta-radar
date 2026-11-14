"use client";

import { CircleAlert, CircleCheck, FileText, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { PdfAnalysisResult } from "@/lib/types";
import { tidy, workLineLabel } from "./model";
import { Button, cx, FitChip, PageHeader, Panel } from "./ui";

export type PdfRequest = { docId: number; fileName: string } | { pdfUrl: string; fileName: string } | { sample: "madrid" | "miteco" } | File;

export async function analyzePdf(req: PdfRequest): Promise<PdfAnalysisResult> {
  const init: RequestInit =
    req instanceof File
      ? (() => {
          const fd = new FormData();
          fd.append("file", req);
          return { method: "POST", body: fd };
        })()
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) };
  const res = await fetch("/api/analyze-pdf", init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `No se pudo analizar el PDF (${res.status})`);
  return data as PdfAnalysisResult;
}

const VERDICT = {
  alto: "Merece la pena estudiarla",
  medio: "Puede encajar: revisa los avisos",
  bajo: "Encaja poco con lo que hacéis",
} as const;

/** 30-second decision sheet for an analysed PDF. */
export function PdfResult({ result, compact = false }: { result: PdfAnalysisResult; compact?: boolean }) {
  const { fit } = result;
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-stone-500">
          <FileText className="h-3.5 w-3.5" aria-hidden />
          <span className="font-medium text-stone-700">{result.fileName}</span>
          <span aria-hidden>·</span>
          <span>{result.totalPages} páginas leídas</span>
        </p>
        {!compact && <h2 className="text-lg leading-snug font-semibold text-stone-900">{tidy(result.title)}</h2>}
        {!compact && result.organism && <p className="text-sm text-stone-500">{tidy(result.organism)}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-stone-50 px-4 py-3">
        <FitChip fit={fit} />
        <span className="text-sm font-medium text-stone-900">{VERDICT[fit.tier]}</span>
        {fit.workLines.length > 0 && <span className="text-xs text-stone-500">{fit.workLines.map(workLineLabel).join(" · ")}</span>}
      </div>

      <div className={cx("grid gap-5", !compact && "md:grid-cols-2")}>
        <ListBlock title="Por qué encaja" items={fit.reasons} icon="ok" empty="No hemos encontrado motivos claros de encaje." />
        <ListBlock title="Qué vigilar" items={fit.warnings} icon="warn" empty="No vemos exclusiones evidentes en el texto." />
      </div>

      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">De qué va</h3>
        <p className="text-sm leading-relaxed text-stone-800">{result.summary}</p>
      </div>

      <div className={cx("grid gap-5", !compact && "md:grid-cols-2")}>
        <ListBlock title="Quién puede pedirla" items={result.beneficiaries} empty="No aparece una cláusula clara de beneficiarios." />
        <ListBlock title="Dinero" items={result.budgetHighlights} empty="Revisa el anexo económico del PDF." />
        <ListBlock title="Plazos" items={result.deadlineHighlights} empty="Revisa el extracto publicado en el boletín." />
        <ListBlock title="Requisitos y obligaciones" items={result.requirements} empty="Sin requisitos destacados." />
      </div>

      <details className="group rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-600">
        <summary className="cursor-pointer font-medium text-stone-700">Ver el inicio del texto leído</summary>
        <pre className="mt-2 font-sans leading-relaxed whitespace-pre-wrap">{result.excerpt}</pre>
      </details>
    </div>
  );
}

function ListBlock({ title, items, empty, icon }: { title: string; items: string[]; empty: string; icon?: "ok" | "warn" }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{title}</h3>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((t, i) => (
            <li key={i} className="flex gap-2 text-sm leading-snug text-stone-700">
              {icon === "ok" ? (
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              ) : icon === "warn" ? (
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
              ) : (
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-stone-400" aria-hidden />
              )}
              <span>{t}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-stone-400">{empty}</p>
      )}
    </div>
  );
}

export function PdfView() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PdfAnalysisResult | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function run(req: PdfRequest, label: string) {
    setLoading(label);
    setError(null);
    try {
      setResult(await analyzePdf(req));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(null);
    }
  }

  const onFile = (f: File | undefined) => {
    if (f) void run(f, f.name);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Analizar unas bases"
        sub="Sube el PDF de unas bases o de una convocatoria y en unos segundos te decimos de qué va, quién puede pedirla, cuánto dinero hay, plazos y si encaja con Reforesta."
      />

      <Panel>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            onFile(e.dataTransfer.files?.[0]);
          }}
          className={cx(
            "m-2 flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
            drag ? "border-brand-500 bg-brand-50" : "border-stone-200",
          )}
        >
          <Upload className="h-6 w-6 text-stone-400" aria-hidden />
          <div>
            <p className="font-medium text-stone-900">Arrastra aquí el PDF</p>
            <p className="text-sm text-stone-500">o elígelo desde tu ordenador</p>
          </div>
          <Button onClick={() => input.current?.click()} disabled={!!loading}>
            Elegir PDF
          </Button>
          <input ref={input} type="file" accept="application/pdf" className="sr-only" tabIndex={-1} onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 px-5 py-3.5">
          <span className="text-xs text-stone-500">¿Sin PDF a mano? Prueba con uno real:</span>
          <Button variant="secondary" className="h-8 text-xs" disabled={!!loading} onClick={() => run({ sample: "madrid" }, "Comunidad de Madrid · Orden 1689/2026")}>
            Comunidad de Madrid · Orden 1689/2026
          </Button>
          <Button variant="secondary" className="h-8 text-xs" disabled={!!loading} onClick={() => run({ sample: "miteco" }, "MITECO · BDNS 923290")}>
            MITECO · BDNS 923290
          </Button>
        </div>
      </Panel>

      {loading && (
        <Panel>
          <div className="flex items-center justify-center gap-3 p-10 text-sm text-stone-600" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-hidden />
            Leyendo «{loading}»…
          </div>
        </Panel>
      )}
      {error && !loading && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </div>
      )}
      {result && !loading && (
        <Panel className="p-5 sm:p-6">
          <PdfResult result={result} />
        </Panel>
      )}
    </div>
  );
}
