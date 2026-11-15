import type { CSSProperties, ReactNode } from "react";
import {
  CalendarClock,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  Clock,
  RotateCw,
  TriangleAlert,
} from "lucide-react";
import type { Opportunity } from "@/lib/opportunity";
import type { FitAnalysis } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { ESTIMATE_TIP, fmtDate, fmtDayShort, parseDay, sourceLabelOf, tidy, WEEK_MS } from "@/components/radar/model";
import { cn } from "@/lib/utils";
import type { LandingData } from "./data";
import { CountUp } from "./motion";

const chip = "gap-1 font-medium whitespace-nowrap [&>svg]:size-3.5";
const TIER = { alto: "alto", medio: "medio", bajo: "bajo" } as const;

export function ScoreChip({ fit, animate = false }: { fit: FitAnalysis; animate?: boolean }) {
  const Icon = fit.tier === "alto" ? CircleCheck : fit.tier === "medio" ? CircleDot : CircleDashed;
  return (
    <Badge
      variant={fit.tier === "alto" ? "default" : fit.tier === "medio" ? "secondary" : "outline"}
      className={cn(chip, fit.tier === "bajo" && "text-muted-foreground")}
      title={`Encaje ${TIER[fit.tier]} · ${fit.score} de 100`}
    >
      <Icon aria-hidden />
      {animate ? <CountUp value={fit.score} /> : <span className="tabular-nums">{fit.score}</span>}
      <span className="font-normal">{TIER[fit.tier]}</span>
    </Badge>
  );
}

/** Same states as the app's deadline chip, computed against the cached `today`. */
export function DeadlineBadge({ o, today }: { o: Opportunity; today: number }) {
  const end = parseDay(o.deadline);
  const d = end == null ? o.fit.daysRemaining : Math.round((end - today) / 86_400_000);
  const opens = parseDay(o.opensAt);
  if (d != null ? d < 0 : o.fit.deadlineState === "cerrada")
    return (
      <Badge variant="outline" className={cn(chip, "text-muted-foreground")}>
        <CircleSlash aria-hidden />
        Cerrada
      </Badge>
    );
  if (opens != null && opens > today)
    return (
      <Badge variant="outline" className={chip}>
        <CalendarClock aria-hidden />
        Abre el {fmtDayShort(opens)}
      </Badge>
    );
  if (d == null)
    return (
      <Badge variant="outline" className={cn(chip, "text-muted-foreground")}>
        <Clock aria-hidden />
        Sin fecha
      </Badge>
    );
  const label = d === 0 ? "Cierra hoy" : d === 1 ? "Cierra mañana" : `${d} días`;
  // An estimated deadline (worked out from "20 días hábiles…") never reads as an exact one.
  if (o.deadlineEstimated)
    return (
      <Badge variant="outline" className={chip} title={`Hacia el ${fmtDate(o.deadline)} (fecha estimada). ${ESTIMATE_TIP}.`}>
        <Clock aria-hidden />≈ {label}
        <span className="sr-only"> (fecha estimada)</span>
      </Badge>
    );
  return (
    <Badge variant="outline" className={chip} title={fmtDate(o.deadline) ?? undefined}>
      <Clock aria-hidden />
      {label}
    </Badge>
  );
}

/** Rounded, hairline window frame used around every live preview. */
export function Frame({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm", className)}>
      <div className="flex h-9 items-center gap-3 border-b bg-muted/40 px-3.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </span>
        {title && <span className="truncate text-xs text-muted-foreground">{title}</span>}
      </div>
      {children}
    </div>
  );
}

/** The panel that holds a preview: muted backdrop, no border. */
export function Stage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl bg-muted p-3 sm:p-6 lg:p-8", className)}>{children}</div>;
}

export function LiveNote({ data }: { data: LandingData | null }) {
  if (!data) return <p className="text-xs text-muted-foreground">Vista de ejemplo sin datos: las fuentes no han respondido a tiempo.</p>;
  const t = new Date(data.fetchedAt);
  const when = new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(t);
  return <p className="text-xs text-muted-foreground">Datos reales del radar, consultados el {when}.</p>;
}

