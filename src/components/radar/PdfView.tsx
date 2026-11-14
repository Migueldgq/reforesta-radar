"use client";

import { CircleAlert, CircleCheck, CircleDashed, CircleDot, FileText, RotateCw, TriangleAlert, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { PdfAnalysisResult } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TIER_LABELS, tidy, workLineLabel } from "./model";

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

const MAX_MB = 15;

const VERDICT = {
  alto: "Merece la pena leer las bases con calma.",
  medio: "Puede encajar, pero revisa los avisos antes de dedicarle tiempo.",
  bajo: "Encaja poco con lo que hacéis; probablemente no compense.",
} as const;

const TIER_ICON = { alto: CircleCheck, medio: CircleDot, bajo: CircleDashed } as const;
const TIER_BADGE = { alto: "default", medio: "secondary", bajo: "outline" } as const;

/** Electronic-signature cover pages often get picked up as the "title". */
const SIGNATURE_TITLE = /^\s*(informe de firma|csv\b|c[oó]digo seguro de verificaci[oó]n|firmado electr[oó]nicamente|detalle de la convocatoria\s*$)/i;

function displayTitle(r: PdfAnalysisResult): string {
  const t = r.title?.trim();
  if (!t || SIGNATURE_TITLE.test(t)) return r.fileName;
  return tidy(t).replace(/[\s,;:]+$/, "");
}

/** 30-second decision sheet for an analysed PDF. Used standalone (in a Card) and inside the detail sheet (`compact`). */
export function PdfResult({ result, compact = false }: { result: PdfAnalysisResult; compact?: boolean }) {
  const { fit } = result;
  const TierIcon = TIER_ICON[fit.tier];
  const sections: { title: string; items: string[]; empty: string; icon?: "ok" | "warn" }[] = [
    { title: "Motivos", items: fit.reasons, empty: "No hemos encontrado motivos claros de encaje.", icon: "ok" },
    { title: "Avisos", items: fit.warnings, empty: "No vemos exclusiones evidentes en el texto.", icon: "warn" },
    { title: "Plazos", items: result.deadlineHighlights, empty: "Revisa el extracto publicado en el boletín." },
    { title: "Importes", items: result.budgetHighlights, empty: "Revisa el anexo económico del PDF." },
    { title: "Quién puede pedirla", items: result.beneficiaries, empty: "No aparece una cláusula clara de beneficiarios." },
    { title: "Requisitos", items: result.requirements, empty: "Sin requisitos destacados." },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-1.5">
        {!compact && <h2 className="text-lg leading-snug font-semibold text-balance break-words text-foreground">{displayTitle(result)}</h2>}
        {!compact && result.organism && tidy(result.organism) !== displayTitle(result) && <p className="text-sm text-muted-foreground">{tidy(result.organism)}</p>}
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <FileText className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-all">{result.fileName}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{result.totalPages} páginas</span>
        </p>
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Badge variant={TIER_BADGE[fit.tier]} className="gap-1.5 px-2.5 py-1 text-sm" title={`${fit.score} de 100`}>
            <TierIcon aria-hidden className="size-3.5!" />
            <span className="font-semibold tabular-nums">{fit.score}</span>
            <span className="opacity-60">/100</span>
          </Badge>
          <span className="text-sm font-medium text-foreground">{TIER_LABELS[fit.tier]}</span>
        </div>
        <p className="text-sm text-foreground">{VERDICT[fit.tier]}</p>
        {fit.workLines.length > 0 && <p className="text-xs text-muted-foreground">Líneas: {fit.workLines.map(workLineLabel).join(" · ")}</p>}
        {result.summary && <p className="line-clamp-3 pt-1 text-sm leading-relaxed text-muted-foreground" title={result.summary}>
            {result.summary}
          </p>}
      </div>

      <Separator />

      <div className={cn("grid gap-x-8 gap-y-6", !compact && "md:grid-cols-2")}>
        {sections.map((s) => (
          <ListBlock key={s.title} {...s} />
        ))}
      </div>

      {result.excerpt && (
        <details className="group text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Ver el inicio del texto leído</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 font-sans text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {result.excerpt}
          </pre>
        </details>
      )}
    </div>
  );
}

