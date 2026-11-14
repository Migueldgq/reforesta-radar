"use client";

import { ArrowUpRight, CircleAlert, CircleCheck, FileText, Loader2, ScanSearch, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Opportunity, OpportunityDocument } from "@/lib/opportunity";
import type { PdfAnalysisResult } from "@/lib/types";
import { daysLeft, fmtDate, fmtEuros, KIND_LABELS, tidy, TIER_LABELS, TRIAGE_LABELS, TRIAGE_ORDER, workLineLabel } from "./model";
import { useRadar } from "./store";
import { analyzePdf, PdfResult } from "./PdfView";
import { cx, DeadlineChip } from "./ui";

export function DetailDrawer() {
  const { selectedId, byId, closeDetail } = useRadar();
  const ref = useRef<HTMLDialogElement>(null);
  const o = selectedId ? byId.get(selectedId) : undefined;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (o && !d.open) d.showModal();
    if (!o && d.open) d.close();
  }, [o]);

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby="drawer-title"
      onClose={closeDetail}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeDetail();
      }}
    >
      {o && <DrawerBody key={o.id} o={o} onClose={closeDetail} />}
    </dialog>
  );
}

const VERDICT = {
  alto: "Sí, merece la pena estudiarla",
  medio: "Puede encajar: revisa los avisos",
  bajo: "Encaja poco con lo que hacéis",
} as const;

