import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Building2, FileSearch, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppScreenshot, Eyebrow, GithubMark, LandingNav, LogoMark, REPO_URL, Section } from "@/components/landing/chrome";
import { FindScene, RankScene, TrackScene } from "@/components/landing/how-demo";
import { MotionRoot } from "@/components/landing/motion";
import { FirstRunNotice, HeroFigures, Live } from "@/components/landing/live";
import type { LandingData } from "@/components/landing/data";
import {
  BoardPreview,
  CompaniesPreview,
  FitCard,
  Frame,
  LiveNote,
  NextEditionList,
  PdfPreview,
  SourceBars,
  Stage,
  TopTable,
  WeekChart,
} from "@/components/landing/previews";
import "@/components/landing/landing.css";

// Live previews read cached radar data outside <Suspense> so it lands in the static HTML
// (readable without JS); this lets the segment block on that cached read.
export const instant = false;

const DESCRIPTION =
  "Reforesta Radar encuentra y prioriza subvenciones, licitaciones, boletines, fondos europeos y programas de empresa para Reforesta, y explica por qué encaja cada convocatoria.";

export const metadata: Metadata = {
  title: "Reforesta Radar · Convocatorias para restaurar más monte",
  description: DESCRIPTION,
  openGraph: {
    title: "Reforesta Radar",
    description: DESCRIPTION,
    type: "website",
    locale: "es_ES",
    siteName: "Reforesta Radar",
  },
  twitter: { card: "summary", title: "Reforesta Radar", description: DESCRIPTION },
};

const HEADLINE = "Cada convocatoria que se escapa es monte que no se planta.";

const enter = (i: number) => ({ "--lp-i": i }) as CSSProperties;