function ListBlock({ title, items, empty, icon }: { title: string; items: string[]; empty: string; icon?: "ok" | "warn" }) {
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((t, i) => (
            <li key={i} className="flex gap-2 text-sm leading-snug break-words text-muted-foreground">
              {icon === "ok" ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-label="A favor" />
              ) : icon === "warn" ? (
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-foreground" aria-label="Aviso" />
              ) : (
                <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
              )}
              <span className="line-clamp-3 min-w-0" title={t}>
                {t}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground/80">{empty}</p>
      )}
    </section>
  );
}

const SAMPLES = [
  { key: "madrid", label: "Comunidad de Madrid · Orden 1689/2026" },
  { key: "miteco", label: "MITECO · BDNS 923290" },
] as const;

export function PdfView() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PdfAnalysisResult | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [last, setLast] = useState<{ req: PdfRequest; label: string } | null>(null);

  async function run(req: PdfRequest, label: string) {
    setLast({ req, label });
    setLoading(label);
    setError(null);
    setResult(null);
    try {
      setResult(await analyzePdf(req));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(null);
    }
  }

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (input.current) input.current.value = "";
    if (f.size > MAX_MB * 1024 * 1024) {
      setLast(null);
      setResult(null);
      setError(`El PDF supera ${MAX_MB} MB. Prueba con uno más ligero.`);
      return;
    }
    void run(f, f.name);
  };

  const reset = () => {
    setResult(null);
    setError(null);
    setLast(null);
  };

  const showPicker = !result && !loading;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Analizar PDF</h1>
        <p className="text-sm text-muted-foreground">Sube las bases en PDF y te decimos en 30 segundos si merece la pena leerlas.</p>
      </header>

      {error && !loading && (
        <Alert variant="destructive" className="has-[>svg]:gap-x-3">
          <CircleAlert aria-hidden />
          <AlertTitle className="line-clamp-none">No hemos podido analizar el PDF</AlertTitle>
          <AlertDescription className="gap-3 text-muted-foreground!">
            <p>{error}</p>
            {last && !(last.req instanceof File) ? (
              <Button variant="outline" size="sm" onClick={() => run(last.req, last.label)}>
                <RotateCw aria-hidden />
                Reintentar
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
                <Upload aria-hidden />
                Elegir otro archivo
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {showPicker && (
        <div className="flex flex-col gap-4">
          <Card
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
            data-drag={drag || undefined}
            className="items-center gap-4 border-2 border-dashed px-6 py-12 text-center shadow-none transition-colors data-[drag]:border-primary data-[drag]:bg-accent"
          >
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Upload className="size-5" aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{drag ? "Suelta el PDF aquí" : "Arrastra un PDF o elige un archivo"}</p>
              <p className="text-xs text-muted-foreground">Solo PDF con texto, hasta {MAX_MB} MB</p>
            </div>
            <Button onClick={() => input.current?.click()}>Elegir archivo</Button>
            <input
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </Card>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <span className="text-sm text-muted-foreground">O prueba con un PDF del reto:</span>
            {SAMPLES.map((s) => (
              <Button key={s.key} variant="outline" size="sm" className="justify-start" onClick={() => run({ sample: s.key }, s.label)}>
                <FileText aria-hidden />
                {s.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <Card className="gap-5 px-6 shadow-none" role="status" aria-live="polite">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Leyendo el PDF…</p>
            <p className="truncate text-xs text-muted-foreground">{loading}</p>
          </div>
          <Separator />
          <div className="space-y-2">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <Separator />
          <div className="grid gap-6 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            ))}
          </div>
        </Card>
      )}

      {result && !loading && (
        <Card className="gap-6 px-5 shadow-none sm:px-6">
          <PdfResult result={result} />
          <Separator />
          <div>
            <Button variant="outline" onClick={reset}>
              <Upload aria-hidden />
              Analizar otro
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
