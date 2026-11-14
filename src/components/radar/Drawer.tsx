"use client";

import { ArrowUpRight, CircleAlert, CircleCheck, FileText, Loader2, ScanSearch } from "lucide-react";
import { Fragment, useState } from "react";
import type { Opportunity, OpportunityDocument } from "@/lib/opportunity";
import type { PdfAnalysisResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { daysLeft, fmtDate, fmtEuros, KIND_LABELS, tidy, TIER_LABELS, TRIAGE_LABELS, TRIAGE_ORDER, workLineLabel } from "./model";
import { useRadar } from "./store";
import { analyzePdf, PdfResult } from "./PdfView";
import { DeadlineChip } from "./ui";

export function DetailDrawer() {
  const { selectedId, byId, closeDetail } = useRadar();
  const o = selectedId ? byId.get(selectedId) : undefined;
  // Keep the last opportunity rendered while the sheet animates out.
  const [shown, setShown] = useState(o);
  if (o && o !== shown) setShown(o);

  return (
    <Sheet open={!!o} onOpenChange={(v) => !v && closeDetail()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[520px]">{shown && <DrawerBody key={shown.id} o={shown} />}</SheetContent>
    </Sheet>
  );
}

const VERDICT = {
  alto: "Sí, merece la pena estudiarla",
  medio: "Puede encajar: revisa los avisos",
  bajo: "Encaja poco con lo que hacéis",
} as const;

function DrawerBody({ o }: { o: Opportunity }) {
  const { fit } = o;
  const amount = fmtEuros(o.budget) ?? o.amountText;
  const d = daysLeft(o);
  const elig =
    fit.isOngEligible === true ? "Pueden pedirla asociaciones y ONG" : fit.isOngEligible === false ? "No parece abierta a ONG" : "No consta si pueden pedirla ONG";

  const sections = [
    <section key="fit" aria-label="¿Encaja?" className="space-y-4">
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "grid size-12 shrink-0 place-items-center rounded-lg text-lg font-semibold tabular-nums",
            fit.tier === "alto" ? "bg-primary text-primary-foreground" : fit.tier === "medio" ? "bg-secondary text-foreground" : "border text-muted-foreground",
          )}
        >
          {fit.score}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">¿Encaja? · {TIER_LABELS[fit.tier]}</p>
          <p className="font-medium">{VERDICT[fit.tier]}</p>
          {fit.workLines.length > 0 && <p className="text-xs text-muted-foreground">{fit.workLines.map(workLineLabel).join(" · ")}</p>}
        </div>
      </div>
      {fit.reasons.length + fit.warnings.length > 0 && (
        <ul className="space-y-2">
          {fit.reasons.map((r, i) => (
            <li key={`r${i}`} className="flex gap-2 leading-snug">
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              {r}
            </li>
          ))}
          {fit.warnings.map((w, i) => (
            <li key={`w${i}`} className="flex gap-2 leading-snug">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      )}
      <ul className="space-y-1 text-xs text-muted-foreground">
        <li>{elig}</li>
        <li>{fit.isCompetitive ? "Concurrencia competitiva" : "No es de concurrencia competitiva"}</li>
        <li>{fit.outsideManualSources ? "Fuera de vuestras 4 fuentes habituales" : `Fuente habitual: ${fit.manualSourceMatch ?? "sí"}`}</li>
      </ul>
    </section>,
    <TriagePicker key="triage" o={o} />,
    <section key="facts" className="space-y-3">
      <SectionTitle>Lo esencial</SectionTitle>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        <Fact label="Plazo" wide={!o.deadline}>
          <span className="flex flex-wrap items-center gap-2">
            {o.deadline ? fmtDate(o.deadline) : (o.deadlineText ?? "Sin fecha publicada")}
            {d != null && <DeadlineChip o={o} />}
          </span>
        </Fact>
        {o.opensAt && <Fact label="Abre">{fmtDate(o.opensAt)}</Fact>}
        <Fact label="Importe">{amount ?? <span className="text-muted-foreground">No publicado</span>}</Fact>
        <Fact label="Territorio">{o.region}</Fact>
        {o.tipo && <Fact label="Tipo">{o.tipo}</Fact>}
        {o.publishedAt && <Fact label="Publicada">{fmtDate(o.publishedAt)}</Fact>}
        {o.beneficiarios.length > 0 && (
          <Fact label="Quién puede pedirla" wide>
            {o.beneficiarios.map(tidy).join(" · ")}
          </Fact>
        )}
      </dl>
    </section>,
    o.summary && (
      <section key="summary" className="space-y-2">
        <SectionTitle>De qué va</SectionTitle>
        <p className="leading-relaxed">{o.summary}</p>
      </section>
    ),
    o.rsc && (
      <section key="rsc" className="space-y-3">
        <SectionTitle>Cómo acercarse</SectionTitle>
        <dl className="space-y-3">
          <Fact label="Por qué Reforesta">{o.rsc.whyReforesta}</Fact>
          <Fact label="Ángulo para la propuesta">{o.rsc.pitchAngle}</Fact>
          <Fact label="Cuándo">{o.rsc.cadence}</Fact>
        </dl>
      </section>
    ),
    o.documents.length > 0 && (
      <section key="docs" className="space-y-2">
        <SectionTitle>Documentos</SectionTitle>
        <ul className="divide-y rounded-lg border">
          {o.documents.map((doc, i) => (
            <DocRow key={i} doc={doc} />
          ))}
        </ul>
      </section>
    ),
  ].filter(Boolean);

  return (
    <>
      <SheetHeader className="gap-1.5 border-b px-6 py-5 pr-12">
        <SheetDescription className="text-xs">
          {o.sourceLabel} · {KIND_LABELS[o.kind]} · {o.region}
        </SheetDescription>
        <SheetTitle className="text-base leading-snug">{tidy(o.titulo)}</SheetTitle>
        <p className="text-sm text-muted-foreground">{tidy(o.organismo)}</p>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {sections.map((s, i) => (
          <Fragment key={i}>
            {i > 0 && <Separator className="my-6" />}
            {s}
          </Fragment>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 border-t px-6 py-4">
        <Button asChild>
          <a href={o.url} target="_blank" rel="noreferrer">
            Ver ficha oficial <ArrowUpRight aria-hidden />
          </a>
        </Button>
        {o.basesUrl && (
          <Button asChild variant="outline">
            <a href={o.basesUrl} target="_blank" rel="noreferrer">
              Bases reguladoras <ArrowUpRight aria-hidden />
            </a>
          </Button>
        )}
      </div>
    </>
  );
}

function SectionTitle({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h3 id={id} className="text-xs font-medium text-muted-foreground">
      {children}
    </h3>
  );
}

function Fact({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("space-y-0.5", wide && "sm:col-span-2")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function TriagePicker({ o }: { o: Opportunity }) {
  const { triageOf, setTriage } = useRadar();
  const cur = triageOf(o.id);
  return (
    <section className="space-y-2">
      <SectionTitle id="triage-h">Vuestra decisión</SectionTitle>
      <div role="radiogroup" aria-labelledby="triage-h" className="flex flex-wrap gap-1.5">
        {TRIAGE_ORDER.map((t) => {
          const on = t === cur;
          return (
            <Button key={t} size="sm" variant={on ? "default" : "outline"} role="radio" aria-checked={on} onClick={() => setTriage(o, t)}>
              {TRIAGE_LABELS[t]}
            </Button>
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
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <a href={doc.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">
          <span className="line-clamp-2">{doc.description || doc.name}</span>
        </a>
        {state !== "done" && (
          <Button size="sm" variant="outline" onClick={run} disabled={state === "loading"} className="shrink-0">
            {state === "loading" ? <Loader2 className="animate-spin" aria-hidden /> : <ScanSearch aria-hidden />}
            {state === "loading" ? "Leyendo…" : state === "error" ? "Reintentar" : "Analizar PDF"}
          </Button>
        )}
      </div>
      {state === "error" && (
        <p role="alert" className="flex gap-2 text-xs text-red-800">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden /> {err.replace(/\.+$/, "")}. Puedes abrir el documento y subirlo en «Analizar PDF».
        </p>
      )}
      {result && (
        <div className="rounded-lg bg-muted/50 p-4">
          <PdfResult result={result} compact />
        </div>
      )}
    </li>
  );
}
