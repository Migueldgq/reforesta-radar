import type { ReactNode } from "react";
import { getLandingData, type LandingData } from "./data";
import { CountUp } from "./motion";

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

export function HeroFigures({ data }: { data: LandingData | null }) {
  if (!data)
    return <p className="text-sm text-muted-foreground">Datos de fuentes oficiales y programas de empresa, actualizados cada 8 horas.</p>;
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