function Unavailable({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-40 items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/* ---------- Top results table ---------- */

export function TopTable({ data }: { data: LandingData | null }) {
  if (!data || data.topOpen.length === 0)
    return <Unavailable>Las fuentes no han respondido a tiempo. Abre el radar para ver la lista completa.</Unavailable>;
  return (
    <table className="w-full text-left text-sm">
      <caption className="sr-only">Las cinco convocatorias abiertas con mejor encaje ahora mismo</caption>
      <thead className="text-xs text-muted-foreground">
        <tr className="border-b">
          <th scope="col" className="w-24 px-4 py-2.5 font-medium">Encaje</th>
          <th scope="col" className="px-4 py-2.5 font-medium">Convocatoria</th>
          <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">Fuente</th>
          <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">Plazo</th>
        </tr>
      </thead>
      <tbody>
        {data.topOpen.map((o, i) => (
          <tr key={o.id} className="lp-row border-b last:border-0" style={{ "--i": i } as CSSProperties}>
            <td className="px-4 py-3 align-top">
              <ScoreChip fit={o.fit} />
            </td>
            <td className="px-4 py-3 align-top">
              <p className="line-clamp-2 font-medium text-foreground">{tidy(o.titulo)}</p>
              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{tidy(o.organismo)}</p>
              <div className="mt-2 sm:hidden">
                <DeadlineBadge o={o} today={data.today} />
              </div>
            </td>
            <td className="hidden px-4 py-3 align-top text-muted-foreground md:table-cell">{sourceLabelOf(o)}</td>
            <td className="hidden px-4 py-3 align-top sm:table-cell">
              <DeadlineBadge o={o} today={data.today} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------- Weekly deadlines ---------- */

export function WeekChart({ data }: { data: LandingData | null }) {
  if (!data) return <Unavailable>Sin datos de plazos en este momento.</Unavailable>;
  const max = Math.max(1, ...data.weeks.map((w) => w.count));
  const total = data.weeks.reduce((s, w) => s + w.count, 0);
  return (
    <figure className="p-5">
      <figcaption className="space-y-0.5">
        <span className="block text-sm font-medium">Cuándo cierran</span>
        <span className="block text-xs text-muted-foreground">
          {total} cierran en las próximas 12 semanas, desde hoy{data.weeksLater > 0 ? ` · ${data.weeksLater} más adelante` : ""}
        </span>
      </figcaption>
      <ol className="mt-5 grid h-32 grid-cols-12 items-end gap-1 sm:gap-2">
        {data.weeks.map((w, i) => (
          <li
            key={w.start}
            className="flex h-full flex-col items-center justify-end gap-1.5"
            aria-label={`Del ${fmtDayShort(w.start)} al ${fmtDayShort(w.start + WEEK_MS - 86_400_000)}: ${w.count}`}
          >
            <span className="text-[10px] tabular-nums text-muted-foreground" aria-hidden>
              {w.count || ""}
            </span>
            <span
              className={cn("lp-bar w-full rounded-sm", w.count ? "bg-primary" : "bg-border")}
              style={{ height: w.count ? `${Math.max(6, (w.count / max) * 88)}px` : "2px", "--i": i } as CSSProperties}
              aria-hidden
            />
          </li>
        ))}
      </ol>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground" aria-hidden>
        <span>Hoy</span>
        <span>{fmtDayShort(data.weeks[11].start)}</span>
      </div>
    </figure>
  );
}

/* ---------- Sources bar list ---------- */

export function SourceBars({ data }: { data: LandingData | null }) {
  if (!data) return <Unavailable>El estado de las fuentes no está disponible ahora.</Unavailable>;
  const rows = [...data.sources].sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...rows.map((s) => s.count));
  return (
    <div className="p-5">
      <p className="text-sm font-medium">Resultados por fuente</p>
      <p className="text-xs text-muted-foreground">Una fuente con 0 no está rota: ese día no publicó nada con encaje ambiental.</p>
      <ul className="mt-4 space-y-2">
        {rows.map((s, i) => (
          <li key={s.id} className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-xs">
            <span className="truncate text-muted-foreground">{s.name.split(" · ")[0]}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-border/60">
              <span className="lp-meter block h-full rounded-full bg-primary" style={{ width: `${s.count ? Math.max(2, (s.count / max) * 100) : 0}%`, "--i": i } as CSSProperties} />
            </span>
            <span className="text-right tabular-nums">{s.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Fit card ---------- */

export function FitCard({ data }: { data: LandingData | null }) {
  const o = data?.fitExample;
  if (!data || !o) return <Unavailable>Ningún ejemplo disponible ahora mismo.</Unavailable>;
  return (
    <div className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <ScoreChip fit={o.fit} animate />
        <DeadlineBadge o={o} today={data.today} />
        <span className="text-xs text-muted-foreground">{sourceLabelOf(o)}</span>
      </div>
      <p className="mt-3 line-clamp-2 font-medium">{tidy(o.titulo)}</p>
      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{tidy(o.organismo)}</p>
      <div className="mt-5 grid gap-5 border-t pt-5">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Por qué encaja</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {o.fit.reasons.slice(0, 4).map((r) => (
              <li key={r} className="flex gap-2">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
        {o.fit.warnings.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">Qué vigilar</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {o.fit.warnings.slice(0, 2).map((w) => (
                <li key={w} className="flex gap-2">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Next edition ---------- */

export function NextEditionList({ data }: { data: LandingData | null }) {
  if (!data || data.nextEditionExamples.length === 0) return <Unavailable>Sin ejemplos disponibles ahora mismo.</Unavailable>;
  return (
    <ul className="divide-y">
      {data.challengeSamples.map(({ id, label, o }) =>
        o ? (
          <li key={id} className="flex items-start gap-3 p-4 sm:px-5">
            <RotateCw className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium">{label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Convocatoria de ejemplo del reto · encaje {o.fit.score}</p>
              <p className="mt-1.5 text-xs">{o.fit.reasons.find((r) => r.startsWith("Convocatoria periódica")) ?? "Cerrada: se conserva como próxima edición."}</p>
            </div>
          </li>
        ) : null,
      )}
      {data.nextEditionExamples.slice(0, 2).map(({ o, closedOn }) => (
        <li key={o.id} className="flex items-start gap-3 p-4 sm:px-5">
          <RotateCw className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="line-clamp-1 text-sm font-medium">{tidy(o.titulo)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {sourceLabelOf(o)} · {closedOn ? `cerró el ${closedOn}` : "cerrada"} · encaje {o.fit.score}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Tracking board ---------- */

const COLUMNS = ["En estudio", "A presentar", "Presentada", "Descartada"];

export function BoardPreview({ data }: { data: LandingData | null }) {
  const examples = data?.topOpen.slice(0, 2) ?? [];
  return (
    <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
      {COLUMNS.map((c, i) => (
        <div key={c} className="min-h-36 bg-card p-3">
          <p className="text-xs font-medium text-muted-foreground">{c}</p>
          <div className="mt-2 space-y-2">
            {i === 0 && examples.length > 0
              ? examples.map((o) => (
                  <div key={o.id} className="rounded-md border bg-background p-2">
                    <p className="line-clamp-2 text-xs font-medium">{tidy(o.titulo)}</p>
                    <div className="mt-1.5">
                      <ScoreChip fit={o.fit} />
                    </div>
                  </div>
                ))
              : <div className="h-12 rounded-md border border-dashed" aria-hidden />}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Companies ---------- */

export function CompaniesPreview({ data }: { data: LandingData | null }) {
  const items = data?.companies ?? [];
  if (!items.length)
    return (
      <p className="p-4 text-sm text-muted-foreground sm:px-5">
        Programas de fundaciones y empresas, comprobados a mano en la web de cada entidad.
      </p>
    );
  return (
    <ul className="divide-y">
      {items.map((o) => (
        <li key={o.id} className="space-y-1.5 p-4 sm:px-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-sm font-medium">{o.organismo}</p>
            <span className="shrink-0 text-xs text-muted-foreground">{o.tipo}</span>
          </div>
          <p className="line-clamp-1 text-xs text-muted-foreground">{o.amountText}</p>
          <DeadlineBadge o={o} today={data!.today} />
        </li>
      ))}
    </ul>
  );
}

/* ---------- PDF ficha ---------- */

const FICHA = ["Por qué encaja", "Qué vigilar", "Quién puede pedirla", "Dinero", "Plazos", "Requisitos"];

export function PdfPreview() {
  return (
    <div className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
        <span className="truncate">bases-convocatoria.pdf</span>
        <span className="shrink-0">hasta 15 MB</span>
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {FICHA.map((f) => (
          <li key={f} className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}
