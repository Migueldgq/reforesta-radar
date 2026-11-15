import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { getLandingData, isFirstRun, type LandingData } from "./data";
import { CountUp, RefreshWhileLoading } from "./motion";

async function Resolve({ render }: { render: (data: LandingData | null) => ReactNode }) {
  const data = await getLandingData();
  return <>{render(data)}</>;
}

/**
 * Renders `render(data)` with the cached live radar data (see `getLandingData`). No Suspense
 * boundary on purpose: the cached data is baked into the prerendered HTML, so the previews
 * work without JS. The page opts out of instant-navigation validation for this reason.
 */
export function Live({ render }: { render: (data: LandingData | null) => ReactNode }) {
  return <Resolve render={render} />;
}

/** The very first ingest is still running: say so (instead of "no data") and refresh until it is done. */
export async function FirstRunNotice() {
  if (!(await isFirstRun())) return null;
  return (
    <p role="status" className="mx-auto mt-6 flex max-w-xl items-start justify-center gap-2 rounded-lg border bg-background px-4 py-3 text-left text-sm">
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" aria-hidden />
      <span>Primera carga en marcha: estamos leyendo las fuentes oficiales. Suele tardar unos 2 minutos.</span>
      <RefreshWhileLoading />
    </p>
  );
}

export function HeroFigures({ data }: { data: LandingData | null }) {
  if (!data)
    return <p className="text-sm text-muted-foreground">Datos de fuentes oficiales y programas de empresa, actualizados cada día a las 9:00.</p>;
  const figures = [
    { n: data.total, label: "convocatorias" },
    { n: data.sources.length, label: "fuentes" },
    { n: data.open, label: "abiertas ahora" },
  ];
  return (
    <dl className="flex flex-wrap items-baseline justify-center gap-x-6 gap-y-2 text-sm sm:gap-x-8">
      {figures.map((f, i) => (
        <div key={f.label} className={i > 0 ? "sm:border-l sm:pl-8" : undefined}>
          <dt className="sr-only">{f.label}</dt>
          <dd className="flex items-baseline gap-1.5">
            <CountUp value={f.n} className="text-lg font-semibold text-foreground" />
            <span className="text-muted-foreground" aria-hidden>
              {f.label}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