function DrawerBody({ o, onClose }: { o: Opportunity; onClose: () => void }) {
  const { fit } = o;
  const amount = fmtEuros(o.budget) ?? o.amountText;
  const d = daysLeft(o);
  const elig =
    fit.isOngEligible === true
      ? "Pueden pedirla asociaciones y ONG"
      : fit.isOngEligible === false
        ? "No parece abierta a ONG"
        : "No consta si pueden pedirla ONG";

  return (
    <div className="flex h-full flex-col bg-white shadow-2xl sm:rounded-l-2xl">
      <header className="flex items-start justify-between gap-3 border-b border-stone-100 px-5 py-4 sm:px-6">
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-stone-500">
            <span className="font-medium text-stone-700">{o.sourceLabel}</span> · {KIND_LABELS[o.kind]} · {o.region}
          </p>
          <h2 id="drawer-title" className="text-lg leading-snug font-semibold text-stone-900">
            {tidy(o.titulo)}
          </h2>
          <p className="text-sm text-stone-500">{tidy(o.organismo)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          autoFocus
          aria-label="Cerrar"
          className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-900"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      <div className="flex-1 space-y-7 overflow-y-auto px-5 py-5 sm:px-6">
        {/* Verdict */}
        <section aria-label="¿Encaja?" className="rounded-2xl bg-gradient-to-br from-brand-50 via-white to-white p-5 ring-1 ring-brand-100">
          <div className="flex items-center gap-4">
            <div
              className={cx(
                "grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-xl font-semibold tabular-nums",
                fit.tier === "alto" ? "bg-brand-800 text-white" : fit.tier === "medio" ? "bg-brand-100 text-brand-900" : "bg-stone-100 text-stone-600",
              )}
            >
              {fit.score}
            </div>
            <div>
              <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">¿Encaja? · {TIER_LABELS[fit.tier]}</p>
              <p className="text-base font-semibold text-stone-900">{VERDICT[fit.tier]}</p>
              {fit.workLines.length > 0 && <p className="text-xs text-stone-500">{fit.workLines.map(workLineLabel).join(" · ")}</p>}
            </div>
          </div>
          <ul className="mt-4 space-y-1.5">
            {fit.reasons.map((r, i) => (
              <li key={`r${i}`} className="flex gap-2 text-sm leading-snug text-stone-700">
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                {r}
              </li>
            ))}
            {fit.warnings.map((w, i) => (
              <li key={`w${i}`} className="flex gap-2 text-sm leading-snug text-stone-700">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
            <span>{elig}</span>
            <span>{fit.isCompetitive ? "Concurrencia competitiva" : "No es de concurrencia competitiva"}</span>
            <span>{fit.outsideManualSources ? "Fuera de vuestras 4 fuentes habituales" : `Fuente habitual: ${fit.manualSourceMatch ?? "sí"}`}</span>
          </p>
        </section>

        <TriagePicker o={o} />

        {/* Key facts */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Lo esencial</h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Fact label="Plazo" wide={!o.deadline}>
              <span className="flex flex-wrap items-center gap-2">
                {o.deadline ? fmtDate(o.deadline) : o.deadlineText ?? "Sin fecha publicada"}
                {d != null && <DeadlineChip o={o} />}
              </span>
            </Fact>
            {o.opensAt && <Fact label="Abre">{fmtDate(o.opensAt)}</Fact>}
            <Fact label="Importe">{amount ?? <span className="text-stone-400">No publicado</span>}</Fact>
            <Fact label="Territorio">{o.region}</Fact>
            {o.tipo && <Fact label="Tipo">{o.tipo}</Fact>}
            {o.publishedAt && <Fact label="Publicada">{fmtDate(o.publishedAt)}</Fact>}
            {o.beneficiarios.length > 0 && (
              <Fact label="Quién puede pedirla" wide>
                {o.beneficiarios.map(tidy).join(" · ")}
              </Fact>
            )}
          </dl>
        </section>

        {o.summary && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">De qué va</h3>
            <p className="text-sm leading-relaxed text-stone-800">{o.summary}</p>
          </section>
        )}

        {o.rsc && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Cómo acercarse</h3>
            <Fact label="Por qué Reforesta">{o.rsc.whyReforesta}</Fact>
            <Fact label="Ángulo para la propuesta">{o.rsc.pitchAngle}</Fact>
            <Fact label="Cuándo">{o.rsc.cadence}</Fact>
          </section>
        )}

        {o.documents.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Documentos</h3>
            <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200">
              {o.documents.map((doc, i) => (
                <DocRow key={i} doc={doc} />
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer className="flex flex-wrap gap-2 border-t border-stone-100 px-5 py-3.5 sm:px-6">
        <a
          href={o.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-800 px-4 text-sm font-medium text-white hover:bg-brand-900"
        >
          Ver ficha oficial <ArrowUpRight className="h-4 w-4" aria-hidden />
        </a>
        {o.basesUrl && (
          <a
            href={o.basesUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-800 hover:bg-stone-50"
          >
            Bases reguladoras <ArrowUpRight className="h-4 w-4" aria-hidden />
          </a>
        )}
      </footer>
    </div>
  );
}

function Fact({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cx("space-y-0.5", wide && "sm:col-span-2")}>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="text-sm text-stone-900">{children}</dd>
    </div>
  );
}

function TriagePicker({ o }: { o: Opportunity }) {
  const { triageOf, setTriage } = useRadar();
  const cur = triageOf(o.id);
  return (
    <section className="space-y-2">
      <h3 id="triage-h" className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
        Vuestra decisión
      </h3>
      <div role="radiogroup" aria-labelledby="triage-h" className="flex flex-wrap gap-1.5">
        {TRIAGE_ORDER.map((t) => {
          const on = t === cur;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setTriage(o, t)}
              className={cx(
                "h-9 cursor-pointer rounded-lg border px-3 text-sm font-medium transition-colors",
                on ? "border-brand-800 bg-brand-800 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50",
              )}
            >
              {TRIAGE_LABELS[t]}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DocRow({ doc }: { doc: OpportunityDocument }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<PdfAnalysisResult | null>(null);
  const [err, setErr] = useState("");
  const fileName = doc.name || doc.description || "documento.pdf";

  async function run() {
    setState("loading");
    try {
      const r = await analyzePdf(doc.docId != null ? { docId: doc.docId, fileName } : { pdfUrl: doc.url, fileName });
      setResult(r);
      setState("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setState("error");
    }
  }

  return (
    <li className="space-y-3 px-3.5 py-3">
      <div className="flex items-center gap-3">
        <FileText className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
        <a href={doc.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 text-sm text-stone-800 hover:text-brand-800 hover:underline">
          <span className="line-clamp-2">{doc.description || doc.name}</span>
        </a>
        {state !== "done" && (
          <button
            type="button"
            onClick={run}
            disabled={state === "loading"}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-stone-300 px-2.5 text-xs font-medium text-stone-800 hover:bg-stone-50 disabled:cursor-wait"
          >
            {state === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ScanSearch className="h-3.5 w-3.5" aria-hidden />}
            {state === "loading" ? "Leyendo…" : state === "error" ? "Reintentar" : "Analizar PDF"}
          </button>
        )}
      </div>
      {state === "error" && (
        <p role="alert" className="flex gap-2 text-xs text-red-800">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden /> {err.replace(/\.+$/, "")}. Puedes abrir el documento y subirlo en «Analizar PDF».
        </p>
      )}
      {result && (
        <div className="rounded-xl bg-stone-50/70 p-4 ring-1 ring-stone-200">
          <PdfResult result={result} compact />
        </div>
      )}
    </li>
  );
}
