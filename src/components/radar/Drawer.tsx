"use client";

import { ArrowUpRight, Award, CircleAlert, CircleCheck, FileText, Loader2, ScanSearch, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { Fragment, useState, type FormEvent } from "react";
import type { AwardsSummary, History, Opportunity, OpportunityDocument } from "@/lib/opportunity";
import type { PdfAnalysisResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { daysLeft, fmtDate, fmtDayShort, fmtEuros, joinEs, KIND_LABELS, parseDay, tidy, TIER_LABELS, TRIAGE_LABELS, TRIAGE_ORDER, workLineLabel } from "./model";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSession } from "@/components/auth/session";
import { fmtWhenShort, type BoardItem, type VoteValue } from "@/lib/team";
import { Input } from "@/components/ui/input";
import { stub, useRadar } from "./store";
import { analyzePdf, PdfResult } from "./PdfView";
import { ConfirmDialog, DeadlineChip, GoneNote, PersonAvatar, ScoreChip, textareaClass } from "./ui";

type Shown = { o: Opportunity; gone: BoardItem | null };

export function DetailDrawer() {
  const { selectedId, byId, board, closeDetail } = useRadar();
  // Calls gone from the sources only live on the board: draw them from its snapshot.
  const live = selectedId ? byId.get(selectedId) : undefined;
  const item = selectedId ? board[selectedId] : undefined;
  const cur: Shown | undefined = live ? { o: live, gone: null } : item ? { o: stub(item), gone: item } : undefined;
  // Keep the last opportunity rendered while the sheet animates out.
  const [shown, setShown] = useState(cur);
  if (cur && (cur.o !== shown?.o || cur.gone !== shown?.gone)) setShown(cur);

  return (
    <Sheet open={!!cur} onOpenChange={(v) => !v && closeDetail()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[520px]">
        {shown && (shown.gone ? <GoneBody key={shown.o.id} o={shown.o} item={shown.gone} /> : <DrawerBody key={shown.o.id} o={shown.o} />)}
      </SheetContent>
    </Sheet>
  );
}

/** A board call that is no longer in the sources: what was saved, plus the team's decision, owner and notes. */
function GoneBody({ o, item }: { o: Opportunity; item: BoardItem }) {
  return (
    <>
      <SheetHeader className="gap-1.5 border-b px-6 py-5 pr-12">
        <SheetDescription className="text-xs">Guardada en el tablero del equipo</SheetDescription>
        <SheetTitle className="text-base leading-snug">{tidy(item.titulo)}</SheetTitle>
        <p className="text-sm text-muted-foreground">{tidy(item.organismo)}</p>
      </SheetHeader>
      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
        <div className="space-y-2">
          <GoneNote />
          <p className="text-sm text-muted-foreground">
            No salió en la última consulta a las fuentes: puede que la hayan retirado o que la fuente no responda. Se muestra lo que se guardó
            {item.deadline ? `; el plazo era el ${fmtDate(item.deadline)}` : ""}.
          </p>
        </div>
        <Separator />
        <TriagePicker o={o} />
        <Separator />
        <TeamSection o={o} />
      </div>
      {item.url && (
        <div className="flex flex-wrap gap-2 border-t px-6 py-4">
          <Button asChild variant="outline">
            <a href={item.url} target="_blank" rel="noreferrer">
              Ver la última ficha oficial <ArrowUpRight aria-hidden />
            </a>
          </Button>
        </div>
      )}
    </>
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
        <ScoreChip fit={fit} size="lg" />
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
        <li>{fit.outsideManualSources ? "No es de los organismos que ya revisáis a mano" : `Organismo que ya revisáis: ${fit.manualSourceMatch ?? "sí"}`}</li>
      </ul>
    </section>,
    <TriagePicker key="triage" o={o} />,
    <VoteSection key="vote" o={o} />,
    <TeamSection key="team" o={o} />,
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
    o.history && hasHistory(o.history) && <HistorySection key="history" h={o.history} />,
    o.summary && (
      <section key="summary" className="space-y-2">
        <SectionTitle>De qué va</SectionTitle>
        <p className="leading-relaxed">{o.summary}</p>
      </section>
    ),
    o.rsc && (
      <section key="rsc" className="space-y-3">
        <SectionTitle>Programa privado</SectionTitle>
        <dl className="space-y-3">
          <Fact label="Por qué puede encajar">{o.rsc.whyReforesta}</Fact>
          <Fact label="Último plazo">{o.rsc.window}</Fact>
          <Fact label="Requisitos">
            <ul className="list-disc space-y-0.5 pl-4">
              {o.rsc.requirements.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Fact>
          {o.rsc.unverified && <Fact label="Sin comprobar">{o.rsc.unverified}</Fact>}
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

function hasHistory(h: History): boolean {
  return h.editions.length > 0 || !!h.awards || !!h.typicalOpening || !!h.typicalWindow;
}

/** Recipient classes in plain Spanish (plural, singular); anything not listed is "otras". */
const CLASS_NAMES: Record<string, [string, string]> = {
  sinAnimo: ["entidades sin ánimo de lucro", "entidad sin ánimo de lucro"],
  ayuntamiento: ["ayuntamientos", "ayuntamiento"],
  empresa: ["empresas", "empresa"],
  publico: ["universidades y organismos públicos", "universidad u organismo público"],
  persona: ["particulares", "particular"],
  otras: ["otras", "otra"],
};
// One hue for the class Reforesta belongs to; greys for the rest, darkest for the largest.
const GREYS = ["bg-foreground/45", "bg-foreground/30", "bg-foreground/18", "bg-foreground/10"];

function classRows(byClass: Record<string, number>) {
  const m = new Map<string, number>();
  for (const [k, n] of Object.entries(byClass)) {
    const key = k in CLASS_NAMES ? k : "otras";
    if (n > 0) m.set(key, (m.get(key) ?? 0) + n);
  }
  const rows = [...m].map(([key, n]) => ({ key, n })).sort((a, b) => (a.key === "sinAnimo" ? -1 : b.key === "sinAnimo" ? 1 : b.n - a.n));
  let g = 0;
  return rows.map((r) => ({ ...r, swatch: r.key === "sinAnimo" ? "bg-primary" : GREYS[Math.min(g++, GREYS.length - 1)] }));
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("es-ES")} ${n === 1 ? one : many}`;

function WinnersBlock({ a }: { a: AwardsSummary }) {
  const ayudas = plural(a.total, "ayuda", "ayudas");
  const where =
    a.total === 0
      ? null
      : a.nonProfit === a.total
        ? a.total === 1 ? "fue a una entidad sin ánimo de lucro" : "todas a entidades sin ánimo de lucro"
        : a.nonProfit === 0
          ? "ninguna a entidades sin ánimo de lucro"
          : `${a.nonProfit.toLocaleString("es-ES")} a entidades sin ánimo de lucro`;
  const rows = classRows(a.byClass);
  const years = joinEs([...a.editions].sort((x, y) => y - x).map(String));
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Quién la ganó</p>
      <p className="leading-snug">
        {a.total === 0 ? `No consta ninguna ayuda concedida en ${years}.` : `En ${years} se dieron ${ayudas}: ${where}.`}
        {a.peers.length > 0 && a.nonProfit > 0 && <> Entre ellas: {joinEs(a.peers)}.</>}
      </p>
      {rows.length > 1 && (
        <figure className="space-y-2 pt-1">
          <div className="flex h-2 w-full gap-px overflow-hidden rounded-full" aria-hidden>
            {rows.map((r) => (
              <span key={r.key} className={r.swatch} style={{ flexGrow: r.n, flexBasis: 0, minWidth: 3 }} />
            ))}
          </div>
          <figcaption>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {rows.map((r) => (
                <li key={r.key} className="flex items-center gap-1.5">
                  <span className={cn("size-2 shrink-0 rounded-[2px]", r.swatch)} aria-hidden />
                  <span>
                    <span className="font-medium text-foreground tabular-nums">{r.n.toLocaleString("es-ES")}</span> {CLASS_NAMES[r.key][r.n === 1 ? 1 : 0]}
                  </span>
                </li>
              ))}
            </ul>
          </figcaption>
        </figure>
      )}
    </div>
  );
}

const BDNS_AWARDS = "https://www.infosubvenciones.es/bdnstrans/GE/es/concesiones/consulta";

function HistorySection({ h }: { h: History }) {
  const wins = h.awards?.wonByReforesta ?? [];
  const wonYears = new Set(wins.map((w) => w.year));
  const opened = (s: string | null) => {
    const t = parseDay(s);
    return t == null ? null : fmtDayShort(t);
  };
  return (
    <section aria-labelledby="hist-h" className="space-y-4">
      <SectionTitle id="hist-h">Ediciones anteriores</SectionTitle>

      {wins.length > 0 && (
        <div className="flex gap-2.5 rounded-lg bg-primary/[0.06] px-3.5 py-3">
          <Award className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium">Reforesta la ganó en {joinEs(wins.map((w) => String(w.year)))}</p>
            {wins.some((w) => w.importe) && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {wins.map((w) => `${w.year}: ${fmtEuros(w.importe) ?? "importe no publicado"}`).join(" · ")}
              </p>
            )}
          </div>
        </div>
      )}

      {(h.typicalOpening || h.typicalWindow) && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {h.typicalOpening && <Fact label="Cuándo abre">{h.typicalOpening.text}</Fact>}
          {h.typicalWindow && <Fact label="Plazo habitual">{h.typicalWindow}</Fact>}
        </dl>
      )}

      {h.awards && <WinnersBlock a={h.awards} />}

      {h.editions.length > 0 && (
        <ul className="divide-y rounded-lg border" aria-label="Ediciones anteriores en BDNS">
          {h.editions.map((e) => {
            const from = opened(e.openedAt);
            const to = opened(e.closesAt);
            const when = from ? `Abrió el ${from}${to ? ` → ${to}` : e.window ? ` · ${e.window}` : ""}` : (e.window ?? "Sin fecha de apertura");
            const aw = e.awards;
            const awText = !aw ? "Sin datos de ayudas" : aw.count === 0 ? "Sin ayudas registradas" : [plural(aw.count, "ayuda", "ayudas"), fmtEuros(aw.importe)].filter(Boolean).join(" · ");
            return (
              <li key={e.numero} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="w-10 shrink-0 font-medium tabular-nums">{e.year}</span>
                <div className="min-w-0 flex-1">
                  <p className="leading-snug">{when}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular-nums">
                    {awText}
                    {wonYears.has(e.year) && (
                      <>
                        <span className="inline-flex items-center gap-1 font-medium text-primary">
                          <Award className="size-3" aria-hidden /> La ganasteis
                        </span>
                        {/* BDNS reads the call number from the URL (the NIF filter is not), so this opens that edition's awards, Reforesta's among them. */}
                        <a
                          href={`${BDNS_AWARDS}?numeroConvocatoria=${encodeURIComponent(e.numero)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Abre las concesiones de esta edición en BDNS; la de Reforesta (NIF G80428204) está entre ellas"
                          className="inline-flex items-center gap-0.5 rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          Ver concesión en BDNS <ArrowUpRight className="size-3" aria-hidden />
                          <span className="sr-only"> (se abre en otra pestaña)</span>
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Ver la edición de ${e.year} en BDNS (se abre en otra pestaña)`}
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  BDNS <ArrowUpRight className="size-3.5" aria-hidden />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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

/* ---------- "¿Os sirve?" votes (they tune the scoring rules over time) ---------- */

const VOTE_LABEL: Record<VoteValue, string> = { sirve: "Nos sirve", no_sirve: "No nos sirve" };

function VoteSection({ o }: { o: Opportunity }) {
  const { votes, setVote, clearVote } = useRadar();
  const { me } = useSession();
  const all = votes.filter((v) => v.opportunityId === o.id);
  const my = all.find((v) => v.user.id === me.id);
  const others = all.filter((v) => v.user.id !== me.id);
  const [reason, setReason] = useState(my?.reason ?? "");
  const yes = all.filter((v) => v.vote === "sirve").length;
  const no = all.length - yes;

  const choose = (v: VoteValue) => setVote(o.id, v, reason.trim());

  return (
    <section aria-labelledby="vote-h" className="space-y-3">
      <div className="space-y-0.5">
        <SectionTitle id="vote-h">¿Os sirve esta convocatoria?</SectionTitle>
        <p className="text-xs text-muted-foreground">Vuestros votos ayudan a ajustar cómo puntúa el radar.</p>
      </div>
      <div role="group" aria-labelledby="vote-h" className="flex flex-wrap gap-1.5">
        {(["sirve", "no_sirve"] as const).map((v) => {
          const on = my?.vote === v;
          const Icon = v === "sirve" ? ThumbsUp : ThumbsDown;
          return (
            <Button key={v} size="sm" variant={on ? "default" : "outline"} aria-pressed={on} onClick={() => choose(v)}>
              <Icon aria-hidden /> {VOTE_LABEL[v]}
            </Button>
          );
        })}
        {my && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => clearVote(o.id)}>
            Quitar mi voto
          </Button>
        )}
      </div>
      {my && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim() !== my.reason) choose(my.vote);
          }}
        >
          <label htmlFor={`reason-${o.id}`} className="sr-only">
            Por qué (opcional)
          </label>
          <Input
            id={`reason-${o.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Por qué (opcional): p. ej. «solo para ayuntamientos»"
            className="h-8 flex-1"
          />
          <Button type="submit" size="sm" variant="outline" disabled={reason.trim() === my.reason}>
            Guardar
          </Button>
        </form>
      )}
      {all.length > 0 && (
        <div className="space-y-2 rounded-lg bg-muted/50 px-3.5 py-3">
          <p className="text-xs text-muted-foreground tabular-nums">
            Votos del equipo · Nos sirve: {yes} · No nos sirve: {no}
          </p>
          {others.length > 0 && (
            <ul className="space-y-1.5">
              {others.map((v) => (
                <li key={v.user.id} className="flex items-start gap-2 text-sm">
                  {v.vote === "sirve" ? <ThumbsUp className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden /> : <ThumbsDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                  <span className="min-w-0">
                    <span className="font-medium">{v.user.name || "Alguien"}</span>
                    <span className="text-muted-foreground">: {VOTE_LABEL[v.vote].toLowerCase()}</span>
                    {v.reason && <span className="break-words text-muted-foreground"> · «{v.reason}»</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------- Responsable and notes (shared with the team) ---------- */

const NONE = "none";

function TeamSection({ o }: { o: Opportunity }) {
  return (
    <div className="space-y-6">
      <AssigneePicker o={o} />
      <NotesSection o={o} />
    </div>
  );
}

function AssigneePicker({ o }: { o: Opportunity }) {
  const { board, people, setAssignee } = useRadar();
  const cur = board[o.id]?.assignee ?? null;
  const active = people.filter((p) => p.active);
  // An assignee who was deactivated stays visible (and only replaceable).
  const options = cur && !active.some((p) => p.id === cur.id) ? [...active, { ...cur, active: false }] : active;
  return (
    <section className="space-y-2">
      <SectionTitle id="assignee-h">Responsable</SectionTitle>
      <Select
        value={cur ? String(cur.id) : NONE}
        onValueChange={(v) => {
          const p = v === NONE ? null : options.find((x) => String(x.id) === v);
          setAssignee(o, p ? { id: p.id, name: p.name } : null);
        }}
      >
        <SelectTrigger className="w-full sm:w-64" aria-labelledby="assignee-h">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Sin asignar</SelectItem>
          {options.map((p) => (
            <SelectItem key={p.id} value={String(p.id)} disabled={!p.active}>
              {p.name || "Sin nombre"}
              {!p.active && " (desactivada)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}

function NotesSection({ o }: { o: Opportunity }) {
  const { board, addNote, deleteNote } = useRadar();
  const { me, isAdmin } = useSession();
  const notes = board[o.id]?.notes ?? [];
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [toDelete, setToDelete] = useState<number | null>(null);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || pending) return;
    setPending(true);
    if (await addNote(o, body)) setText("");
    setPending(false);
  }

  return (
    <section aria-labelledby="notes-h" className="space-y-3">
      <SectionTitle id="notes-h">Notas{notes.length > 0 && ` · ${notes.length}`}</SectionTitle>
      {notes.length > 0 ? (
        <ol className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="flex gap-2.5">
              <PersonAvatar name={n.author?.name || "?"} className="mt-0.5" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{n.author?.name || "Persona eliminada"}</span>
                  <time dateTime={n.createdAt}>{fmtWhenShort(n.createdAt)}</time>
                  {(isAdmin || n.author?.id === me.id) && (
                    <button
                      type="button"
                      onClick={() => setToDelete(n.id)}
                      aria-label="Borrar esta nota"
                      title="Borrar nota"
                      className="ml-auto grid size-6 place-items-center rounded-md text-muted-foreground/70 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  )}
                </p>
                {/* Plain text: React escapes it; line breaks are kept by CSS. */}
                <p className="leading-relaxed break-words whitespace-pre-wrap">{n.body}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">Nadie ha escrito nada todavía.</p>
      )}
      <form onSubmit={submit} className="space-y-2">
        <label htmlFor={`note-${o.id}`} className="sr-only">
          Nueva nota
        </label>
        <textarea
          id={`note-${o.id}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          maxLength={4000}
          rows={2}
          placeholder="Escribe una nota para el equipo…"
          className={cn(textareaClass, "min-h-16 resize-y")}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">La verá todo el equipo.</span>
          <Button type="submit" size="sm" variant="outline" disabled={!text.trim() || pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Añadir nota
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={toDelete != null}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="¿Borrar la nota?"
        body="Desaparece para todo el equipo y no se puede recuperar."
        confirm="Borrar nota"
        destructive
        onConfirm={() => toDelete != null && deleteNote(o.id, toDelete)}
      />
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
