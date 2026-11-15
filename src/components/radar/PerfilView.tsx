"use client";

import { Check, ChevronDown, Download, Plus, RotateCcw, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Opportunity, OpportunityKind } from "@/lib/opportunity";
import type { WorkLine } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { isClosed, KIND_LABELS, TIER_LABELS } from "./model";
import { ALL_KINDS, DEFAULT_USER_PROFILE, HIDE_PENALTY, isNeutral, parseProfile, WORK_LINES, type UserProfile } from "./profile";
import { useRadar } from "./store";
import { ScoreChip } from "./ui";

/* ---------- Default rules served by /api/perfil ---------- */

interface Rules {
  profile: { name: string; legalForm: string; coreMission: string };
  workLines: { line: WorkLine; label: string; keywords: { term: string; weight: number; label: string }[] }[];
  dealbreakers: { term: string; warning: string; penalty: number }[];
  usualSources: string[];
  geo?: { regions: Record<string, { delta: number; reason: string }>; otherRegion?: number; otherMunicipal?: number };
}

function useRules(): Rules | null {
  const [rules, setRules] = useState<Rules | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/perfil")
      .then((r) => (r.ok ? (r.json() as Promise<Rules>) : null))
      .then((r) => alive && setRules(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return rules;
}

/* ---------- Small controls ---------- */

const STEPS = [
  { v: -10, label: "Mucho menos" },
  { v: -5, label: "Menos" },
  { v: 0, label: "Normal" },
  { v: 5, label: "Más" },
  { v: 10, label: "Mucho más" },
];

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex w-full rounded-md border p-0.5 sm:w-auto", className)}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={String(o.v)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.v)}
            className={cn(
              "flex-1 rounded-[5px] px-2 py-1 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex-none sm:px-2.5",
              on ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t pt-6 first:border-t-0 first:pt-0">
      <div className="space-y-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function More({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Collapsible className="group/more">
      <CollapsibleTrigger className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronDown className="size-3.5 transition-transform group-data-[state=open]/more:rotate-180" aria-hidden />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

const WEIGHTS = [
  { v: 8, label: "Algo +8" },
  { v: 15, label: "Bastante +15" },
  { v: 22, label: "Mucho +22" },
];
const STRENGTHS = [
  { v: 20, label: "Baja" },
  { v: HIDE_PENALTY, label: "Descartar del todo" },
];
const SUGGESTIONS = ["charcas", "anfibios", "tritones", "ailanto", "Guadarrama", "custodia del territorio", "aves", "parques regionales", "agricultores"];

/* ---------- View ---------- */

export function PerfilView() {
  const { rawData, data, profile, setProfile } = useRadar();
  const rules = useRules();
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = (fn: (p: UserProfile) => UserProfile) => {
    setProfile(fn(profile));
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1600);
  };

  const lineLabel = (l: WorkLine) => rules?.workLines.find((g) => g.line === l)?.label ?? l;

  return (
    <div className="flex w-full flex-col gap-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Perfil</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Así entiende el radar a Reforesta. Ajustadlo y la lista se reordena al momento. Se guarda en este navegador.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          <WhoSection rules={rules} />
          <LinesSection rules={rules} profile={profile} update={update} />
          <KeywordsSection rules={rules} profile={profile} update={update} lineLabel={lineLabel} />
          <ExcludeSection rules={rules} profile={profile} update={update} />
          <TerritorySection rules={rules} profile={profile} update={update} regions={rawData?.items.map((o) => o.region) ?? []} />
          <KindsSection profile={profile} update={update} />
        </div>
        <EffectPanel saved={saved} profile={profile} setProfile={setProfile} raw={rawData?.items ?? []} adjusted={data?.items ?? []} />
      </div>
    </div>
  );
}

type SectionProps = { rules: Rules | null; profile: UserProfile; update: (fn: (p: UserProfile) => UserProfile) => void };

function WhoSection({ rules }: { rules: Rules | null }) {
  return (
    <Section title="Quiénes sois" sub="Lo que el radar ya da por hecho. No se cambia desde aquí.">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted-foreground">Entidad</dt>
        <dd>{rules ? `${rules.profile.name} · entidad sin ánimo de lucro, sede en Madrid` : "…"}</dd>
        <dt className="text-muted-foreground">Líneas de trabajo</dt>
        <dd className="flex flex-wrap gap-1.5">
          {rules?.workLines.map((g) => (
            <Badge key={g.line} variant="secondary">
              {g.label}
            </Badge>
          ))}
        </dd>
        <dt className="text-muted-foreground">Fuentes habituales</dt>
        <dd className="flex flex-wrap gap-1.5">
          {rules?.usualSources.map((s) => (
            <Badge key={s} variant="outline">
              {s}
            </Badge>
          ))}
        </dd>
      </dl>
    </Section>
  );
}

function LinesSection({ rules, profile, update }: SectionProps) {
  return (
    <Section title="Líneas de trabajo" sub="Dad más o menos peso a cada línea. Afecta a las convocatorias que el radar asocia con ella.">
      <ul className="divide-y rounded-lg border">
        {WORK_LINES.map((l) => {
          const g = rules?.workLines.find((x) => x.line === l);
          return (
            <li key={l} className="space-y-2 px-4 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-medium">{g?.label ?? l}</span>
                <Segmented
                  label={`Prioridad de ${g?.label ?? l}`}
                  value={profile.linePriority[l] ?? 0}
                  options={STEPS}
                  onChange={(v) => update((p) => ({ ...p, linePriority: { ...p.linePriority, [l]: v } }))}
                />
              </div>
              {g && (
                <More label={`Palabras que ya busca (${g.keywords.length})`}>
                  <div className="flex flex-wrap gap-1.5">
                    {g.keywords.map((k) => (
                      <Badge key={k.term} variant="outline" className="font-normal">
                        {k.term} <span className="text-muted-foreground tabular-nums">+{k.weight}</span>
                      </Badge>
                    ))}
                  </div>
                </More>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function TermForm({
  placeholder,
  onAdd,
  children,
}: {
  placeholder: string;
  onAdd: (term: string) => void;
  children: ReactNode;
}) {
  const [term, setTerm] = useState("");
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
      onSubmit={(e) => {
        e.preventDefault();
        if (!term.trim()) return;
        onAdd(term.trim());
        setTerm("");
      }}
    >
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="sm:w-56" />
      {children}
      <Button type="submit" variant="outline" disabled={!term.trim()}>
        <Plus aria-hidden /> Añadir
      </Button>
    </form>
  );
}

function KeywordsSection({ rules, profile, update, lineLabel }: SectionProps & { lineLabel: (l: WorkLine) => string }) {
  const [weight, setWeight] = useState(15);
  const [line, setLine] = useState<string>("none");
  const known = useMemo(() => (rules?.workLines ?? []).flatMap((g) => g.keywords.map((k) => k.term)), [rules]);
  const add = (term: string, w = weight, l = line) => {
    if (profile.extraKeywords.some((k) => norm(k.term) === norm(term))) return;
    update((p) => ({ ...p, extraKeywords: [...p.extraKeywords, { term, weight: w, ...(l !== "none" ? { line: l as WorkLine } : {}) }] }));
  };
  const suggestions = rules
    ? SUGGESTIONS.filter((s) => !known.some((k) => norm(s).startsWith(k)) && !profile.extraKeywords.some((k) => norm(k.term) === norm(s)))
    : [];
  return (
    <Section title="Palabras que os interesan" sub="Si una convocatoria las menciona (título, organismo, resumen o beneficiarios), sube en la lista.">
      <TermForm placeholder="Ej. Guadarrama" onAdd={(t) => add(t)}>
        <Segmented label="Cuánto suma" value={weight} options={WEIGHTS} onChange={setWeight} />
        <Select value={line} onValueChange={setLine}>
          <SelectTrigger className="sm:w-48" aria-label="Línea de trabajo (opcional)">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sin línea concreta</SelectItem>
            {WORK_LINES.map((l) => (
              <SelectItem key={l} value={l}>
                {lineLabel(l)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TermForm>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>Sugerencias:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s, 15, "none")}
              className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 hover:border-solid hover:text-foreground"
            >
              <Plus className="size-3" aria-hidden /> {s}
            </button>
          ))}
        </div>
      )}
      <TermList
        empty="Aún no habéis añadido palabras."
        items={profile.extraKeywords.map((k) => ({ term: k.term, meta: `+${k.weight}${k.line ? ` · ${lineLabel(k.line)}` : ""}` }))}
        onRemove={(i) => update((p) => ({ ...p, extraKeywords: p.extraKeywords.filter((_, j) => j !== i) }))}
      />
    </Section>
  );
}

function TermList({ items, onRemove, empty }: { items: { term: string; meta: string }[]; onRemove: (i: number) => void; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((k, i) => (
        <li key={k.term}>
          <Badge variant="secondary" className="h-7 gap-1.5 pr-1 pl-2.5 text-[13px] font-normal">
            {k.term}
            <span className="text-muted-foreground tabular-nums">{k.meta}</span>
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`Quitar ${k.term}`}
              className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <X className="size-3" aria-hidden />
            </button>
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function ExcludeSection({ rules, profile, update }: SectionProps) {
  const [strength, setStrength] = useState(20);
  return (
    <Section title="Palabras que descartáis" sub="Baja resta puntos; «Descartar del todo» quita la convocatoria de la lista.">
      <TermForm
        placeholder="Ej. caza"
        onAdd={(term) => {
          if (profile.excludedTerms.some((k) => norm(k.term) === norm(term))) return;
          update((p) => ({ ...p, excludedTerms: [...p.excludedTerms, { term, penalty: strength }] }));
        }}
      >
        <Segmented label="Fuerza" value={strength} options={STRENGTHS} onChange={setStrength} />
      </TermForm>
      <TermList
        empty="Ninguna por ahora."
        items={profile.excludedTerms.map((k) => ({ term: k.term, meta: k.penalty >= HIDE_PENALTY ? "oculta" : `−${k.penalty}` }))}
        onRemove={(i) => update((p) => ({ ...p, excludedTerms: p.excludedTerms.filter((_, j) => j !== i) }))}
      />
      {rules && (
        <More label={`Lo que el radar ya penaliza (${rules.dealbreakers.length})`}>
          <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            {rules.dealbreakers.map((d) => (
              <li key={d.term} className="flex gap-2">
                <span className="w-10 shrink-0 text-right tabular-nums">−{d.penalty}</span>
                <span className="text-foreground">{d.term}</span>
              </li>
            ))}
          </ul>
        </More>
      )}
    </Section>
  );
}

function TerritorySection({ rules, profile, update, regions }: SectionProps & { regions: string[] }) {
  const groups = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of regions) count.set(r, (count.get(r) ?? 0) + 1);
    const pick = (names: string[]) => names.filter((n) => count.has(n)).map((n) => ({ name: n, n: count.get(n)! }));
    const fixed = ["Comunidad de Madrid", "Estatal", "Unión Europea"];
    const rest = Array.from(count.keys())
      .filter((r) => !fixed.includes(r))
      .sort((a, b) => a.localeCompare(b, "es"));
    return [
      { title: "Madrid", rows: pick(["Comunidad de Madrid"]) },
      { title: "Estatal", rows: pick(["Estatal"]) },
      { title: "UE", rows: pick(["Unión Europea"]) },
      { title: "Resto de comunidades", rows: pick(rest) },
    ].filter((g) => g.rows.length > 0);
  }, [regions]);

  const base = rules?.geo?.regions ?? {};
  const favoured = Object.entries(base)
    .filter(([, v]) => v.delta >= 10)
    .map(([k]) => k);

  return (
    <Section
      title="Territorio"
      sub={
        favoured.length > 0
          ? `El radar ya prioriza ${favoured.join(" y ")}${rules?.geo?.otherRegion ? ` y resta ${Math.abs(rules.geo.otherRegion)} a otras comunidades` : ""}. Lo que marquéis aquí se suma encima.`
          : "Subid o bajad las convocatorias según dónde se pueden pedir."
      }
    >
      <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
        <label htmlFor="hide-muni" className="text-sm">
          Ocultar convocatorias municipales de fuera de vuestros territorios
          <span className="block text-xs text-muted-foreground">Vuestros territorios: los que el radar ya prioriza y los que marquéis con «Más».</span>
        </label>
        <Switch
          id="hide-muni"
          checked={profile.hideMunicipalOutsideRegions}
          onCheckedChange={(v) => update((p) => ({ ...p, hideMunicipalOutsideRegions: v }))}
        />
      </div>
      <div className="rounded-lg border">
        {groups.map((g) => (
          <div key={g.title} className="border-t first:border-t-0">
            <h3 className="bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground">{g.title}</h3>
            <ul className="divide-y">
              {g.rows.map((r) => (
                <li key={r.name} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm">
                    {r.name} <span className="text-xs text-muted-foreground tabular-nums">· {r.n}</span>
                    {base[r.name] && <span className="ml-2 text-xs text-muted-foreground">base {signed(base[r.name].delta)}</span>}
                  </span>
                  <Segmented
                    label={`Ajuste para ${r.name}`}
                    value={profile.regionAdjust[r.name] ?? 0}
                    options={STEPS}
                    onChange={(v) =>
                      update((p) => {
                        const next = { ...p.regionAdjust, [r.name]: v };
                        if (!v) delete next[r.name];
                        return { ...p, regionAdjust: next };
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
        {groups.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">Cargando territorios…</p>}
      </div>
    </Section>
  );
}

function KindsSection({ profile, update }: Omit<SectionProps, "rules">) {
  return (
    <Section title="Qué tipos queréis ver" sub="Lo que desmarquéis desaparece de la lista.">
      <div className="flex flex-wrap gap-2">
        {ALL_KINDS.map((k) => {
          const on = profile.kinds.includes(k);
          return (
            <label
              key={k}
              className={cn(
                "inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                !on && "text-muted-foreground",
              )}
            >
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={on}
                onChange={() =>
                  update((p) => ({ ...p, kinds: on ? p.kinds.filter((x) => x !== k) : ALL_KINDS.filter((x) => x === k || p.kinds.includes(x)) }))
                }
              />
              {KIND_LABELS[k as OpportunityKind]}
            </label>
          );
        })}
      </div>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <label htmlFor="min-budget" className="text-sm">
          Importe mínimo
        </label>
        <div className="relative sm:w-48">
          <Input
            id="min-budget"
            inputMode="numeric"
            placeholder="Sin mínimo"
            value={profile.minBudget ? String(profile.minBudget) : ""}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d]/g, "");
              update((p) => ({ ...p, minBudget: v ? Number(v) : null }));
            }}
            className="pr-7"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">€</span>
        </div>
        <span className="text-xs text-muted-foreground">Las que no indican importe se mantienen.</span>
      </div>
    </Section>
  );
}

/* ---------- Effect panel ---------- */

function EffectPanel({
  saved,
  profile,
  setProfile,
  raw,
  adjusted,
}: {
  saved: boolean;
  profile: UserProfile;
  setProfile: (p: UserProfile) => void;
  raw: Opportunity[];
  adjusted: Opportunity[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const neutral = isNeutral(profile);

  const fx = useMemo(() => {
    const before = new Map(raw.map((o) => [o.id, o]));
    const open = (xs: typeof raw) => xs.filter((o) => !isClosed(o));
    let changed = 0;
    for (const o of adjusted) if (before.get(o.id)?.fit.tier !== o.fit.tier) changed++;
    const top = open(adjusted)
      .slice()
      .sort((a, b) => b.fit.score - a.fit.score)
      .slice(0, 5);
    return {
      changed,
      hidden: raw.length - adjusted.length,
      altoBefore: open(raw).filter((o) => o.fit.tier === "alto").length,
      altoAfter: open(adjusted).filter((o) => o.fit.tier === "alto").length,
      top: top.map((o) => ({ o, before: before.get(o.id)?.fit.score ?? o.fit.score })),
    };
  }, [raw, adjusted]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ app: "reforesta-radar", perfil: 1, ...profile }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "perfil-reforesta-radar.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (f: File | undefined) => {
    if (!f) return;
    try {
      const json = JSON.parse(await f.text()) as Record<string, unknown>;
      if (!json || typeof json !== "object" || !("linePriority" in json || "extraKeywords" in json || "kinds" in json)) throw new Error();
      setProfile(parseProfile(json));
      setImportMsg("Perfil importado.");
    } catch {
      setImportMsg("Ese archivo no es un perfil válido.");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <aside aria-label="Efecto de vuestros ajustes" className="space-y-4 rounded-lg border p-4 lg:sticky lg:top-20">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Efecto de vuestros ajustes</h2>
        <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground transition-opacity", saved ? "opacity-100" : "opacity-0")} role="status">
          <Check className="size-3.5" aria-hidden /> Guardado
        </span>
      </div>

      {neutral ? (
        <p className="text-sm text-muted-foreground">Sin ajustes: estáis viendo el orden del radar tal cual.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{TIER_LABELS.alto}</dt>
            <dd className="font-medium tabular-nums">
              {fx.altoBefore} → <span className="text-primary">{fx.altoAfter}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Cambian de nivel</dt>
            <dd className="font-medium tabular-nums">{fx.changed}</dd>
          </div>
          {fx.hidden > 0 && (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Ocultas por el perfil</dt>
              <dd className="font-medium tabular-nums">{fx.hidden}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="space-y-2 border-t pt-4">
        <h3 className="text-xs font-medium text-muted-foreground">Las 5 primeras abiertas</h3>
        <ol className="space-y-2">
          {fx.top.map(({ o, before }) => (
            <li key={o.id} className="flex items-start gap-2.5">
              <ScoreChip fit={o.fit} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-xs leading-snug">{o.titulo}</span>
                {before !== o.fit.score && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    antes {before} → {o.fit.score}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button size="sm" variant="outline" onClick={exportJson}>
          <Download aria-hidden /> Exportar
        </Button>
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden /> Importar
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} onChange={(e) => void importJson(e.target.files?.[0])} />
        <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} disabled={neutral} className="ml-auto">
          <RotateCcw aria-hidden /> Restablecer
        </Button>
      </div>
      {importMsg && (
        <p className="text-xs text-muted-foreground" role="status">
          {importMsg}
        </p>
      )}
      <p className="text-xs text-muted-foreground">Se guarda en este navegador. Exportadlo para compartirlo con el equipo.</p>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Restablecer el perfil?</DialogTitle>
            <DialogDescription>Se borran vuestros ajustes de este navegador y la lista vuelve al orden del radar.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button
              onClick={() => {
                setProfile(DEFAULT_USER_PROFILE);
                setConfirm(false);
              }}
            >
              Restablecer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