const WORDS = ["cero", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"];
const numberWord = (n: number) => WORDS[n] ?? String(n);

const PROBLEMS = [
  {
    k: "4–5",
    title: "solicitudes al año",
    body: "Las prepara un equipo de 6 o 7 personas que, además, planta, restaura y hace educación ambiental.",
  },
  {
    k: "4",
    title: "fuentes, siempre las mismas",
    body: "MITECO, Fundación Biodiversidad, Comunidad de Madrid y Agenda 2030, revisadas a mano o buscando en Google.",
  },
  {
    k: "Decenas",
    title: "de páginas por convocatoria",
    body: "Para saber si una encaja hay que leerse las bases. El tiempo se va ahí, no en escribir ni en el monte.",
  },
  {
    k: "0",
    title: "empresas buscadas",
    body: "El canal de empresas (RSC) está a cero: solo llegan las que buscan a Reforesta.",
  },
];

const STEPS = [
  {
    n: "01",
    Scene: FindScene,
    title: "Encuentra.",
    // Counted from the live source list, so it says the same number as the hero.
    body: (d: LandingData | null) =>
      `Consulta ${d ? `${numberWord(d.sources.length)} fuentes` : "las fuentes"}: la BDNS, el BOE, dos boletines autonómicos (BOCM y DOG), los portales de la UE, la Fundación Biodiversidad y programas de empresa revisados a mano. Junta todo en una lista y quita duplicados.`,
  },
  {
    n: "02",
    Scene: RankScene,
    title: "Prioriza.",
    body: () => "Puntúa cada convocatoria de 0 a 100 frente al perfil de Reforesta con reglas fijas, y deja escrito cada motivo y cada aviso.",
  },
  {
    n: "03",
    Scene: TrackScene,
    title: "Sigue.",
    body: () => "Marca lo que interesa y muévelo por el tablero del equipo: En estudio, A presentar, Presentada o Descartada, con responsable y notas.",
  },
];

const SOURCE_NOTES: Record<string, { name: string; what: string; how: string }> = {
  bdns: { name: "BDNS", what: "Búsquedas temáticas, del tercer sector y por organismo en los últimos 12 meses.", how: "API oficial" },
  boe: { name: "BOE", what: "Extractos de convocatorias y licitaciones abiertas de los últimos 30 días.", how: "Datos abiertos" },
  eu: { name: "UE", what: "LIFE, bosques, biodiversidad, restauración y especies invasoras, solo con plazo futuro.", how: "API SEDIA" },
  bocm: { name: "BOCM", what: "Sumarios de la Comunidad de Madrid de los últimos 21 días.", how: "XML oficial" },
  dog: { name: "DOG", what: "Diario Oficial de Galicia, últimos 45 días.", how: "Web" },
  fb: { name: "Fundación Biodiversidad", what: "Buscador de convocatorias de la Fundación Biodiversidad.", how: "Web" },
  rsc: { name: "RSC", what: "Programas de empresas y fundaciones, comprobados a mano en la web de cada entidad.", how: "En el código" },
};

const NOT_DOING = [
  {
    title: "No redacta propuestas.",
    body: "El reto lo excluye y Reforesta ya sabe escribirlas. El radar se ocupa de encontrar y decidir.",
  },
  {
    title: "No usa IA generativa ni claves de API.",
    body: "La puntuación son reglas fijas escritas en el código, que cualquiera puede leer y discutir.",
  },
  {
    title: "No está abierto a cualquiera.",
    body: "Esta página es pública; el radar, no. Las cuentas solo se crean con una invitación de alguien del equipo.",
  },
  {
    title: "Tu asistente de IA solo puede leer.",
    body: "Si usáis un asistente compatible con MCP (como Claude), podéis conectarlo al radar desde «Mi cuenta» para que busque convocatorias por vosotros. Solo consulta: nunca cambia nada.",
  },
  {
    title: "Las reglas se pueden equivocar.",
    body: "Busca palabras, no entiende el texto. Por eso cada nota enseña sus motivos.",
  },
];

function FeatureRow({
  id,
  eyebrow,
  title,
  children,
  preview,
  flip = false,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
  preview: ReactNode;
  flip?: boolean;
}) {
  return (
    <article id={id} data-reveal className="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
      <div className={flip ? "lg:order-2 lg:col-span-5 lg:col-start-8" : "lg:col-span-5"}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h3 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h3>
        <div className="mt-4 space-y-3 text-base leading-relaxed text-muted-foreground">{children}</div>
      </div>
      <div className={flip ? "lg:order-1 lg:col-span-7" : "lg:col-span-7"}>{preview}</div>
    </article>
  );
}

function SmallFeature({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <article data-reveal className="flex flex-col">
      <span className="grid size-8 place-items-center rounded-md border bg-background text-primary [&>svg]:size-4">{icon}</span>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{title}</span> {body}
      </p>
      <Stage className="lp-lift mt-5 flex-1 p-3 sm:p-4 lg:p-4">
        <Frame className="h-full">{children}</Frame>
      </Stage>
    </article>
  );
}

export default function LandingPage() {
  return (
    <div id="top" className="lp-root min-h-svh bg-background text-foreground">
      <MotionRoot />
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Saltar al contenido
      </a>
      <LandingNav />

      <main id="contenido">
        {/* Hero */}
        <section aria-labelledby="hero-title" className="mx-auto max-w-6xl px-4 pt-16 pb-10 sm:px-6 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow className="lp-enter">Para Reforesta, ONG de restauración de ecosistemas</Eyebrow>
            <h1
              id="hero-title"
              className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl lg:leading-[1.05]"
              aria-label={HEADLINE}
            >
              {HEADLINE.split(" ").map((w, i) => (
                <span key={i}>
                  <span className="lp-word" style={{ "--w": i } as CSSProperties}>
                    {w}
                  </span>{" "}
                </span>
              ))}
            </h1>
            <p className="lp-enter mx-auto mt-6 max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg" style={enter(2)}>
              Reforesta Radar junta en una lista las subvenciones, licitaciones, boletines, fondos europeos y programas de
              empresa que pueden financiar a Reforesta, las ordena por encaje y explica en frases cortas por qué.
            </p>
            <div className="lp-enter mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row" style={enter(3)}>
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href="/">
                  Abrir el radar
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <a href={REPO_URL}>
                  <GithubMark />
                  Ver el código
                </a>
              </Button>
            </div>
            <div className="lp-enter mt-10" style={enter(4)}>
              <Live render={(d) => <HeroFigures data={d} />} />
              <FirstRunNotice />
            </div>
          </div>

          <div className="lp-enter mt-14 sm:mt-16" style={enter(5)}>
            <Stage className="lp-tilt lg:p-12">
              <AppScreenshot alt="Pantalla de inicio de Reforesta Radar con la lista de convocatorias ordenada por encaje">
                <Frame title="Reforesta Radar · Mejor encaje entre las abiertas ahora">
                  <Live render={(d) => <TopTable data={d} />} />
                </Frame>
              </AppScreenshot>
              <div className="mt-3 px-1">
                <Live render={(d) => <LiveNote data={d} />} />
              </div>
            </Stage>
          </div>
        </section>

        {/* Problem */}
        <Section id="problema" label="problema-title">
          <div data-reveal className="grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <Eyebrow>El problema</Eyebrow>
              <h2 id="problema-title" className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl lg:text-5xl">
                El dinero para restaurar existe. Encontrarlo lleva más tiempo que pedirlo.
              </h2>
            </div>
            <blockquote className="self-end lg:col-span-4 lg:col-start-9">
              <p className="text-lg text-pretty">«Estoy seguro de que se nos escapan miles.»</p>
              <footer className="mt-2 text-sm text-muted-foreground">Reforesta, en el enunciado del reto</footer>
            </blockquote>
          </div>
          <ul data-stagger className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {PROBLEMS.map((p) => (
              <li key={p.title} className="border-t pt-6">
                <p className="text-3xl font-semibold tracking-tight tabular-nums">{p.k}</p>
                <p className="mt-1 font-medium">{p.title}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* How it works */}
        <Section id="como-funciona" label="como-title" className="pt-0 sm:pt-0">
          <div data-reveal className="max-w-2xl">
            <Eyebrow>Cómo funciona</Eyebrow>
            <h2 id="como-title" className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl lg:text-5xl">
              Encuentra, prioriza y sigue.
            </h2>
          </div>
          <ol className="mt-12 grid overflow-hidden rounded-xl border md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li
                key={s.n}
                data-reveal
                className={`p-6 sm:p-8 ${i > 0 ? "border-t md:border-t-0 md:border-l" : ""}`}
                style={{ "--i": i, "--d": `${i * 350}ms` } as CSSProperties}
              >
                <div className="mb-8 h-44 rounded-lg bg-muted p-4">
                  <Live render={(d) => <s.Scene data={d} />} />
                </div>
                <span className="font-mono text-sm text-muted-foreground">{s.n}</span>
                <h3 className="mt-6 text-xl font-semibold tracking-tight sm:text-2xl">{s.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  <Live render={(d) => s.body(d)} />
                </p>
              </li>
            ))}
          </ol>
        </Section>

        {/* Features */}
        <Section id="funciones" label="funciones-title" className="space-y-24 pt-0 sm:space-y-32 sm:pt-0">
          <div data-reveal className="max-w-2xl">
            <Eyebrow>Funciones</Eyebrow>
            <h2 id="funciones-title" className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl lg:text-5xl">
              Lo que ve el equipo al abrirlo.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
              Las vistas de abajo no son capturas: se generan ahora con los datos reales del radar.
            </p>
          </div>

          <FeatureRow
            eyebrow="Una sola lista"
            title="Todas las fuentes, ordenadas por lo que cierra antes."
            preview={
              <Stage>
                <Frame title="Inicio · plazos y fuentes">
                  <div className="grid divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
                    <Live render={(d) => <WeekChart data={d} />} />
                    <Live render={(d) => <SourceBars data={d} />} />
                  </div>
                </Frame>
              </Stage>
            }
          >
            <p>
              Subvenciones, licitaciones, anuncios en boletines, fondos europeos y programas de empresa, en el mismo
              formato. Los filtros se guardan en el enlace, así que una vista se comparte copiando la dirección.
            </p>
            <p>Se puede elegir qué organismos convocantes ver; esa elección se guarda para todo el equipo y Inicio avisa cuando está activa.</p>
            <p>Si una fuente falla, se siguen mostrando sus últimos datos buenos y la vista Fuentes lo indica.</p>
          </FeatureRow>

          <FeatureRow
            flip
            eyebrow="Encaje explicado"
            title="Una nota de 0 a 100, con sus motivos y sus avisos."
            preview={
              <Stage>
                <Frame title="¿Encaja?">
                  <Live render={(d) => <FitCard data={d} />} />
                </Frame>
              </Stage>
            }
          >
            <p>
              Suma si habla de restauración, conservación o educación ambiental, si es de concurrencia competitiva o si
              puede pedirla una ONG. Resta si es nominativa, solo para empresas o ayuntamientos, o de otro ámbito.
            </p>
            <p>Cada regla que se aplica deja una frase, así que se puede ver por qué tiene esa nota y no estar de acuerdo.</p>
          </FeatureRow>

          <FeatureRow
            eyebrow="Próxima edición"
            title="Las convocatorias anuales cerradas se quedan como aviso."
            preview={
              <Stage>
                <Frame title="Cerradas · prepara la siguiente">
                  <Live render={(d) => <NextEditionList data={d} />} />
                </Frame>
              </Stage>
            }
          >
            <p>
              Las competitivas que cerraron en los últimos 12 meses no se tiran: se conservan con el motivo «prepara la
              siguiente con tiempo». Las dos convocatorias de ejemplo del reto aparecen así.
            </p>
          </FeatureRow>

          <div className="grid gap-12 md:grid-cols-3 md:gap-8">
            <SmallFeature
              icon={<ListChecks />}
              title="Seguimiento."
              body="Un tablero compartido por el equipo, con cuatro columnas, responsable y notas, para llevar cada convocatoria hasta «Presentada»."
            >
              <Live render={(d) => <BoardPreview data={d} />} />
            </SmallFeature>
            <SmallFeature
              icon={<Building2 />}
              title="Empresas."
              body="Programas de fundaciones y empresas, comprobados a mano en la web de cada entidad: importe, plazo, requisitos y qué los limita."
            >
              <Live render={(d) => <CompaniesPreview data={d} />} />
            </SmallFeature>
            <SmallFeature
              icon={<FileSearch />}
              title="Analizar PDF."
              body="Sube unas bases y recibe una ficha. Las de una convocatoria del radar llevan su misma nota; las demás se puntúan por su texto, si se lee lo suficiente."
            >
              <PdfPreview />
            </SmallFeature>
          </div>
        </Section>

        {/* Data sources */}
        <Section id="datos" label="datos-title" className="border-t">
          <div className="grid gap-12 lg:grid-cols-12">
            <div data-reveal className="lg:col-span-4">
              <Eyebrow>Los datos</Eyebrow>
              <h2 id="datos-title" className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                De dónde salen los datos.
              </h2>
              <p className="mt-4 leading-relaxed text-muted-foreground">
                Todo sale de fuentes oficiales y webs públicas, que el radar vuelve a consultar cada día a las 9:00 (hora
                de Madrid). Las cifras cambian cada día. Esta página es pública; para usar el radar hace falta una cuenta
                del equipo.
              </p>
            </div>
            <div data-reveal className="lg:col-span-8">
              <Live
                render={(d) => {
                  const counts = new Map(d?.sources.map((s) => [s.id, s]) ?? []);
                  return (
                    <ul data-stagger className="divide-y border-y">
                      {Object.entries(SOURCE_NOTES).map(([id, n]) => {
                        const s = counts.get(id);
                        return (
                          <li key={id} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-4 sm:grid-cols-[14rem_1fr_auto]">
                            <span className="text-sm font-medium">
                              {n.name}
                              <span className="block text-xs font-normal text-muted-foreground">{n.how}</span>
                            </span>
                            <span className="text-right text-sm tabular-nums text-muted-foreground sm:order-3">
                              {s ? `${s.count}${s.status === "partial" ? " · parcial" : s.status === "error" ? " · sin respuesta" : ""}` : ""}
                            </span>
                            <span className="col-span-2 text-sm text-muted-foreground sm:col-span-1">
                              {n.what}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  );
                }}
              />
            </div>
          </div>
        </Section>

        {/* Limits */}
        <Section id="limites" label="limites-title" className="pt-0 sm:pt-0">
          <div className="grid gap-12 lg:grid-cols-12">
            <div data-reveal className="lg:col-span-4">
              <Eyebrow>Límites</Eyebrow>
              <h2 id="limites-title" className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Lo que no hace.
              </h2>
            </div>
            <ul data-stagger className="divide-y border-y lg:col-span-8">
              {NOT_DOING.map((n) => (
                <li key={n.title} className="py-5">
                  <p className="font-medium">{n.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{n.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        {/* Impact */}
        <Section label="impacto-title" className="pt-0 sm:pt-0">
          <div data-reveal className="max-w-2xl">
            <Eyebrow>El objetivo</Eyebrow>
            <h2 id="impacto-title" className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl lg:text-5xl">
              Más solicitudes con el mismo equipo.
            </h2>
            <p className="mt-4 text-muted-foreground">Metas que marca el reto. No son resultados medidos.</p>
          </div>
          <dl data-reveal className="mt-12 grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
            <div className="bg-background p-6 sm:p-10">
              <dt className="text-sm text-muted-foreground">Solicitudes al año</dt>
              <dd className="mt-3 text-5xl font-semibold tracking-tight sm:text-6xl">
                4–5 <span className="text-muted-foreground">→</span> 10
              </dd>
            </div>
            <div className="bg-background p-6 sm:p-10">
              <dt className="text-sm text-muted-foreground">Primeras empresas en un canal que hoy está a cero</dt>
              <dd className="mt-3 text-5xl font-semibold tracking-tight sm:text-6xl">2–4</dd>
            </div>
          </dl>
        </Section>
      </main>

      {/* Final CTA + footer */}
      <footer className="px-2 pb-2 sm:px-3 sm:pb-3">
        <div className="rounded-2xl bg-muted">
          <div className="mx-auto max-w-6xl px-4 pt-20 pb-10 sm:px-6 sm:pt-28">
            <div data-reveal className="max-w-3xl">
              <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
                Menos horas leyendo bases, más horas en el monte.
              </h2>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link href="/">
                    Abrir el radar
                    <ArrowRight />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <a href={REPO_URL}>
                    <GithubMark />
                    Ver el código en GitHub
                  </a>
                </Button>
              </div>
            </div>
            <div className="mt-20 flex flex-col gap-6 border-t pt-8 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-3">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <LogoMark />
                  Reforesta Radar
                </p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Hecho en 1hack A Coruña — reto de Reforesta, Common Seeds / The Agile Monkeys. Código abierto.
                </p>
              </div>
              <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <li>
                  <Link href="/" className="lp-link hover:text-primary">
                    Abrir el radar
                  </Link>
                </li>
                <li>
                  <a href={REPO_URL} className="lp-link hover:text-primary">
                    Repositorio
                  </a>
                </li>
                <li>
                  <a href="https://reforesta.es/" className="lp-link hover:text-primary">
                    reforesta.es
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
